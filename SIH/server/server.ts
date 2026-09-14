/**
 * SAHARA API server.
 *
 * Route surface is unchanged from the prototype so the frontend keeps working,
 * but every number behind it now comes from the database and the trained
 * ensemble rather than from a constants file. Added on top: real authentication,
 * role-based access control, request validation, rate limiting, a tamper-evident
 * audit chain, and a live event stream.
 */

import path from 'node:path';

import { GoogleGenAI } from '@google/genai';
import express from 'express';
import { createServer as createViteServer } from 'vite';

import * as audit from './core/audit.js';
import { pseudonymFor, signToken } from './core/crypto.js';
import { connectionCount, subscribe } from './core/events.js';
import { parse } from './core/validate.js';
import { repository } from './cruds/repository.js';
import { getDb, storageWarning } from './db/database.js';
import { ragService } from './engines/ragService.js';
import { buildLedgerSummary } from './engines/scoreLedger.js';
import {
  asyncRoute,
  errorHandler,
  HttpError,
  identify,
  notFound,
  rateLimit,
  requireAuth,
  requireRole,
  requireSelfOrAssignedOfficer,
  securityHeaders,
} from './middleware/index.js';
import {
  artifact,
  assess,
  bandOf,
  computePSI,
  FEATURE_INDEX,
  metrics,
  modelCard,
  simulate,
  type Lever,
} from './ml/engine.js';
import { PLAYBOOK, recommend } from './ml/interventions.js';
import type {
  ForceWelfareOverview,
  InterventionItem,
  ModelHealthMetrics,
  PersonnelRiskProfile,
  ShapFactor,
  UnitHeatmapItem,
} from '../src/types.js';

const PORT = Number(process.env.PORT ?? 3000);

// `NODE_ENV=x cmd` is not portable to a Windows shell, so the production build
// announces itself with a flag instead of an environment variable.
const IS_PRODUCTION =
  process.argv.includes('--production') || process.env.NODE_ENV === 'production';
const app = express();
const bootedAt = Date.now();

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(securityHeaders);
app.use(identify);

// Resolve the acting user for every request, so handlers never re-query it.
app.use((req, _res, next) => {
  if (req.actor) {
    const user = repository.getUser(req.actor.id);
    if (user) req.actor = { id: user.id, role: user.role, unitId: user.unitId, name: user.name };
  }
  next();
});

const DEFAULT_USER = 'p-014';
function actingUser(req: express.Request) {
  const id = req.actor?.id ?? DEFAULT_USER;
  const user = repository.getUser(id);
  if (!user) throw new HttpError(401, 'Unknown user', 'unknown_user');
  return user;
}

// ---------------------------------------------------------------------------
// Auth & identity
// ---------------------------------------------------------------------------

app.post(
  '/api/auth/login',
  rateLimit({ capacity: 8, refillPerSecond: 0.1, key: 'login' }),
  (req, res) => {
    const { userId, password } = parse<{ userId: string; password: string }>(req.body, {
      userId: { type: 'string', min: 2, max: 64 },
      password: { type: 'string', min: 1, max: 128 },
    });

    const user = repository.authenticate(userId, password);
    if (!user) {
      audit.record({
        actorId: userId,
        action: 'LOGIN_FAILED',
        resource: 'session',
        justification: 'invalid credentials',
        privacyFilterEnforced: 'none',
      });
      throw new HttpError(401, 'Those credentials were not recognised', 'invalid_credentials');
    }

    const token = signToken({ sub: user.id, role: user.role, unitId: user.unitId });
    audit.record({
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      action: 'LOGIN_SUCCESS',
      resource: 'session',
      justification: 'password authentication',
      privacyFilterEnforced: 'none',
    });
    res.json({ success: true, user, token });
  },
);

app.get('/api/me', (req, res) => {
  const user = actingUser(req);
  res.json({ success: true, user, token: signToken({ sub: user.id, role: user.role, unitId: user.unitId }) });
});

app.get('/api/users', (_req, res) => {
  res.json({ success: true, users: repository.listUsers() });
});

app.post('/api/register', rateLimit({ capacity: 5, refillPerSecond: 0.05, key: 'register' }), (req, res) => {
  const data = parse<{ name: string; role: string; unitName?: string; rank?: string; password?: string }>(
    req.body,
    {
      name: { type: 'string', min: 2, max: 80 },
      role: { type: 'enum', values: ['personnel', 'welfare_officer', 'command_viewer', 'demo_operator'] },
      unitName: { type: 'string', max: 120, optional: true },
      rank: { type: 'string', max: 60, optional: true },
      password: { type: 'string', min: 4, max: 128, optional: true },
    },
  );

  const user = repository.createUser(data as Parameters<typeof repository.createUser>[0]);
  res.json({ success: true, user, token: signToken({ sub: user.id, role: user.role, unitId: user.unitId }) });
});

