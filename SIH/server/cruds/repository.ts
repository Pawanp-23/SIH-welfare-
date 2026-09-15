/**
 * SAHARA repository — the only place that touches SQL.
 *
 * Rewritten from the in-memory prototype to a durable store, and rewired so
 * that every welfare score comes from the trained ensemble in `server/ml`
 * rather than from a hand-tuned formula.
 *
 * Two rules worth stating out loud, because they shape the whole file:
 *
 *  1. A check-in is 30 seconds of a jawan's time — five questions, no more.
 *     Everything else the model needs (duty roster, deployment clock, HRV,
 *     cohesion survey) comes from `personnel_context`, which a real deployment
 *     would populate from HRMS and wearables. Missing context is imputed and
 *     the assessment's `coverage` drops so nobody mistakes a guess for data.
 *
 *  2. Case creation is a *rule*, not a model output. The model decides how
 *     worried to be; a documented, inspectable rule decides when a human gets
 *     involved. Those must stay separable, or nobody can audit the escalation.
 */

import {
  AssessmentResult,
  CaseEvent,
  CaseStatus,
  DailyCheckinInput,
  RecommendationCard,
  SyntheticHRRecord,
  UnitAggregateSummary,
  UserProfile,
  WelfareCase,
} from '../../src/types.js';
import * as audit from '../core/audit.js';
import { emit } from '../core/events.js';
import { hashPassword, pseudonymFor, randomUUID, verifyPassword } from '../core/crypto.js';
import { getDb, isEmpty, transaction, truncateAll } from '../db/database.js';
import { getInitialSeedState } from '../data/seedData.js';
import { evaluateCohortSuppression } from '../engines/suppressionEngine.js';
import { assess, buildFeatures, featuresFromCheckin, type Assessment, type FeatureInput } from '../ml/engine.js';
import { combinedPlan, recommend } from '../ml/interventions.js';

const CASE_RULE_VERSION = 'R-WELFARE-02';
const CONSENT_POLICY_VERSION = 'welfare-consent-v1.1';

// Bands at or above which a sustained reading opens a case.
const REVIEW_BAND = 65;
const CONSECUTIVE_DAYS_TO_ESCALATE = 2;

const WATCH_BAND = 40;
// A fortnight of watch-band readings that are still climbing warrants a
// light-touch conversation, well before anything is an emergency.
const SUSTAINED_WATCH_DAYS = 10;

// Minimum cohort size before any aggregate may be released.
const K_ANONYMITY_THRESHOLD = 10;

type Row = Record<string, unknown>;

function b(v: unknown): boolean {
  return v === 1 || v === true;
}

function clampNum(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}


/**
 * Deterministic per-identifier random stream.
 *
 * The obvious `hash >>> n` trick does not work here: ids like "p-014" and
 * "p-107" differ only in their low bits, and shifting those away produced the
 * *identical* context for all 33 personnel. FNV-1a plus a splitmix32 finaliser
 * avalanches properly, so neighbouring ids give uncorrelated draws while every
 * machine still seeds the same demo.
 */