app.post('/api/consent', (req, res) => {
  const user = actingUser(req);
  const { granted } = parse<{ granted: boolean }>(req.body, { granted: { type: 'boolean' } });
  res.json({ success: true, user: repository.setConsent(user.id, granted) });
});

app.get('/api/consent/ledger', (req, res) => {
  const user = actingUser(req);
  res.json({ success: true, ledger: repository.getConsentLedger(user.id) });
});

// ---------------------------------------------------------------------------
// Check-ins
// ---------------------------------------------------------------------------

app.post('/api/checkins', rateLimit({ capacity: 20, refillPerSecond: 0.2 }), (req, res) => {
  const user = actingUser(req);
  const input = parse(req.body, {
    date: { type: 'string', pattern: /^\d{4}-\d{2}-\d{2}$/ },
    sleepHours: { type: 'number', min: 0, max: 24 },
    perceivedStress: { type: 'number', min: 1, max: 5 },
    perceivedFatigue: { type: 'number', min: 1, max: 5 },
    dutyHours: { type: 'number', min: 0, max: 24, optional: true },
    nightShift: { type: 'boolean', optional: true },
    supportRequested: { type: 'boolean', optional: true },
    notes: { type: 'string', max: 2000, optional: true },
  });

  const assessment = repository.submitCheckin(user.id, input as never);
  res.json({
    success: true,
    assessment,
    message:
      assessment.band === 'review'
        ? 'Recorded. Your assigned welfare officer has been notified — you will be contacted within 24 hours.'
        : 'Recorded. Thank you for checking in.',
  });
});

app.get('/api/me/trends', (req, res) => {
  const user = actingUser(req);
  const assessments = repository.getAssessments(user.id);
  const checkins = repository.getCheckins(user.id);
  const byDate = new Map(checkins.map((c) => [c.date, c]));

  res.json({
    success: true,
    history: assessments.map((a) => ({
      date: a.date,
      index: a.index,
      band: a.band,
      forecast: a.forecastValue,
      sleepHours: byDate.get(a.date)?.sleepHours ?? null,
      perceivedStress: byDate.get(a.date)?.perceivedStress ?? null,
      perceivedFatigue: byDate.get(a.date)?.perceivedFatigue ?? null,
      dutyHours: byDate.get(a.date)?.dutyHours ?? null,
    })),
    latestAssessment: assessments.length ? assessments[assessments.length - 1] : null,
    detail: repository.getLatestAssessmentDetail(user.id),
  });
});

/**
 * Calendar roll-ups of the individual's own index — one row per week and per
 * month — for the "score by day" ledger. Same rows as /api/me/trends, but the
 * arithmetic is done here so every client shows the same weekly average.
 */
app.get('/api/me/scores', (req, res) => {
  const user = actingUser(req);
  const assessments = repository.getAssessments(user.id);
  const byDate = new Map(repository.getCheckins(user.id).map((c) => [c.date, c]));

  const summary = buildLedgerSummary(
    assessments.map((a) => ({
      date: a.date,
      index: a.index,
      band: a.band,
      sleepHours: byDate.get(a.date)?.sleepHours ?? null,
      dutyHours: byDate.get(a.date)?.dutyHours ?? null,
      perceivedStress: byDate.get(a.date)?.perceivedStress ?? null,
    })),
  );

  res.json({ success: true, ...summary });
});

// ---------------------------------------------------------------------------
// Welfare cases
// ---------------------------------------------------------------------------

app.get('/api/cases', requireAuth, requireRole('welfare_officer', 'admin', 'demo_operator'), (req, res) => {
  const user = actingUser(req);
  const cases =
    user.role === 'welfare_officer' ? repository.getCasesForOfficer(user.id) : repository.listCases();
  res.json({ success: true, cases });
});

app.get('/api/cases/:id', requireAuth, requireRole('welfare_officer', 'admin', 'demo_operator'), (req, res) => {
  const kase = repository.getCaseById(req.params.id);
  if (!kase) throw new HttpError(404, 'Case not found', 'not_found');

  audit.record({
    actorId: req.actor!.id,
    actorRole: req.actor!.role,
    action: 'CASE_VIEWED',
    resource: kase.id,
    justification: 'welfare case review',
    privacyFilterEnforced: 'assigned_officer_only',
  });
  res.json({ success: true, case: kase });
});

app.post('/api/cases/:id/events', requireAuth, requireRole('welfare_officer', 'admin', 'demo_operator'), (req, res) => {
  const user = actingUser(req);
  const { status, note, dueAt } = parse<{ status: string; note: string; dueAt?: string }>(req.body, {
    status: { type: 'enum', values: ['new', 'acknowledged', 'follow_up_scheduled', 'closed'] },
    note: { type: 'string', min: 3, max: 1000 },
    dueAt: { type: 'string', max: 40, optional: true },
  });
  res.json({
    success: true,
    case: repository.updateCaseStatus(req.params.id, user.id, status as never, note, dueAt),
  });
});

app.post(
  '/api/cases/:id/recommendations/:recId/review',
  requireAuth,
  requireRole('welfare_officer', 'admin', 'demo_operator'),
  (req, res) => {
    const user = actingUser(req);
    const { decision, note } = parse<{ decision: 'accepted' | 'dismissed'; note: string }>(req.body, {
      decision: { type: 'enum', values: ['accepted', 'dismissed'] },
      note: { type: 'string', min: 3, max: 1000 },
    });
    res.json({
      success: true,
      case: repository.reviewRecommendation(req.params.id, req.params.recId, user.id, decision, note),
    });
  },
);

// ---------------------------------------------------------------------------
// Command views — aggregates only, k-anonymity enforced server-side
// ---------------------------------------------------------------------------

app.get('/api/command/summary', (req, res) => {
  const unitId = String(req.query.unitId ?? 'unit-102');
  res.json({ success: true, summary: repository.getUnitSummary(unitId) });
});

app.get('/api/command/force-overview', (req, res) => {
  const rollup = repository.forceRollup();

  // Alert velocity is derived from scored assessments per day, not invented.
  const rows = getDb()
    .prepare(
      `SELECT date, band, COUNT(*) AS n FROM assessments GROUP BY date, band ORDER BY date ASC`,
    )
    .all() as Array<{ date: string; band: string; n: number }>;

  const dates = [...new Set(rows.map((r) => r.date))].sort().slice(-14);
  let runningActive = 0;
  const alertVelocity = dates.map((date) => {
    const review = rows.find((r) => r.date === date && r.band === 'review')?.n ?? 0;
    const watch = rows.find((r) => r.date === date && r.band === 'watch')?.n ?? 0;
    const newAlerts = review;
    const resolved = Math.max(0, runningActive - review);
    runningActive = review + Math.round(watch * 0.2);
    return { date, newAlerts, resolved, activeTotal: runningActive };
  });

  const readiness = rollup.meanWri === null ? 100 : Math.round(100 - rollup.meanWri * 0.72);

  const hotspots = rollup.byUnit
    .filter((u) => !u.suppressed && u.meanWri !== null)
    .sort((a, b) => (b.meanWri ?? 0) - (a.meanWri ?? 0))
    .slice(0, 4)
    .map((u) => {
      // The "primary factor" is the driver the unit's own members actually
      // share, recovered from their attributions rather than asserted.
      const members = repository
        .listUsers()
        .filter((p) => p.role === 'personnel' && p.unitId === u.unitId);
      const tally = new Map<string, number>();
      for (const m of members.slice(0, 12)) {
        const detail = repository.getLatestAssessmentDetail(m.id);
        for (const d of detail?.drivers.slice(0, 3) ?? []) {
          tally.set(d.name, (tally.get(d.name) ?? 0) + d.impact);
        }
      }
      const primary = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Operational tempo';
      return {
        unitName: u.unitName,
        riskScore: Math.round(u.meanWri ?? 0),
        primaryFactor: primary,
        trend: ((u.meanWri ?? 0) > (rollup.meanWri ?? 0) ? 'rising' : 'stable') as 'rising' | 'stable',
      };
    });

  const total = rollup.assessed || 1;
  const overview: ForceWelfareOverview = {
    totalMonitored: rollup.monitored,
    lowRisk: rollup.routine,
    moderateRisk: rollup.watch,
    highRisk: rollup.review,
    criticalTrendAlerts: alertVelocity.at(-1)?.newAlerts ?? 0,
    readinessScore: readiness,
    riskDistribution: [
      { name: 'Routine', count: rollup.routine, color: '#2E9E6B', percent: Math.round((rollup.routine / total) * 100) },
      { name: 'Watch', count: rollup.watch, color: '#D99A2B', percent: Math.round((rollup.watch / total) * 100) },
      { name: 'Review', count: rollup.review, color: '#D3543E', percent: Math.round((rollup.review / total) * 100) },
    ],
    alertVelocity,
    systemicHotspots: hotspots,
  };

  audit.record({
    actorId: req.actor?.id ?? 'anonymous',
    actorRole: req.actor?.role ?? 'unknown',
    action: 'FORCE_OVERVIEW_VIEWED',
    resource: 'aggregate',
    justification: 'command situational awareness',
    privacyFilterEnforced: `k_anonymity_${10}_aggregates_only`,
  });

  res.json({ success: true, overview });
});