function seededStream(key: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  let state = h;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return ((z ^ (z >>> 15)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------

class SaharaRepository {
  constructor() {
    if (isEmpty()) this.seed();
  }

  // -- Seeding ---------------------------------------------------------------

  private seed(): void {
    const state = getInitialSeedState();
    const db = getDb();

    transaction(() => {
      // The seed file carries a couple of historical officer ids that no longer
      // exist. Point every orphaned assignment at a real welfare officer, or
      // their cases would be filed to nobody and the officer's queue would look
      // empty while the force is visibly under strain.
      const officers = new Set(
        state.users.filter((u) => u.role === 'welfare_officer').map((u) => u.id),
      );
      const fallbackOfficer = [...officers][0] ?? 'wo-001';

      const insertUser = db.prepare(
        `INSERT OR REPLACE INTO users
          (id, name, alias, role, unit_id, unit_name, rank, assigned_officer_id,
           has_consented, consent_granted_at, avatar_url, password_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const u of state.users) {
        insertUser.run(
          u.id,
          u.name,
          u.alias,
          u.role,
          u.unitId,
          u.unitName,
          u.rank,
          u.role === 'personnel'
            ? (u.assignedOfficerId && officers.has(u.assignedOfficerId)
                ? u.assignedOfficerId
                : fallbackOfficer)
            : (u.assignedOfficerId ?? null),
          u.hasConsented ? 1 : 0,
          u.consentGrantedAt ?? null,
          u.avatarUrl ?? null,
          // Every seeded account shares a demo password. Real deployments
          // provision through the force's existing identity provider.
          hashPassword('sahara'),
        );
        this.writeContext(u.id, this.deriveContext(u), 'seed_synthetic');
      }

      const insertCheckin = db.prepare(
        `INSERT OR REPLACE INTO checkins
          (id, user_id, date, sleep_hours, perceived_stress, perceived_fatigue,
           duty_hours, night_shift, support_requested, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const c of state.checkins) {
        insertCheckin.run(
          c.id,
          c.userId,
          c.date,
          c.sleepHours,
          c.perceivedStress,
          c.perceivedFatigue,
          c.dutyHours ?? null,
          c.nightShift ? 1 : 0,
          c.supportRequested ? 1 : 0,
          c.notes ?? null,
          c.createdAt,
        );
      }

      // Rescore every seeded check-in with the real model so the demo history
      // and live submissions are produced by the same code path.
      for (const c of state.checkins) {
        const scored = this.scoreCheckin(c.userId, {
          date: c.date,
          sleepHours: c.sleepHours,
          perceivedStress: c.perceivedStress,
          perceivedFatigue: c.perceivedFatigue,
          dutyHours: c.dutyHours,
          nightShift: c.nightShift,
          supportRequested: c.supportRequested,
          notes: c.notes,
        });
        this.writeAssessment(c.userId, c.id, c.date, scored, 'synthetic_demo');
      }

      this.generateHistory(state.users, 14);

      // Cases are not seeded as fixtures — they are produced by running the
      // documented escalation rule over the generated history, exactly as a
      // live check-in would. Whatever casework the officer sees on opening the
      // app is therefore something the rule genuinely fired on.
      this.openCasesFromHistory(state.users);
    });

    audit.record({
      actorId: 'system',
      actorName: 'SAHARA bootstrap',
      actorRole: 'system',
      action: 'DATABASE_SEEDED',
      resource: `${state.users.length} users, ${state.checkins.length} check-ins`,
      justification: 'first boot',
      privacyFilterEnforced: 'synthetic_data_only',
    });
  }

  /**
   * Fourteen days of check-in history for every person on the roster.
   *
   * Without this the command dashboard is a beautiful set of empty axes. Each
   * person gets a trajectory (recovering, flat, or deteriorating) chosen from
   * their own context, so the force-level trend lines and the alert velocity
   * chart are computed from real scored assessments rather than drawn from a
   * constant — which means they respond when you submit a check-in on stage.
   */
  private generateHistory(users: UserProfile[], days: number): void {
    const db = getDb();
    const insert = db.prepare(
      `INSERT OR IGNORE INTO checkins (id, user_id, date, sleep_hours, perceived_stress,
         perceived_fatigue, duty_hours, night_shift, support_requested, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    const today = new Date('2026-09-13T00:00:00Z');

    for (const u of users) {
      if (u.role !== 'personnel') continue;
      const ctx = this.getContext(u.id);

      // Seeded so the demo is identical on every machine and after every reset.
      const rand = seededStream(`hist:${u.id}`);

      // Strain blends the four context signals that a real roster would
      // already know about, and drives how punishing this person's fortnight
      // looks. It is what spreads the force across the three bands instead of
      // parking everybody in "routine".
      const strain = clampNum(
        (Number(ctx.consecutive_night_shifts ?? 1) / 5) * 0.28 +
          (Number(ctx.days_since_rest_day ?? 5) / 18) * 0.26 +
          (1 - Number(ctx.peer_cohesion_score ?? 3.5) / 5) * 0.24 +
          (Number(ctx.deployment_days_continuous ?? 40) / 170) * 0.22,
        0,
        1,
      );
      const arc = strain > 0.5 ? 1 : strain < 0.3 ? -1 : 0;

      for (let d = days - 1; d >= 0; d--) {
        const date = new Date(today.getTime() - d * 86_400_000).toISOString().slice(0, 10);
        const progress = (days - 1 - d) / (days - 1);
        const drift = arc * progress;

        const sleep = clampNum(8.2 - 3.8 * strain - 1.0 * drift + (rand() - 0.5) * 1.1, 3.4, 9.2);
        const duty = clampNum(7.8 + 6.0 * strain + 1.2 * drift + (rand() - 0.5) * 1.6, 6, 16);
        const stress = Math.round(clampNum(1.4 + 3.5 * strain + 0.9 * drift + (rand() - 0.5) * 1.0, 1, 5));
        const fatigue = Math.round(clampNum(1.5 + 3.4 * strain + 0.8 * drift + (rand() - 0.5) * 1.0, 1, 5));
        const night = rand() < 0.12 + 0.55 * strain;

        const checkinId = `chk-${u.id}-${date}`;
        insert.run(
          checkinId, u.id, date,
          Number(sleep.toFixed(1)), stress, fatigue, Number(duty.toFixed(1)),
          night ? 1 : 0, 0, null,
          new Date(`${date}T06:30:00Z`).toISOString(),
        );

        const input: DailyCheckinInput = {
          date,
          sleepHours: Number(sleep.toFixed(1)),
          perceivedStress: stress,
          perceivedFatigue: fatigue,
          dutyHours: Number(duty.toFixed(1)),
          nightShift: night,
        };
        this.writeAssessment(u.id, checkinId, date, this.scoreCheckin(u.id, input), 'synthetic_demo');
      }
    }
  }

  /** Replay the escalation rule across the seeded history. */
  private openCasesFromHistory(users: UserProfile[]): void {
    for (const u of users) {
      if (u.role !== 'personnel') continue;
      const history = this.getAssessments(u.id);
      if (history.length < CONSECUTIVE_DAYS_TO_ESCALATE) continue;

      const detail = this.getLatestAssessmentDetail(u.id);
      if (!detail) continue;

      const trigger = this.escalationTrigger(u.id, detail);
      if (trigger) this.upsertCase(u, trigger, detail);
    }
  }

  /**
   * The escalation rule, in one place so it can be read, argued with and
   * audited. Deliberately a rule and not a model output.
   *
   * Two triggers, and the second is the one that justifies the whole system:
   *
   *   CONSECUTIVE_ELEVATED — already in the review band for two consecutive
   *                 check-ins. This is what any reactive system would catch.
   *   PREDICTED_ESCALATION — not in the review band yet, but the seven-day
   *                 forecast puts them there. Acting here is the entire
   *                 difference between responding to a crisis and preventing
   *                 one, so it opens a case in its own right, flagged as
   *                 predictive so the officer knows the person does not look
   *                 bad *today*.
   *   SUSTAINED_WATCH — a fortnight of watch-band readings that are still
   *                 climbing. Nobody would call this an emergency, and that is
   *                 the point: the watch band exists so that a light-touch
   *                 conversation happens before it becomes one.
   */
  private escalationTrigger(
    userId: string,
    detail: Assessment,
  ): 'CONSECUTIVE_ELEVATED' | 'PREDICTED_ESCALATION' | 'SUSTAINED_WATCH' | null {
    const history = this.getAssessments(userId).sort((a, b) => a.date.localeCompare(b.date));
    const tail = history.slice(-CONSECUTIVE_DAYS_TO_ESCALATE);
    const sustained =
      tail.length >= CONSECUTIVE_DAYS_TO_ESCALATE && tail.every((a) => a.index >= REVIEW_BAND);
    if (sustained) return 'CONSECUTIVE_ELEVATED';

    if (detail.band !== 'review' && detail.forecastBand === 'review') return 'PREDICTED_ESCALATION';

    const window = history.slice(-SUSTAINED_WATCH_DAYS);
    if (
      window.length >= SUSTAINED_WATCH_DAYS &&
      window.every((a) => a.index >= WATCH_BAND) &&
      detail.trajectory === 'rising'
    ) {
      return 'SUSTAINED_WATCH';
    }
    return null;
  }

  /**
   * Deterministic operational context per person.
   *
   * Derived from a hash of the user id so it is stable across restarts without
   * needing to be stored in the seed file, and tuned so the demo personas land
   * in visibly different bands.
   */
  private deriveContext(u: UserProfile): FeatureInput {
    const r = seededStream(`ctx:${u.id}`);

    // The two personas the demo narrative depends on get explicit context.
    if (u.id === 'p-014') {
      return {
        age: 29, service_years: 7, sleep_variability: 2.0,
        consecutive_night_shifts: 4, days_since_rest_day: 11,
        deployment_days_continuous: 94, high_altitude_posting: 1,
        hardship_posting_index: 2, distance_from_home_km: 1740,
        days_since_family_contact: 13, transfers_24m: 1, leave_denied_6m: 1,
        hrv_rmssd_ms: 28.5, resting_hr_delta_bpm: 5.4, steps_7d_avg_k: 5.6,
        peer_cohesion_score: 2.6, grievance_pending: 1, prior_welfare_contact: 0,
        physical_readiness_score: 63,
      };
    }
    if (u.id === 'p-021') {
      return {
        age: 34, service_years: 12, sleep_variability: 0.8,
        consecutive_night_shifts: 1, days_since_rest_day: 5,
        deployment_days_continuous: 46, high_altitude_posting: 0,
        hardship_posting_index: 1, distance_from_home_km: 420,
        days_since_family_contact: 4, transfers_24m: 0, leave_denied_6m: 0,
        hrv_rmssd_ms: 44.0, resting_hr_delta_bpm: 1.6, steps_7d_avg_k: 8.2,
        peer_cohesion_score: 4.0, grievance_pending: 0, prior_welfare_contact: 0,
        physical_readiness_score: 76,
      };
    }

    return {
      age: Math.round(24 + r() * 20),
      service_years: Math.round(1 + r() * 18),
      sleep_variability: Number((0.4 + r() * 2.2).toFixed(2)),
      consecutive_night_shifts: Math.round(r() * 5),
      days_since_rest_day: Math.round(r() * 18),
      deployment_days_continuous: Math.round(10 + r() * 160),
      high_altitude_posting: r() > 0.75 ? 1 : 0,
      hardship_posting_index: Math.round(r() * 3),
      distance_from_home_km: Math.round(80 + r() * 1900),
      days_since_family_contact: Math.round(r() * 22),
      transfers_24m: Math.round(r() * 3),
      leave_denied_6m: Math.round(r() * 3),
      hrv_rmssd_ms: Number((22 + r() * 40).toFixed(1)),
      resting_hr_delta_bpm: Number((r() * 12 - 2).toFixed(1)),
      steps_7d_avg_k: Number((3.5 + r() * 8).toFixed(2)),
      peer_cohesion_score: Number((1.8 + r() * 3).toFixed(2)),
      grievance_pending: r() > 0.85 ? 1 : 0,
      prior_welfare_contact: r() > 0.88 ? 1 : 0,
      physical_readiness_score: Math.round(45 + r() * 50),
    };
  }

  // -- Context ---------------------------------------------------------------

  private writeContext(userId: string, ctx: FeatureInput, source: string): void {
    getDb()
      .prepare(
        `INSERT INTO personnel_context (user_id, payload, source, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload,
           source = excluded.source, updated_at = excluded.updated_at`,
      )
      .run(userId, JSON.stringify(ctx), source, new Date().toISOString());
  }

  public getContext(userId: string): FeatureInput {
    const row = getDb()
      .prepare('SELECT payload FROM personnel_context WHERE user_id = ?')
      .get(userId) as Row | undefined;
    return row ? (JSON.parse(row.payload as string) as FeatureInput) : {};
  }

  public updateContext(userId: string, patch: FeatureInput, source = 'hrms_import'): FeatureInput {
    const merged = { ...this.getContext(userId), ...patch };
    this.writeContext(userId, merged, source);
    return merged;
  }

  // -- Users -----------------------------------------------------------------

  private rowToUser(r: Row): UserProfile {
    return {
      id: r.id as string,
      name: r.name as string,
      alias: r.alias as string,
      role: r.role as UserProfile['role'],
      unitId: r.unit_id as string,
      unitName: r.unit_name as string,
      rank: r.rank as string,
      assignedOfficerId: (r.assigned_officer_id as string) ?? undefined,
      hasConsented: b(r.has_consented),
      consentGrantedAt: (r.consent_granted_at as string) ?? undefined,
      avatarUrl: (r.avatar_url as string) ?? undefined,
    };
  }

  public getUser(userId: string): UserProfile | undefined {
    const row = getDb()
      .prepare('SELECT * FROM users WHERE lower(id) = lower(?)')
      .get(userId) as Row | undefined;
    return row ? this.rowToUser(row) : undefined;
  }

  public listUsers(): UserProfile[] {
    return (getDb().prepare('SELECT * FROM users ORDER BY created_at DESC, id').all() as Row[]).map(
      (r) => this.rowToUser(r),
    );
  }

  public authenticate(userId: string, password: string): UserProfile | null {
    const row = getDb()
      .prepare('SELECT * FROM users WHERE lower(id) = lower(?)')
      .get(userId) as Row | undefined;
    if (!row) {
      // Hash anyway so a missing account and a wrong password take the same
      // time — otherwise the login endpoint becomes a user enumerator.
      verifyPassword(password, hashPassword('decoy'));
      return null;
    }
    const stored = row.password_hash as string | null;
    if (!stored || !verifyPassword(password, stored)) return null;
    return this.rowToUser(row);
  }

  public createUser(userData: {
    name: string;
    role: 'personnel' | 'welfare_officer' | 'command_viewer' | 'demo_operator';
    unitName?: string;
    rank?: string;
    password?: string;
  }): UserProfile {
    const id = `u-${randomUUID().slice(0, 6)}`;
    const defaultRank =
      userData.role === 'command_viewer'
        ? 'Colonel'
        : userData.role === 'welfare_officer'
          ? 'Subedar'
          : 'Constable';

    const user: UserProfile = {
      id,
      name: userData.name,
      alias: `${userData.name} (${userData.rank || defaultRank})`,
      role: userData.role,
      unitId: 'unit-102',
      unitName: userData.unitName || '102nd Mountain Battalion',
      rank: userData.rank || defaultRank,
      assignedOfficerId: userData.role === 'personnel' ? 'wo-001' : undefined,
      hasConsented: false,
    };

    getDb()
      .prepare(
        `INSERT INTO users (id, name, alias, role, unit_id, unit_name, rank,
           assigned_officer_id, has_consented, password_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(
        user.id,
        user.name,
        user.alias,
        user.role,
        user.unitId,
        user.unitName,
        user.rank,
        user.assignedOfficerId ?? null,
        hashPassword(userData.password || 'sahara'),
      );

    this.writeContext(id, this.deriveContext(user), 'registration_default');

    audit.record({
      actorId: id,
      actorName: user.name,
      actorRole: user.role,
      action: 'USER_REGISTERED',
      resource: id,
      justification: 'self-service registration',
      privacyFilterEnforced: 'none',
    });
    return user;
  }

  public setConsent(userId: string, granted: boolean, scope = 'welfare_monitoring'): UserProfile {
    const user = this.getUser(userId);
    if (!user) throw new Error('User not found');
    const now = new Date().toISOString();

    getDb()
      .prepare('UPDATE users SET has_consented = ?, consent_granted_at = ? WHERE id = ?')
      .run(granted ? 1 : 0, granted ? now : null, user.id);

    // Consent is append-only. Withdrawal does not erase the fact that it was
    // once given, which is what makes the ledger meaningful under the DPDP Act.
    getDb()
      .prepare(
        `INSERT INTO consent_ledger (id, user_id, granted, scope, policy_version, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), user.id, granted ? 1 : 0, scope, CONSENT_POLICY_VERSION, now);

    audit.record({
      actorId: userId,
      actorName: user.name,
      actorRole: user.role,
      action: granted ? 'CONSENT_GRANTED' : 'CONSENT_WITHDRAWN',
      resource: scope,
      justification: `policy ${CONSENT_POLICY_VERSION}`,
      privacyFilterEnforced: granted ? 'none' : 'processing_halted',
    });

    return { ...user, hasConsented: granted, consentGrantedAt: granted ? now : undefined };
  }

  public getConsentLedger(userId: string) {
    return (
      getDb()
        .prepare('SELECT * FROM consent_ledger WHERE user_id = ? ORDER BY timestamp DESC')
        .all(userId) as Row[]
    ).map((r) => ({
      id: r.id as string,
      granted: b(r.granted),
      scope: r.scope as string,
      policyVersion: r.policy_version as string,
      timestamp: r.timestamp as string,
    }));
  }

  // -- Check-ins & assessments ----------------------------------------------

  public getCheckins(userId: string) {
    return (
      getDb()
        .prepare('SELECT * FROM checkins WHERE lower(user_id) = lower(?) ORDER BY date ASC')
        .all(userId) as Row[]
    ).map((r) => ({
      id: r.id as string,
      userId: r.user_id as string,
      date: r.date as string,
      sleepHours: r.sleep_hours as number,
      perceivedStress: r.perceived_stress as number,
      perceivedFatigue: r.perceived_fatigue as number,
      dutyHours: (r.duty_hours as number) ?? undefined,
      nightShift: b(r.night_shift),
      supportRequested: b(r.support_requested),
      notes: (r.notes as string) ?? undefined,
      createdAt: r.created_at as string,
    }));
  }

  public getAssessments(userId: string): AssessmentResult[] {
    return (
      getDb()
        .prepare('SELECT * FROM assessments WHERE lower(user_id) = lower(?) ORDER BY date ASC')
        .all(userId) as Row[]
    ).map((r) => JSON.parse(r.payload as string) as AssessmentResult);
  }

  /** The full model output for a user's most recent check-in. */
  public getLatestAssessmentDetail(userId: string): Assessment | null {
    const row = getDb()
      .prepare('SELECT payload FROM assessments WHERE lower(user_id) = lower(?) ORDER BY date DESC LIMIT 1')
      .get(userId) as Row | undefined;
    if (!row) return null;
    const parsed = JSON.parse(row.payload as string) as AssessmentResult & { detail?: Assessment };
    return parsed.detail ?? null;
  }

  /** Build the model feature vector for a user at a point in time. */
  public featuresFor(userId: string, input: DailyCheckinInput): FeatureInput {
    const history = this.getCheckins(userId).filter((c) => c.date < input.date);
    const recent = history.slice(-7);
    const baselineSleep =
      recent.length >= 3
        ? recent.reduce((s, c) => s + c.sleepHours, 0) / recent.length
        : 7.4;

    // Consecutive night shifts is a run length, not a count — walking backwards
    // from today is the only way to get it right.
    let run = input.nightShift ? 1 : 0;
    if (input.nightShift) {
      for (let i = history.length - 1; i >= 0 && history[i].nightShift; i--) run++;
    }

    const ctx = this.getContext(userId);
    return featuresFromCheckin({
      sleepHours: input.sleepHours,
      baselineSleep,
      perceivedStress: input.perceivedStress,
      perceivedFatigue: input.perceivedFatigue,
      dutyHours: input.dutyHours,
      consecutiveNightShifts: Math.max(run, Number(ctx.consecutive_night_shifts ?? 0)),
      base: ctx,
    });
  }

  /**
   * The exact feature vector behind this person's most recent assessment.
   *
   * Everything downstream — recommendations, counterfactuals, the what-if
   * simulator — must start from this, not from `getContext()` alone. Context
   * omits the six check-in-derived features, so starting from it silently
   * imputes them and the simulator's baseline drifts away from the number on
   * the dossier. Two different risk scores for the same person on two screens
   * is exactly the kind of thing that loses a room's trust.
   */
  public currentFeatures(userId: string): FeatureInput {
    const latest = this.getCheckins(userId).at(-1);
    if (!latest) return this.getContext(userId);
    return this.featuresFor(userId, {
      date: latest.date,
      sleepHours: latest.sleepHours,
      perceivedStress: latest.perceivedStress,
      perceivedFatigue: latest.perceivedFatigue,
      dutyHours: latest.dutyHours,
      nightShift: latest.nightShift,
    });
  }

  private scoreCheckin(userId: string, input: DailyCheckinInput): Assessment {
    return assess(this.featuresFor(userId, input));
  }

  private writeAssessment(
    userId: string,
    checkinId: string,
    date: string,
    detail: Assessment,
    dataSource: 'live_input' | 'synthetic_demo',
  ): AssessmentResult {
    const result: AssessmentResult & { detail: Assessment } = {
      id: `asm-${userId}-${date}`,
      checkinId,
      date,
      index: detail.wri,
      band: detail.band,
      coverage: detail.coverage,
      contributors: {
        stressScore: detail.drivers.find((d) => d.feature === 'perceived_stress')?.impact ?? 0,
        fatigueScore: detail.drivers.find((d) => d.feature === 'perceived_fatigue')?.impact ?? 0,
        sleepScore: detail.drivers.find((d) => d.feature === 'sleep_debt_7d')?.impact ?? 0,
        workloadScore: detail.drivers.find((d) => d.feature === 'overtime_hours_7d')?.impact ?? 0,
        explanations: detail.drivers
          .slice(0, 3)
          .map((d) => `${d.name} (${d.value}) contributes ${d.impact > 0 ? '+' : ''}${d.impact} points`),
      },
      algorithmVersion: detail.modelVersion,
      forecastValue: detail.forecast7d,
      forecastBaseline: detail.wri,
      modelVersion: detail.modelVersion,
      generatedAt: new Date().toISOString(),
      dataSource,
      detail,
    };

    getDb()
      .prepare(
        `INSERT INTO assessments
          (id, checkin_id, user_id, date, idx, band, coverage, forecast_value,
           forecast_base, model_version, payload, generated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET idx = excluded.idx, band = excluded.band,
           coverage = excluded.coverage, forecast_value = excluded.forecast_value,
           payload = excluded.payload, generated_at = excluded.generated_at`,
      )
      .run(
        result.id,
        checkinId,
        userId,
        date,
        detail.wri,
        detail.band,
        detail.coverage,
        detail.forecast7d,
        detail.wri,
        detail.modelVersion,
        JSON.stringify(result),
        result.generatedAt,
      );

    return result;
  }

  public submitCheckin(userId: string, input: DailyCheckinInput): AssessmentResult {
    const user = this.getUser(userId);
    if (!user) throw new Error('User not found');
    if (!user.hasConsented) {
      throw Object.assign(new Error('Consent has not been granted for welfare monitoring'), {
        status: 403,
      });
    }

    const checkinId = `chk-${userId}-${input.date}`;
    const now = new Date().toISOString();

    const result = transaction(() => {
      getDb()
        .prepare(
          `INSERT INTO checkins (id, user_id, date, sleep_hours, perceived_stress,
             perceived_fatigue, duty_hours, night_shift, support_requested, notes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, date) DO UPDATE SET
             sleep_hours = excluded.sleep_hours,
             perceived_stress = excluded.perceived_stress,
             perceived_fatigue = excluded.perceived_fatigue,
             duty_hours = excluded.duty_hours,
             night_shift = excluded.night_shift,
             support_requested = excluded.support_requested,
             notes = excluded.notes`,
        )
        .run(
          checkinId,
          user.id,
          input.date,
          input.sleepHours,
          input.perceivedStress,
          input.perceivedFatigue,
          input.dutyHours ?? null,
          input.nightShift ? 1 : 0,
          input.supportRequested ? 1 : 0,
          input.notes ?? null,
          now,
        );

      const detail = this.scoreCheckin(user.id, input);
      const assessment = this.writeAssessment(user.id, checkinId, input.date, detail, 'live_input');

      // --- Escalation rule (documented, not learned) ----------------------
      const trigger = input.supportRequested ? 'DIRECT_REQUEST' : this.escalationTrigger(user.id, detail);
      if (trigger) this.upsertCase(user, trigger, detail);

      return assessment;
    });

    audit.record({
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      action: 'CHECKIN_SUBMITTED',
      resource: checkinId,
      justification: 'self-submitted daily welfare check-in',
      privacyFilterEnforced: 'self_access',
    });

    emit({
      type: 'assessment.created',
      payload: {
        // No name, no id — command-side listeners get a pseudonym only.
        token: pseudonymFor(user.id),
        unitId: user.unitId,
        unitName: user.unitName,
        wri: result.index,
        band: result.band,
        forecast: result.forecastValue,
        at: result.generatedAt,
      },
    });

    return result;
  }

  // -- Cases -----------------------------------------------------------------

  private writeCase(kase: WelfareCase): void {
    const db = getDb();
    db.prepare(
      `INSERT OR REPLACE INTO cases
        (id, personnel_id, personnel_alias, unit_id, unit_name, assigned_officer_id,
         status, reason, due_at, created_at, updated_at, latest_index, latest_band,
         consecutive_alert_days, support_requested)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      kase.id,
      kase.personnelId,
      kase.personnelAlias,
      kase.unitId,
      kase.unitName,
      kase.assignedOfficerId,
      kase.status,
      kase.reason,
      kase.dueAt,
      kase.createdAt,
      kase.updatedAt,
      kase.latestIndex,
      kase.latestBand,
      kase.consecutiveAlertDays,
      kase.supportRequested ? 1 : 0,
    );

    const ev = db.prepare(
      `INSERT OR REPLACE INTO case_events (id, case_id, actor_id, actor_name, action, concise_note, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const e of kase.events) {
      ev.run(e.id, kase.id, e.actorId, e.actorName, e.action, e.conciseNote, e.timestamp);
    }

    const rec = db.prepare(
      `INSERT OR REPLACE INTO recommendations
        (id, case_id, trigger_facts, rule_version, proposed_action, review_status,
         reviewer_note, reviewer_id, reviewed_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const r of kase.recommendations) {
      rec.run(
        r.id,
        kase.id,
        JSON.stringify(r.triggerFacts),
        r.ruleVersion,
        r.proposedAction,
        r.reviewStatus,
        r.reviewerNote ?? null,
        r.reviewerId ?? null,
        r.reviewedAt ?? null,
        null,
      );
    }
  }

  private hydrateCase(r: Row): WelfareCase {
    const db = getDb();
    const events = (
      db.prepare('SELECT * FROM case_events WHERE case_id = ? ORDER BY timestamp ASC').all(r.id) as Row[]
    ).map<CaseEvent>((e) => ({
      id: e.id as string,
      caseId: e.case_id as string,
      actorId: e.actor_id as string,
      actorName: e.actor_name as string,
      action: e.action as string,
      conciseNote: e.concise_note as string,
      timestamp: e.timestamp as string,
    }));

    const recommendations = (
      db.prepare('SELECT * FROM recommendations WHERE case_id = ?').all(r.id) as Row[]
    ).map<RecommendationCard>((c) => ({
      id: c.id as string,
      caseId: c.case_id as string,
      triggerFacts: JSON.parse(c.trigger_facts as string) as string[],
      ruleVersion: c.rule_version as string,
      proposedAction: c.proposed_action as string,
      reviewStatus: c.review_status as RecommendationCard['reviewStatus'],
      reviewerNote: (c.reviewer_note as string) ?? undefined,
      reviewerId: (c.reviewer_id as string) ?? undefined,
      reviewedAt: (c.reviewed_at as string) ?? undefined,
    }));

    return {
      id: r.id as string,
      personnelId: r.personnel_id as string,
      personnelAlias: r.personnel_alias as string,
      unitId: r.unit_id as string,
      unitName: r.unit_name as string,
      assignedOfficerId: r.assigned_officer_id as string,
      status: r.status as CaseStatus,
      reason: r.reason as string,
      dueAt: r.due_at as string,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      latestIndex: r.latest_index as number,
      latestBand: r.latest_band as WelfareCase['latestBand'],
      consecutiveAlertDays: r.consecutive_alert_days as number,
      supportRequested: b(r.support_requested),
      events,
      recommendations,
    };
  }

  private upsertCase(
    user: UserProfile,
    trigger:
      | 'DIRECT_REQUEST'
      | 'CONSECUTIVE_ELEVATED'
      | 'PREDICTED_ESCALATION'
      | 'SUSTAINED_WATCH',
    detail: Assessment,
  ): void {
    const db = getDb();
    const now = new Date().toISOString();
    const existing = db
      .prepare(`SELECT * FROM cases WHERE lower(personnel_id) = lower(?) AND status != 'closed' LIMIT 1`)
      .get(user.id) as Row | undefined;

    const reason =
      trigger === 'DIRECT_REQUEST'
        ? 'Personnel requested support directly'
        : trigger === 'PREDICTED_ESCALATION'
          ? `Currently ${detail.band} at ${detail.wri}, but the seven-day forecast is ${detail.forecast7d} — predicted to enter the review band`
          : trigger === 'SUSTAINED_WATCH'
            ? `${SUSTAINED_WATCH_DAYS} consecutive check-ins in the watch band or above, still rising (now ${detail.wri}, forecast ${detail.forecast7d})`
            : `Welfare Risk Index at ${detail.wri} for ${CONSECUTIVE_DAYS_TO_ESCALATE} consecutive check-ins`;

    if (!existing) {
      const caseId = `case-${user.id}-${Date.now()}`;

      // Recommendations come from this person's own attributions, so the card
      // the officer reads is tied to the reason the model flagged them.
      const features = this.currentFeatures(user.id);
      const recs = recommend(features, detail.drivers, 3);

      const kase: WelfareCase = {
        id: caseId,
        personnelId: user.id,
        personnelAlias: user.alias,
        unitId: user.unitId,
        unitName: user.unitName,
        assignedOfficerId: user.assignedOfficerId || 'wo-001',
        status: 'new',
        reason,
        dueAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        createdAt: now,
        updatedAt: now,
        latestIndex: detail.wri,
        latestBand: detail.band,
        consecutiveAlertDays: trigger === 'CONSECUTIVE_ELEVATED' ? CONSECUTIVE_DAYS_TO_ESCALATE : 1,
        supportRequested: trigger === 'DIRECT_REQUEST',
        events: [
          {
            id: randomUUID(),
            caseId,
            actorId: 'system',
            actorName: 'SAHARA triage',
            action: 'CASE_OPENED',
            conciseNote: `${reason}. Top driver: ${detail.drivers[0]?.name ?? 'n/a'} (${
              detail.drivers[0]?.impact ?? 0
            } pts).`,
            timestamp: now,
          },
        ],
        recommendations: recs.length
          ? recs.map((r) => ({
              id: randomUUID(),
              caseId,
              triggerFacts: [
                `${r.triggerValue} — ${r.driver}`,
                `SHAP contribution +${r.triggerImpact.toFixed(1)} WRI points`,
              ],
              ruleVersion: CASE_RULE_VERSION,
              proposedAction: `${r.title}. ${r.action} (modelled effect: −${r.projectedRiskReduction} WRI, ${r.citation})`,
              reviewStatus: 'pending' as const,
            }))
          : [
              {
                id: randomUUID(),
                caseId,
                triggerFacts: [reason],
                ruleVersion: CASE_RULE_VERSION,
                proposedAction: 'Hold a confidential welfare conversation within 24 hours.',
                reviewStatus: 'pending' as const,
              },
            ],
      };

      this.writeCase(kase);
      emit({
        type: 'case.opened',
        payload: {
          caseId,
          token: pseudonymFor(user.id),
          unitName: user.unitName,
          band: detail.band,
          wri: detail.wri,
          reason,
          at: now,
        },
      });
      emit({
        type: 'alert.raised',
        payload: {
          severity: detail.band === 'review' ? 'high' : 'medium',
          token: pseudonymFor(user.id),
          unitName: user.unitName,
          headline: reason,
          driver: detail.drivers[0]?.name ?? null,
          at: now,
        },
      });
    } else {
      db.prepare(
        `UPDATE cases SET latest_index = ?, latest_band = ?, updated_at = ?,
           support_requested = ?, consecutive_alert_days = consecutive_alert_days + 1
         WHERE id = ?`,
      ).run(
        detail.wri,
        detail.band,
        now,
        trigger === 'DIRECT_REQUEST' ? 1 : (existing.support_requested as number),
        existing.id,
      );

      db.prepare(
        `INSERT INTO case_events (id, case_id, actor_id, actor_name, action, concise_note, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        existing.id,
        'system',
        'SAHARA triage',
        'CASE_UPDATED',
        `Further check-in processed. Index now ${detail.wri} (${detail.band}), 7-day forecast ${detail.forecast7d}.`,
        now,
      );

      emit({
        type: 'case.updated',
        payload: { caseId: existing.id, wri: detail.wri, band: detail.band, at: now },
      });
    }
  }

  public getCasesForOfficer(officerId: string): WelfareCase[] {
    return (
      getDb()
        .prepare('SELECT * FROM cases WHERE lower(assigned_officer_id) = lower(?) ORDER BY updated_at DESC')
        .all(officerId) as Row[]
    ).map((r) => this.hydrateCase(r));
  }

  public listCases(): WelfareCase[] {
    return (getDb().prepare('SELECT * FROM cases ORDER BY updated_at DESC').all() as Row[]).map((r) =>
      this.hydrateCase(r),
    );
  }

  public getCaseById(caseId: string): WelfareCase | undefined {
    const row = getDb().prepare('SELECT * FROM cases WHERE id = ?').get(caseId) as Row | undefined;
    return row ? this.hydrateCase(row) : undefined;
  }

  public updateCaseStatus(
    caseId: string,
    officerId: string,
    status: CaseStatus,
    conciseNote: string,
    newDueAt?: string,
  ): WelfareCase {
    const kase = this.getCaseById(caseId);
    if (!kase) throw Object.assign(new Error('Case not found'), { status: 404 });
    const officer = this.getUser(officerId);
    const now = new Date().toISOString();

    getDb()
      .prepare('UPDATE cases SET status = ?, updated_at = ?, due_at = ? WHERE id = ?')
      .run(status, now, newDueAt ?? kase.dueAt, caseId);

    getDb()
      .prepare(
        `INSERT INTO case_events (id, case_id, actor_id, actor_name, action, concise_note, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        caseId,
        officerId,
        officer?.name ?? 'Welfare Officer',
        `STATUS_CHANGED_${status.toUpperCase()}`,
        conciseNote,
        now,
      );

    audit.record({
      actorId: officerId,
      actorName: officer?.name ?? officerId,
      actorRole: officer?.role ?? 'welfare_officer',
      action: 'CASE_STATUS_UPDATED',
      resource: caseId,
      justification: conciseNote,
      privacyFilterEnforced: 'assigned_officer_only',
    });

    emit({ type: 'case.updated', payload: { caseId, status, at: now } });
    return this.getCaseById(caseId)!;
  }

  public reviewRecommendation(
    caseId: string,
    recId: string,
    officerId: string,
    decision: 'accepted' | 'dismissed',
    reviewerNote: string,
  ): WelfareCase {
    const kase = this.getCaseById(caseId);
    if (!kase) throw Object.assign(new Error('Case not found'), { status: 404 });
    const rec = kase.recommendations.find((r) => r.id === recId);
    if (!rec) throw Object.assign(new Error('Recommendation not found'), { status: 404 });

    const now = new Date().toISOString();
    getDb()
      .prepare(
        'UPDATE recommendations SET review_status = ?, reviewer_id = ?, reviewer_note = ?, reviewed_at = ? WHERE id = ?',
      )
      .run(decision, officerId, reviewerNote, now, recId);

    getDb()
      .prepare(
        `INSERT INTO case_events (id, case_id, actor_id, actor_name, action, concise_note, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        caseId,
        officerId,
        this.getUser(officerId)?.name ?? 'Welfare Officer',
        `RECOMMENDATION_${decision.toUpperCase()}`,
        `${decision}: ${rec.proposedAction} — ${reviewerNote}`,
        now,
      );

    audit.record({
      actorId: officerId,
      action: `RECOMMENDATION_${decision.toUpperCase()}`,
      resource: recId,
      justification: reviewerNote,
      privacyFilterEnforced: 'assigned_officer_only',
    });

    return this.getCaseById(caseId)!;
  }

  // -- Aggregates ------------------------------------------------------------

  /**
   * Unit view with k-anonymity enforced *in the query layer*, not the UI.
   *
   * A unit under the threshold returns a suppression notice and no numbers at
   * all, because "average duty hours across 4 people" plus a roster is an
   * identification, not an aggregate.
   */
  public getUnitSummary(unitId: string): UnitAggregateSummary {
    const db = getDb();
    const personnel = (
      db.prepare(`SELECT * FROM users WHERE unit_id = ? AND role = 'personnel'`).all(unitId) as Row[]
    ).map((r) => this.rowToUser(r));

    const unitName =
      personnel[0]?.unitName ?? (unitId === 'unit-099' ? 'Detachment Alpha' : 'Unit');
    const count = personnel.length;

    if (count < K_ANONYMITY_THRESHOLD) {
      return evaluateCohortSuppression(unitId, unitName, count, 0, [], 0, 0, 0, []);
    }

    const checkins = (
      db
        .prepare(
          `SELECT c.* FROM checkins c JOIN users u ON u.id = c.user_id WHERE u.unit_id = ?`,
        )
        .all(unitId) as Row[]
    ).map((r) => ({
      date: r.date as string,
      dutyHours: (r.duty_hours as number) ?? 8,
      nightShift: b(r.night_shift),
    }));

    const openCases = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM cases WHERE unit_id = ? AND status != 'closed'`)
        .get(unitId) as Row
    ).n as number;
    const resolvedCases = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM cases WHERE unit_id = ? AND status = 'closed'`)
        .get(unitId) as Row
    ).n as number;

    const dates = [...new Set(checkins.map((c) => c.date))].sort().slice(-7);
    const rawTrends = dates.map((d) => {
      const day = checkins.filter((c) => c.date === d);
      return {
        date: d,
        dutyHours: day.map((c) => c.dutyHours),
        nightCount: day.filter((c) => c.nightShift).length,
      };
    });

    return evaluateCohortSuppression(
      unitId,
      unitName,
      count,
      Math.min(count, checkins.length),
      checkins.map((c) => c.dutyHours),
      checkins.filter((c) => c.nightShift).length,
      openCases,
      resolvedCases,
      rawTrends,
    );
  }

  /** Live, model-scored roll-up across every consenting individual. */
  public forceRollup() {
    const personnel = (
      getDb().prepare(`SELECT * FROM users WHERE role = 'personnel'`).all() as Row[]
    ).map((r) => this.rowToUser(r));

    const scored = personnel.map((u) => {
      const latest = this.getAssessments(u.id).slice(-1)[0];
      return {
        id: u.id,
        token: pseudonymFor(u.id),
        unitId: u.unitId,
        unitName: u.unitName,
        wri: latest?.index ?? null,
        band: latest?.band ?? null,
      };
    });

    const withScore = scored.filter((s) => s.wri !== null);
    return {
      monitored: personnel.length,
      assessed: withScore.length,
      routine: withScore.filter((s) => s.band === 'routine').length,
      watch: withScore.filter((s) => s.band === 'watch').length,
      review: withScore.filter((s) => s.band === 'review').length,
      meanWri: withScore.length
        ? Number((withScore.reduce((s, r) => s + (r.wri ?? 0), 0) / withScore.length).toFixed(1))
        : null,
      byUnit: [...new Set(personnel.map((p) => p.unitId))].map((unitId) => {
        const members = withScore.filter((s) => s.unitId === unitId);
        const headcount = personnel.filter((p) => p.unitId === unitId).length;
        // Suppression is a property of the cohort's size, not of how many
        // people happen to have checked in — otherwise a quiet week would
        // silently unmask a small unit.
        const suppressed = headcount < K_ANONYMITY_THRESHOLD;
        return {
          unitId,
          unitName: personnel.find((p) => p.unitId === unitId)?.unitName ?? unitId,
          personnelCount: headcount,
          suppressed,
          meanWri:
            suppressed || !members.length
              ? null
              : Number((members.reduce((s, r) => s + (r.wri ?? 0), 0) / members.length).toFixed(1)),
          reviewCount: suppressed ? null : members.filter((m) => m.band === 'review').length,
        };
      }),
    };
  }

  /** Explain-and-plan for one individual, used by the officer workspace. */
  public riskDossier(userId: string) {
    const user = this.getUser(userId);
    if (!user) return null;
    const detail = this.getLatestAssessmentDetail(userId);
    if (!detail) return null;

    const features = this.currentFeatures(userId);
    const recs = recommend(features, detail.drivers, 4);
    const plan = combinedPlan(features, recs);

    // Free-text the person chose to add on a check-in. This route is already
    // gated to the individual themselves or their assigned officer
    // (requireSelfOrAssignedOfficer), so surfacing it here is exactly the
    // "visible only to your assigned welfare officer" promise the check-in
    // screen makes — and nowhere else reads this column back out.
    const notes = this.getCheckins(userId)
      .filter((c) => c.notes && c.notes.trim().length > 0)
      .slice(-5)
      .reverse()
      .map((c) => ({ date: c.date, text: c.notes as string }));

    return {
      token: pseudonymFor(userId),
      unitName: user.unitName,
      rank: user.rank,
      assessment: detail,
      recommendations: recs,
      plan: plan
        ? {
            combinedRiskReduction: plan.combinedRiskReduction,
            naiveSumOfIndividualEffects: plan.naiveSumOfIndividualEffects,
            interactionNote: plan.interactionNote,
            projected: plan.outcome.projected,
          }
        : null,
      history: this.getAssessments(userId).map((a) => ({
        date: a.date,
        index: a.index,
        band: a.band,
        forecast: a.forecastValue,
      })),
      notes,
    };
  }

  // -- HR import & admin -----------------------------------------------------

  public importSyntheticHR(records: SyntheticHRRecord[], officerId: string) {
    let flaggedCount = 0;
    const flaggedPersonnel: Array<{ personnelId: string; reason: string }> = [];

    transaction(() => {
      for (const rec of records) {
        // An HR import updates the model's operational context — that is the
        // whole point of ingesting it, rather than just counting rows.
        this.updateContext(
          rec.personnelId,
          {
            duty_hours_7d_avg: rec.dutyHours,
            overtime_hours_7d: Math.max(0, (rec.dutyHours - 8) * 7),
            consecutive_night_shifts: rec.nightShift ? 3 : 0,
            deployment_days_continuous: rec.deploymentDays,
            days_since_rest_day: rec.daysSinceRest,
            transfers_24m: rec.transfersCount,
          },
          'hrms_import',
        );

        if (rec.dutyHours > 12 && rec.nightShift) {
          flaggedCount++;
          flaggedPersonnel.push({
            personnelId: rec.personnelId,
            reason: `${rec.dutyHours}h night duty, ${rec.daysSinceRest} days since a rest day`,
          });
        }
      }
    });

    audit.record({
      actorId: officerId,
      action: 'HR_BATCH_IMPORTED',
      resource: `${records.length} records`,
      justification: 'scheduled HRMS synchronisation',
      privacyFilterEnforced: 'operational_fields_only',
    });

    return { totalImported: records.length, flaggedCount, flaggedPersonnel };
  }

  public getAuditLogs(limit = 100) {
    return audit.list({ limit }).map((e) => ({
      id: e.id,
      timestamp: e.timestamp,
      actorId: e.actorId,
      actorName: e.actorName,
      actorRole: e.actorRole,
      action: e.action,
      resource: e.resource,
      justification: e.justification,
      privacyFilterEnforced: e.privacyFilterEnforced,
      hash: e.hash.slice(0, 12),
    }));
  }

  public reset(): void {
    truncateAll();
    this.seed();
    emit({ type: 'system.reset', payload: { at: new Date().toISOString() } });
  }

  /** Recent feature vectors, for the drift monitor. */
  public recentFeatureMatrix(limit = 400): Float64Array[] {
    const rows = getDb()
      .prepare('SELECT user_id, date FROM assessments ORDER BY generated_at DESC LIMIT ?')
      .all(limit) as Row[];

    const out: Float64Array[] = [];
    for (const r of rows) {
      const checkin = this.getCheckins(r.user_id as string).find((c) => c.date === r.date);
      if (!checkin) continue;
      out.push(buildFeatures(this.featuresFor(r.user_id as string, checkin)).vector);
    }
    return out;
  }
}

export const repository = new SaharaRepository();