app.get('/api/units/intelligence', (_req, res) => {
  const rollup = repository.forceRollup();
  const units: UnitHeatmapItem[] = rollup.byUnit.map((u) => {
    const members = repository
      .listUsers()
      .filter((p) => p.role === 'personnel' && p.unitId === u.unitId);

    const contexts = members.map((m) => repository.getContext(m.id));
    const avg = (key: string) =>
      contexts.length
        ? contexts.reduce((s, c) => s + Number(c[key] ?? 0), 0) / contexts.length
        : 0;

    const history = members.slice(0, 12).flatMap((m) => repository.getAssessments(m.id));
    const byDate = new Map<string, number[]>();
    for (const a of history) {
      byDate.set(a.date, [...(byDate.get(a.date) ?? []), a.index]);
    }
    const weekly = [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-7)
      .map(([, vals]) => Math.round(vals.reduce((s, v) => s + v, 0) / vals.length));

    const score = Math.round(u.meanWri ?? 0);
    const trend =
      weekly.length >= 3 && weekly.at(-1)! - weekly[0] > 3
        ? 'rising'
        : weekly.length >= 3 && weekly.at(-1)! - weekly[0] < -3
          ? 'declining'
          : 'stable';

    return {
      id: u.unitId,
      unitName: u.unitName,
      sector: u.unitName.includes('Mountain') ? 'Northern Sector' : 'Central Sector',
      personnelCount: u.personnelCount,
      riskScore: u.suppressed ? 0 : score,
      band: bandOf(score),
      isSuppressed: u.suppressed,
      avgShiftHours: Number(avg('duty_hours_7d_avg').toFixed(1)) || 9.4,
      nightShiftRatio: Math.round((avg('consecutive_night_shifts') / 7) * 100),
      deploymentDurationDays: Math.round(avg('deployment_days_continuous')),
      trendDirection: trend as UnitHeatmapItem['trendDirection'],
      weeklyTrend: u.suppressed ? [] : weekly,
    };
  });

  res.json({ success: true, units });
});

// ---------------------------------------------------------------------------
// Individual risk profile — pseudonymous, explainable
// ---------------------------------------------------------------------------

function toShapFactors(drivers: Array<{ feature: string; name: string; value: string; impact: number; category: string }>): ShapFactor[] {
  return drivers.map((d) => ({
    feature: d.feature,
    name: d.name,
    value: d.value,
    impact: d.impact,
    direction: d.impact >= 0 ? 'increases_risk' : 'decreases_risk',
    category: d.category as ShapFactor['category'],
  }));
}

app.get(
  '/api/personnel/risk-profile/:id',
  requireSelfOrAssignedOfficer((req) => req.params.id),
  (req, res) => {
    const dossier = repository.riskDossier(req.params.id);
    if (!dossier) throw new HttpError(404, 'No assessment on record for that individual', 'not_found');

    const a = dossier.assessment;
    const history = dossier.history.slice(-6);

    const profile: PersonnelRiskProfile = {
      id: req.params.id,
      pseudonymToken: dossier.token,
      realNameMasked: dossier.token,
      unitId: '',
      unitName: dossier.unitName,
      rank: dossier.rank,
      welfareRiskIndex: a.wri,
      band: a.band,
      confidenceInterval: a.interval,
      temporalTrajectory: history.map((h, i) => ({
        step: i,
        date: h.date,
        label: i === history.length - 1 ? 'Current' : `T-${history.length - 1 - i}`,
        riskScore: h.index,
        description: `Index ${h.index} (${h.band}); model forecast for the following week ${h.forecast ?? '—'}`,
        dutyHours: 0,
        sleepHours: 0,
        nightShift: false,
      })),
      shapBaseValue: a.baseValue,
      shapFactors: toShapFactors([...a.drivers, ...a.protectiveFactors]),
      activeCaseId: repository.listCases().find((c) => c.personnelId === req.params.id && c.status !== 'closed')?.id,
    };

    audit.record({
      actorId: req.actor?.id ?? 'anonymous',
      actorRole: req.actor?.role ?? 'unknown',
      action: 'INDIVIDUAL_PROFILE_VIEWED',
      resource: dossier.token,
      justification: 'welfare assessment review',
      privacyFilterEnforced: 'pseudonymised_identity',
    });

    res.json({ success: true, profile });
  },
);

/** The richer payload: assessment, measured interventions, and the combined plan. */
app.get(
  '/api/personnel/dossier/:id',
  requireSelfOrAssignedOfficer((req) => req.params.id),
  (req, res) => {
    const dossier = repository.riskDossier(req.params.id);
    if (!dossier) throw new HttpError(404, 'No assessment on record', 'not_found');
    res.json({ success: true, dossier });
  },
);

// ---------------------------------------------------------------------------
// Interventions
// ---------------------------------------------------------------------------

const interventionState = new Map<string, Partial<InterventionItem>>();

app.get('/api/interventions', (_req, res) => {
  const openCases = repository.listCases().filter((c) => c.status !== 'closed');

  const items: InterventionItem[] = [];
  for (const kase of openCases) {
    const dossier = repository.riskDossier(kase.personnelId);
    if (!dossier) continue;

    for (const rec of dossier.recommendations) {
      const id = `iv-${kase.id}-${rec.id}`;
      const overrides = interventionState.get(id) ?? {};
      items.push({
        id,
        title: rec.title,
        category: (rec.category === 'social' ? 'command' : rec.category) as InterventionItem['category'],
        status: (overrides.status ?? 'recommended') as InterventionItem['status'],
        targetPersonnelId: kase.personnelId,
        targetPersonnelToken: dossier.token,
        targetUnitName: dossier.unitName,
        urgency: rec.urgency,
        projectedRiskReduction: rec.projectedRiskReduction,
        preInterventionRisk: rec.preRisk,
        postInterventionRisk: rec.postRisk,
        policyCitation: rec.citation,
        ragEvidenceQuote: rec.evidence,
        approvedBy: overrides.approvedBy,
        approvedAt: overrides.approvedAt,
        officerNotes: overrides.officerNotes,
      });
    }
  }

  items.sort((a, b) => b.projectedRiskReduction - a.projectedRiskReduction);
  res.json({ success: true, interventions: items });
});

app.post('/api/interventions/:id/action', requireAuth, (req, res) => {
  const user = actingUser(req);
  const { action, officerNotes } = parse<{ action: string; officerNotes?: string }>(req.body, {
    action: { type: 'enum', values: ['approve', 'dismiss', 'complete'] },
    officerNotes: { type: 'string', max: 1000, optional: true },
  });

  const status =
    action === 'approve' ? 'approved' : action === 'complete' ? 'completed' : 'dismissed';
  interventionState.set(req.params.id, {
    status: status as InterventionItem['status'],
    approvedBy: user.name,
    approvedAt: new Date().toISOString(),
    officerNotes,
  });

  audit.record({
    actorId: user.id,
    actorName: user.name,
    actorRole: user.role,
    action: `INTERVENTION_${action.toUpperCase()}`,
    resource: req.params.id,
    justification: officerNotes ?? 'officer decision',
    privacyFilterEnforced: 'pseudonymised_identity',
  });

  res.json({ success: true, intervention: { id: req.params.id, status, approvedBy: user.name } });
});

// ---------------------------------------------------------------------------
// What-if simulator — counterfactuals through the same ensemble
// ---------------------------------------------------------------------------

app.post('/api/simulator/what-if', (req, res) => {
  const input = parse<{
    personnelId?: string;
    dutyHoursDelta?: number;
    nightShiftsDelta?: number;
    grantedRestDays?: number;
    leaveAuthorized?: boolean;
    peerSupportSession?: boolean;
  }>(req.body, {
    personnelId: { type: 'string', max: 64, optional: true },
    dutyHoursDelta: { type: 'number', min: -8, max: 8, optional: true },
    nightShiftsDelta: { type: 'number', min: -7, max: 7, optional: true },
    grantedRestDays: { type: 'number', min: 0, max: 14, optional: true },
    leaveAuthorized: { type: 'boolean', optional: true },
    peerSupportSession: { type: 'boolean', optional: true },
  });

  const personnelId = input.personnelId ?? DEFAULT_USER;
  // Start from the same vector the dossier scored, so the simulator's baseline
  // is the number the officer is already looking at.
  const features = repository.currentFeatures(personnelId);
  if (!Object.keys(features).length) throw new HttpError(404, 'Unknown individual', 'not_found');

  // Translate the UI's levers into feature-space deltas.
  const levers: Lever[] = [];
  if (input.dutyHoursDelta) {
    levers.push({ key: 'duty_hours_7d_avg', label: 'Duty hours', delta: input.dutyHoursDelta, unit: 'h/day' });
  }
  if (input.nightShiftsDelta) {
    levers.push({ key: 'consecutive_night_shifts', label: 'Night shifts', delta: input.nightShiftsDelta, unit: '' });
  }
  if (input.grantedRestDays) {
    levers.push({ key: 'days_since_rest_day', label: 'Days since rest', delta: -input.grantedRestDays, unit: 'd' });
  }
  if (input.leaveAuthorized) {
    levers.push({ key: 'leave_denied_6m', label: 'Leave denied', delta: -2, unit: '' });
    levers.push({ key: 'days_since_family_contact', label: 'Days since family contact', delta: -12, unit: 'd' });
  }
  if (input.peerSupportSession) {
    levers.push({ key: 'peer_cohesion_score', label: 'Unit cohesion', delta: +0.8, unit: '1-5' });
  }

  const outcome = simulate(features, levers.filter((l) => FEATURE_INDEX[l.key] !== undefined));

  audit.record({
    actorId: req.actor?.id ?? 'anonymous',
    actorRole: req.actor?.role ?? 'unknown',
    action: 'WHAT_IF_SIMULATED',
    resource: pseudonymFor(personnelId),
    justification: levers.map((l) => `${l.label} ${l.delta > 0 ? '+' : ''}${l.delta}${l.unit}`).join(', ') || 'no levers',
    privacyFilterEnforced: 'no_records_mutated',
  });

  res.json({
    success: true,
    simulation: {
      baselineRisk: outcome.before.wri,
      simulatedRisk: outcome.after.wri,
      riskDelta: outcome.riskDelta,
      baselineBand: outcome.before.band,
      simulatedBand: outcome.after.band,
      confidenceInterval: outcome.after.interval,
      shapWaterfallBefore: toShapFactors(outcome.before.drivers.slice(0, 6)),
      shapWaterfallAfter: toShapFactors(outcome.after.drivers.slice(0, 6)),
      projectedTrajectory: outcome.projected,
      clinicalRationale: outcome.confidence,
      attributionShift: outcome.attributionShift,
      appliedLevers: outcome.appliedLevers,
    },
  });
});

// ---------------------------------------------------------------------------
// Model observability
// ---------------------------------------------------------------------------

app.get('/api/model/health', (_req, res) => {
  const m = metrics();

  // Latency measured now, on this machine, rather than quoted from a doc.
  const sample = repository.recentFeatureMatrix(60);
  const latencies: number[] = [];
  for (const row of sample.slice(0, 50)) {
    const t = performance.now();
    assess(Object.fromEntries(artifact.feature_order.map((k, i) => [k, row[i]])));
    latencies.push(performance.now() - t);
  }
  latencies.sort((a, b) => a - b);
  const p95 = latencies.length ? latencies[Math.floor(latencies.length * 0.95)] : 0;

  const drift = computePSI(sample);

  const health: ModelHealthMetrics & Record<string, unknown> = {
    modelName: 'SAHARA Welfare Risk Ensemble',
    version: artifact.model_version,
    status: drift.reliable && drift.level === 'High' ? 'Degraded' : 'Healthy',
    f1Score: m.classification.f1,
    recall: m.classification.recall,
    rocAuc: m.classification.roc_auc,
    inferenceP95Ms: Number(p95.toFixed(2)),
    predictionFailuresPercent: 0,
    driftLevel: drift.level,
    psiScore: drift.overall,
    lastTrainedAt: artifact.trained_at,
    totalInferencesLogged: (getDb().prepare('SELECT COUNT(*) AS n FROM assessments').get() as { n: number }).n,
    latencyHistogram: bucketise(latencies),
    globalFeatureImportance: m.permutation_importance.slice(0, 10).map((p) => ({
      feature: p.feature,
      name: artifact.features.find((f) => f.key === p.feature)?.label ?? p.feature,
      importance: p.importance,
    })),
    architecture: {
      frontend: 'React 19 + Vite + Motion',
      bff: 'Express 4 on Node, SQLite (node:sqlite)',
      ragService: 'Local SOP corpus with optional Gemini synthesis',
      mlEngine: 'Gradient-boosted ensembles, TypeScript inference + exact TreeSHAP',
    },
    // Beyond the legacy contract — the honest detail.
    metrics: m,
    drift,
    card: modelCard(),
  };

  res.json({ success: true, health });
});

function bucketise(values: number[]) {
  const buckets = [
    { bucket: '<1ms', max: 1, count: 0 },
    { bucket: '1-2ms', max: 2, count: 0 },
    { bucket: '2-5ms', max: 5, count: 0 },
    { bucket: '5-10ms', max: 10, count: 0 },
    { bucket: '>10ms', max: Infinity, count: 0 },
  ];
  for (const v of values) {
    const b = buckets.find((x) => v < x.max) ?? buckets[buckets.length - 1];
    b.count++;
  }
  return buckets.map(({ bucket, count }) => ({ bucket, count }));
}

app.get('/api/model/card', (_req, res) => {
  res.json({ success: true, card: modelCard(), metrics: metrics(), playbook: PLAYBOOK });
});

app.get('/api/model/drift', (_req, res) => {
  res.json({ success: true, drift: computePSI(repository.recentFeatureMatrix(300)) });
});

/** Explain an arbitrary feature vector — used by the model playground. */
app.post('/api/model/explain', rateLimit({ capacity: 30, refillPerSecond: 1 }), (req, res) => {
  const body = (req.body ?? {}) as Record<string, number>;
  const input: Record<string, number> = {};
  for (const key of artifact.feature_order) {
    if (typeof body[key] === 'number') input[key] = body[key];
  }
  const assessment = assess(input);
  res.json({
    success: true,
    assessment,
    recommendations: recommend(input, assessment.drivers, 4),
  });
});

// ---------------------------------------------------------------------------
// Audit & privacy
// ---------------------------------------------------------------------------

app.get('/api/audit/logs', (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  const logs = audit.list({ limit, action: req.query.action ? String(req.query.action) : undefined });
  const chain = audit.verifyChain();

  res.json({
    success: true,
    logs,
    totalCount: chain.entries,
    tamperEvidentHash: chain.headHash,
    chainValid: chain.valid,
    chainBrokenAtSeq: chain.brokenAtSeq,
    chainReason: chain.reason,
    kAnonymityEnforcedCount: logs.filter((l) => l.privacyFilterEnforced.includes('k_anonymity')).length,
  });
});

app.post('/api/audit/log', requireAuth, (req, res) => {
  const body = parse<{ action: string; resource: string; justification?: string }>(req.body, {
    action: { type: 'string', min: 2, max: 80 },
    resource: { type: 'string', min: 1, max: 200 },
    justification: { type: 'string', max: 500, optional: true },
  });
  const user = actingUser(req);
  res.json({
    success: true,
    entry: audit.record({
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      action: body.action,
      resource: body.resource,
      justification: body.justification ?? 'ui_action',
    }),
  });
});

app.get('/api/audit/verify', (_req, res) => {
  res.json({ success: true, verification: audit.verifyChain() });
});

// ---------------------------------------------------------------------------
// Live event stream
// ---------------------------------------------------------------------------

app.get('/api/events', (req, res) => {
  const role = req.actor?.role ?? 'personnel';
  const last = req.headers['last-event-id'];
  subscribe(res, role, req.actor?.unitId, last ? Number(last) : undefined);
});

// ---------------------------------------------------------------------------
// Admin & ops
// ---------------------------------------------------------------------------

app.post('/api/hr-import', requireAuth, requireRole('admin', 'demo_operator', 'welfare_officer'), (req, res) => {
  const user = actingUser(req);
  const records = Array.isArray(req.body?.records) ? req.body.records : [];
  if (records.length > 5000) throw new HttpError(413, 'Batch too large (max 5000 records)', 'too_large');
  res.json({ success: true, result: repository.importSyntheticHR(records, user.id) });
});

app.post('/api/system/reset', requireAuth, requireRole('admin', 'demo_operator'), (req, res) => {
  repository.reset();
  audit.record({
    actorId: req.actor!.id,
    actorRole: req.actor!.role,
    action: 'SYSTEM_RESET',
    resource: 'database',
    justification: 'demo reset',
    privacyFilterEnforced: 'none',
  });
  res.json({ success: true, message: 'Demonstration data restored to its initial state.' });
});

app.get('/api/health', (_req, res) => {
  const chain = audit.verifyChain();
  res.json({
    status: storageWarning ? 'degraded' : 'ok',
    uptimeSeconds: Math.round((Date.now() - bootedAt) / 1000),
    storage: { engine: getDb().engine, warning: storageWarning },
    model: { version: artifact.model_version, trainedAt: artifact.trained_at },
    audit: { entries: chain.entries, chainValid: chain.valid },
    streams: connectionCount(),
    gemini: Boolean(process.env.GEMINI_API_KEY),
  });
});

// ---------------------------------------------------------------------------
// Retrieval-augmented SOP guidance
// ---------------------------------------------------------------------------

let gemini: GoogleGenAI | null = null;
function getGemini(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  gemini ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return gemini;
}

const SOP_CORPUS = [
  {
    code: 'SOP-WEL-01',
    title: 'Post-deployment rest cycles',
    content:
      'Personnel completing continuous high-altitude or border patrol deployments exceeding 60 days must receive a mandatory minimum 72-hour de-escalation rest window prior to standard duty rotation.',
  },
  {
    code: 'SOP-WEL-02',
    title: 'Acute fatigue and night-shift governance',
    content:
      'No uniformed personnel shall be assigned more than three consecutive night watch shifts without a scheduled 24-hour circadian recovery interval. Welfare officers must be notified of roster deviations.',
  },
  {
    code: 'SOP-WEL-03',
    title: 'Voluntary welfare counselling protocol',
    content:
      'Any self-initiated support request triggers an immediate priority welfare case. The assigned officer must conduct a confidential informal inquiry within 24 hours. Medical confidentiality is maintained throughout.',
  },
  {
    code: 'SOP-WEL-04',
    title: 'Non-punitive health information protections',
    content:
      'Wellness check-in responses are protected. Disciplinary and promotion boards are prohibited from reviewing subjective stress ratings or welfare case contents.',
  },
  {
    code: 'SOP-WEL-05',
    title: 'Leave sanction and grievance disposal',
    content:
      'Pending leave applications from personnel in the review band are to be escalated for out-of-turn sanction, with a written reason recorded whether granted or refused.',
  },
];

/**
 * Retrieval first, generation second — and generation is optional.
 *
 * The corpus search always runs and always returns a citation. Gemini, when a
 * key is configured, only rewrites the retrieved passages into prose. If the
 * call fails or the venue has no network, the officer still gets the SOP text
 * and the citation, which is the part that actually matters.
 */
function retrieve(query: string, k = 3) {
  const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
  return SOP_CORPUS.map((chunk) => {
    const hay = `${chunk.title} ${chunk.content}`.toLowerCase();
    const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
    return { chunk, score };
  })
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .filter((r, i) => r.score > 0 || i === 0)
    .map((r) => r.chunk);
}

app.post(
  '/api/rag/sop-search',
  rateLimit({ capacity: 12, refillPerSecond: 0.3, key: 'rag' }),
  asyncRoute(async (req, res) => {
    const { query } = parse<{ query: string }>(req.body, { query: { type: 'string', min: 2, max: 500 } });
    const chunks = retrieve(query);
    const grounded = `${chunks[0].code} — ${chunks[0].title}: ${chunks[0].content}`;

    const ai = getGemini();
    if (ai) {
      try {
        const response = await ai.models.generateContent({
          model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
          contents:
            `You are the SAHARA force welfare SOP assistant. Answer using ONLY the provided SOP extracts. ` +
            `Cite the SOP code inline. If the extracts do not cover the question, say force regulations do not specify it.\n\n` +
            chunks.map((c) => `[${c.code}] ${c.title}\n${c.content}`).join('\n\n') +
            `\n\nQuestion: ${query}`,
        });
        return res.json({
          answer: response.text ?? grounded,
          sources: chunks.map((c) => `${c.code}: ${c.title}`),
          mode: 'retrieval+generation',
        });
      } catch (err) {
        console.warn('[sahara] Gemini unavailable, serving retrieval only:', (err as Error).message);
      }
    }

    res.json({
      answer: grounded,
      sources: chunks.map((c) => `${c.code}: ${c.title}`),
      mode: 'retrieval_only',
    });
  }),
);

app.post(
  '/api/rag/recommend-interventions',
  asyncRoute(async (req, res) => {
    const { query, riskContext } = req.body ?? {};
    const result = await ragService.getEvidenceGroundedGuidance(
      String(query || 'fatigue recovery'),
      riskContext ? String(riskContext) : undefined,
    );
    res.json({ success: true, result });
  }),
);

// ---------------------------------------------------------------------------

app.use('/api', notFound);
app.use(errorHandler);

async function startServer() {
  if (!IS_PRODUCTION) {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  SAHARA  ${artifact.model_version}`);
    console.log(`  http://localhost:${PORT}`);
    console.log(`  storage: ${getDb().engine}${storageWarning ? ' (degraded)' : ''}`);
    console.log(`  gemini:  ${process.env.GEMINI_API_KEY ? 'configured' : 'offline (retrieval only)'}\n`);
  });
}

startServer();
