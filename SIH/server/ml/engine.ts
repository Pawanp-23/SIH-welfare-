/**
 * SAHARA inference engine — the domain-facing layer over the raw ensembles.
 *
 * Everything the product shows a human comes through here: the Welfare Risk
 * Index, its prediction interval, the seven-day forecast, the escalation
 * probability, the SHAP waterfall, counterfactual simulation and drift.
 *
 * Design rules this file follows:
 *   - Never invent a number. If a feature is missing it is imputed from the
 *     training mean and the assessment's `coverage` drops, visibly.
 *   - Never explain a prediction with anything but that prediction's own SHAP
 *     values. Copy is generated from the attributions, not chosen by a switch
 *     statement on the band.
 *   - Every recommendation carries the driver that produced it, so a welfare
 *     officer can disagree with the reason rather than just the conclusion.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expectedRaw, predict, predictRaw, treeShap } from './gbm.js';
import type { ModelArtifact, ModelMetrics } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));


/**
 * Locate the model artifact.
 *
 * The file sits at `server/models/` in the repository, but the production
 * bundle runs from `dist/`, so a single module-relative path is wrong in one of
 * the two cases. Rather than duplicate the file at build time we try the
 * handful of places it can legitimately be and fail with a message that says
 * how to produce it.
 */
function resolveArtifact(): string {
  const candidates = [
    process.env.SAHARA_MODEL,
    join(here, '..', 'models', 'sahara-model-v2.json'),
    join(process.cwd(), 'server', 'models', 'sahara-model-v2.json'),
    join(here, 'models', 'sahara-model-v2.json'),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `Model artifact not found. Looked in:\n  ${candidates.join('\n  ')}\n` +
      `Run "npm run ml:all" to generate the cohort, train the ensembles and export it.`,
  );
}

export const artifact: ModelArtifact = JSON.parse(readFileSync(resolveArtifact(), 'utf8'));

export const FEATURE_ORDER = artifact.feature_order;
export const FEATURE_INDEX: Record<string, number> = Object.fromEntries(
  FEATURE_ORDER.map((k, i) => [k, i]),
);
export const FEATURE_META = Object.fromEntries(artifact.features.map((f) => [f.key, f]));
export const N_FEATURES = FEATURE_ORDER.length;

export type FeatureKey = string;
export type FeatureInput = Partial<Record<FeatureKey, number | boolean | null | undefined>>;

const EXPECTED = {
  wri: expectedRaw(artifact.models.wri),
  wri_7d: expectedRaw(artifact.models.wri_7d),
  escalation: expectedRaw(artifact.models.escalation),
};

const TRAIN_MEAN: number[] = FEATURE_ORDER.map((k) => artifact.drift_reference[k]?.mean ?? 0);
const TRAIN_STD: number[] = FEATURE_ORDER.map((k) => artifact.drift_reference[k]?.std ?? 1);

export type Band = 'routine' | 'watch' | 'review';

export function bandOf(score: number): Band {
  if (score >= artifact.bands.review) return 'review';
  if (score >= artifact.bands.watch) return 'watch';
  return 'routine';
}

// ---------------------------------------------------------------------------
// Feature assembly
// ---------------------------------------------------------------------------

export interface BuiltFeatures {
  vector: Float64Array;
  /** fraction of features that were actually observed rather than imputed */
  coverage: number;
  imputed: string[];
}

export function buildFeatures(input: FeatureInput): BuiltFeatures {
  const vector = new Float64Array(N_FEATURES);
  const imputed: string[] = [];

  for (let i = 0; i < N_FEATURES; i++) {
    const key = FEATURE_ORDER[i];
    const raw = input[key];
    const value = typeof raw === 'boolean' ? (raw ? 1 : 0) : raw;
    if (value === null || value === undefined || Number.isNaN(value)) {
      vector[i] = TRAIN_MEAN[i];
      imputed.push(key);
    } else {
      vector[i] = value as number;
    }
  }

  return { vector, coverage: 1 - imputed.length / N_FEATURES, imputed };
}

/** Derive model features from the lightweight daily check-in a jawan submits. */
export function featuresFromCheckin(opts: {
  sleepHours: number;
  baselineSleep?: number;
  perceivedStress: number;
  perceivedFatigue: number;
  dutyHours?: number;
  nightShift?: boolean;
  consecutiveNightShifts?: number;
  daysSinceRestDay?: number;
  deploymentDays?: number;
  peerCohesion?: number;
  daysSinceFamilyContact?: number;
  hrvRmssd?: number;
  base?: FeatureInput;
}): FeatureInput {
  const baseline = opts.baselineSleep ?? 7.4;
  const duty = opts.dutyHours ?? 9.5;
  return {
    ...opts.base,
    sleep_hours_7d_avg: opts.sleepHours,
    sleep_debt_7d: Math.max(0, (baseline - opts.sleepHours) * 7),
    duty_hours_7d_avg: duty,
    overtime_hours_7d: Math.max(0, (duty - 8) * 7),
    perceived_stress: opts.perceivedStress,
    perceived_fatigue: opts.perceivedFatigue,
    consecutive_night_shifts:
      opts.consecutiveNightShifts ?? (opts.nightShift ? 1 : 0),
    days_since_rest_day: opts.daysSinceRestDay ?? opts.base?.days_since_rest_day,
    deployment_days_continuous: opts.deploymentDays ?? opts.base?.deployment_days_continuous,
    peer_cohesion_score: opts.peerCohesion ?? opts.base?.peer_cohesion_score,
    days_since_family_contact:
      opts.daysSinceFamilyContact ?? opts.base?.days_since_family_contact,
    hrv_rmssd_ms: opts.hrvRmssd ?? opts.base?.hrv_rmssd_ms,
  };
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

export interface Attribution {
  feature: string;
  name: string;
  value: string;
  rawValue: number;
  impact: number;
  direction: 'increases_risk' | 'decreases_risk';
  category: string;
  /** where this value sits in the training distribution, 0-1 */
  percentile: number;
  imputed: boolean;
}

function formatValue(key: string, v: number): string {
  const meta = FEATURE_META[key];
  const unit = meta?.unit ?? '';
  if (unit === '' && (v === 0 || v === 1)) return v === 1 ? 'Yes' : 'No';
  const decimals = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
  const num = Number(v.toFixed(decimals)).toString();
  return unit ? `${num} ${unit}` : num;
}

function percentileOf(key: string, v: number): number {
  const ref = artifact.drift_reference[key];
  if (!ref) return 0.5;
  const { edges } = ref;
  if (v <= edges[0]) return 0;
  if (v >= edges[edges.length - 1]) return 1;
  for (let i = 1; i < edges.length; i++) {
    if (v <= edges[i]) {
      const span = edges[i] - edges[i - 1] || 1;
      return (i - 1 + (v - edges[i - 1]) / span) / (edges.length - 1);
    }
  }
  return 1;
}

export function attribute(
  built: BuiltFeatures,
  model: 'wri' | 'wri_7d' | 'escalation' = 'wri',
  topK = 8,
): Attribution[] {
  const phi = treeShap(artifact.models[model], built.vector, N_FEATURES);
  const imputedSet = new Set(built.imputed);

  const rows: Attribution[] = [];
  for (let i = 0; i < N_FEATURES; i++) {
    const key = FEATURE_ORDER[i];
    rows.push({
      feature: key,
      name: FEATURE_META[key]?.label ?? key,
      value: formatValue(key, built.vector[i]),
      rawValue: built.vector[i],
      impact: Number(phi[i].toFixed(3)),
      direction: phi[i] >= 0 ? 'increases_risk' : 'decreases_risk',
      category: FEATURE_META[key]?.category ?? 'operational',
      percentile: Number(percentileOf(key, built.vector[i]).toFixed(3)),
      imputed: imputedSet.has(key),
    });
  }

  return rows.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)).slice(0, topK);
}

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

export interface Assessment {
  wri: number;
  band: Band;
  /** genuine 80% prediction interval from the quantile ensembles */
  interval: [number, number];
  forecast7d: number;
  forecastBand: Band;
  trajectory: 'rising' | 'stable' | 'improving';
  escalationProbability: number;
  escalationFlag: boolean;
  escalationThreshold: number;
  baseValue: number;
  coverage: number;
  imputed: string[];
  drivers: Attribution[];
  protectiveFactors: Attribution[];
  categoryBreakdown: Array<{ category: string; impact: number }>;
  modelVersion: string;
  computedInMs: number;
}

export function assess(input: FeatureInput, topK = 8): Assessment {
  const t0 = performance.now();
  const built = buildFeatures(input);

  const wriRaw = predictRaw(artifact.models.wri, built.vector);
  const wri = clamp(wriRaw, 0, 100);
  const lo = clamp(predictRaw(artifact.models.wri_q10, built.vector), 0, 100);
  const hi = clamp(predictRaw(artifact.models.wri_q90, built.vector), 0, 100);
  const f7 = clamp(predictRaw(artifact.models.wri_7d, built.vector), 0, 100);
  const pEsc = predict(artifact.models.escalation, built.vector);

  const all = attribute(built, 'wri', N_FEATURES);
  const drivers = all.filter((a) => a.impact > 0).slice(0, topK);
  const protective = all
    .filter((a) => a.impact < 0)
    .sort((a, b) => a.impact - b.impact)
    .slice(0, 4);

  // Correlated features split their credit between themselves — sleep debt and
  // average sleep describe the same underlying thing, so SHAP quite correctly
  // gives each a share. Rolling up by category gives a stable headline that
  // does not flip when two near-duplicate features trade places.
  const byCategory = new Map<string, number>();
  for (const a of all) {
    byCategory.set(a.category, (byCategory.get(a.category) ?? 0) + a.impact);
  }
  const categoryBreakdown = [...byCategory.entries()]
    .map(([category, impact]) => ({ category, impact: Number(impact.toFixed(2)) }))
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

  // Compare on the unclamped scale: a person pinned at the 100 ceiling would
  // otherwise look like they were "improving" the moment the forecast dipped
  // below the clamp.
  const delta = predictRaw(artifact.models.wri_7d, built.vector) - wriRaw;

  return {
    wri: round1(wri),
    band: bandOf(wri),
    interval: [round1(Math.min(lo, hi)), round1(Math.max(lo, hi))],
    forecast7d: round1(f7),
    forecastBand: bandOf(f7),
    trajectory: delta > 2.5 ? 'rising' : delta < -2.5 ? 'improving' : 'stable',
    escalationProbability: Number(pEsc.toFixed(4)),
    escalationFlag: pEsc >= artifact.escalation_threshold,
    escalationThreshold: artifact.escalation_threshold,
    baseValue: round1(EXPECTED.wri),
    coverage: Number(built.coverage.toFixed(3)),
    imputed: built.imputed,
    drivers,
    protectiveFactors: protective,
    categoryBreakdown,
    modelVersion: artifact.model_version,
    computedInMs: Number((performance.now() - t0).toFixed(3)),
  };
}

// ---------------------------------------------------------------------------
// Counterfactual simulation
// ---------------------------------------------------------------------------

export interface Lever {
  key: string;
  label: string;
  /** absolute change applied to the feature */
  delta: number;
  unit: string;
}

export interface SimulationOutcome {
  before: Assessment;
  after: Assessment;
  riskDelta: number;
  bandChanged: boolean;
  appliedLevers: Lever[];
  /** per-feature change in SHAP attribution, i.e. *why* the risk moved */
  attributionShift: Array<{ feature: string; name: string; before: number; after: number; shift: number }>;
  projected: Array<{ day: string; baseline: number; simulated: number }>;
  confidence: string;
}

export function simulate(input: FeatureInput, levers: Lever[]): SimulationOutcome {
  const before = assess(input, N_FEATURES);
  const mutated: FeatureInput = { ...input };

  const beforeBuilt = buildFeatures(input);
  for (const lever of levers) {
    const idx = FEATURE_INDEX[lever.key];
    if (idx === undefined) continue;
    mutated[lever.key] = beforeBuilt.vector[idx] + lever.delta;
  }

  // Keep derived features internally consistent: moving duty hours has to move
  // overtime too, or the counterfactual describes a physically impossible week.
  //
  // Two rules make this correct rather than merely plausible. First, a derived
  // feature is only recomputed when the feature it derives from was actually
  // touched by a lever — otherwise simulating "one fewer night shift" would
  // silently rewrite the person's sleep debt as well. Second, sleep debt is
  // rebuilt against *this individual's* implied baseline, recovered from their
  // own observed sleep and debt. Using the population's 7.4h baseline instead
  // hands a well-rested person 16 points of phantom debt and makes every
  // intervention look useless.
  const touched = new Set(levers.map((l) => l.key));

  if (touched.has('sleep_hours_7d_avg')) {
    const beforeSleep = beforeBuilt.vector[FEATURE_INDEX.sleep_hours_7d_avg];
    const beforeDebt = beforeBuilt.vector[FEATURE_INDEX.sleep_debt_7d];
    const impliedBaseline = beforeSleep + beforeDebt / 7;
    const sleep = Number(mutated.sleep_hours_7d_avg);
    if (Number.isFinite(sleep)) {
      mutated.sleep_debt_7d = Math.max(0, (impliedBaseline - sleep) * 7);
    }
  }

  if (touched.has('duty_hours_7d_avg')) {
    const duty = Number(mutated.duty_hours_7d_avg);
    if (Number.isFinite(duty)) {
      mutated.overtime_hours_7d = Math.max(0, (duty - 8) * 7);
    }
  }
  for (const key of ['consecutive_night_shifts', 'days_since_rest_day', 'days_since_family_contact', 'leave_denied_6m']) {
    const v = mutated[key];
    if (typeof v === 'number') mutated[key] = Math.max(0, v);
  }
  if (typeof mutated.peer_cohesion_score === 'number') {
    mutated.peer_cohesion_score = clamp(mutated.peer_cohesion_score, 1, 5);
  }

  const after = assess(mutated, N_FEATURES);

  const beforeMap = new Map(before.drivers.concat(before.protectiveFactors).map((d) => [d.feature, d]));
  const afterAll = attribute(buildFeatures(mutated), 'wri', N_FEATURES);
  const beforeAll = attribute(beforeBuilt, 'wri', N_FEATURES);
  const beforeIdx = new Map(beforeAll.map((d) => [d.feature, d.impact]));

  const attributionShift = afterAll
    .map((a) => ({
      feature: a.feature,
      name: a.name,
      before: beforeIdx.get(a.feature) ?? 0,
      after: a.impact,
      shift: Number((a.impact - (beforeIdx.get(a.feature) ?? 0)).toFixed(3)),
    }))
    .filter((r) => Math.abs(r.shift) > 0.05)
    .sort((a, b) => Math.abs(b.shift) - Math.abs(a.shift))
    .slice(0, 6);

  // Recovery is not instantaneous. We interpolate along a saturating curve
  // between today's risk and the counterfactual steady state, which matches
  // the sleep-recovery literature better than a straight line would.
  const projected = Array.from({ length: 8 }, (_, d) => {
    const t = d / 7;
    const ease = 1 - Math.exp(-2.4 * t);
    return {
      day: d === 0 ? 'Today' : `D+${d}`,
      baseline: round1(before.wri + (before.forecast7d - before.wri) * t),
      simulated: round1(before.wri + (after.wri - before.wri) * ease),
    };
  });

  void beforeMap;

  return {
    before,
    after,
    riskDelta: round1(after.wri - before.wri),
    bandChanged: after.band !== before.band,
    appliedLevers: levers,
    attributionShift,
    projected,
    confidence:
      `Counterfactual evaluated by the same ensemble that produced the baseline. ` +
      `80% prediction interval widens from ±${round1((before.interval[1] - before.interval[0]) / 2)} ` +
      `to ±${round1((after.interval[1] - after.interval[0]) / 2)} WRI points.`,
  };
}

// ---------------------------------------------------------------------------
// Drift (Population Stability Index)
// ---------------------------------------------------------------------------

export interface DriftReport {
  overall: number;
  level: 'Low' | 'Moderate' | 'High';
  features: Array<{ feature: string; name: string; psi: number; level: string }>;
  sampleSize: number;
  /** false when the batch is too small for PSI to mean anything */
  reliable: boolean;
  note: string;
}

/**
 * PSI compares a batch against ten training deciles. With fewer than ~200
 * observations most bins hold single digits, and the statistic reads "High
 * drift" purely from sampling noise. Reporting that as a degraded model would
 * be worse than reporting nothing, so below the floor we publish the numbers
 * and mark them unreliable rather than acting on them.
 */
const PSI_MIN_SAMPLE = 200;

export function computePSI(batch: Float64Array[]): DriftReport {
  const features: DriftReport['features'] = [];

  for (let i = 0; i < N_FEATURES; i++) {
    const key = FEATURE_ORDER[i];
    const ref = artifact.drift_reference[key];
    if (!ref || batch.length === 0) continue;

    const edges = ref.edges;
    const nBins = edges.length - 1;
    const counts = new Array(nBins).fill(0);
    for (const row of batch) {
      const v = row[i];
      let b = nBins - 1;
      for (let e = 1; e < edges.length; e++) {
        if (v <= edges[e]) {
          b = e - 1;
          break;
        }
      }
      counts[b]++;
    }

    let psi = 0;
    for (let b = 0; b < nBins; b++) {
      const actual = Math.max(counts[b] / batch.length, 1e-6);
      const expected = Math.max(ref.props[b] ?? 1 / nBins, 1e-6);
      psi += (actual - expected) * Math.log(actual / expected);
    }

    features.push({
      feature: key,
      name: FEATURE_META[key]?.label ?? key,
      psi: Number(psi.toFixed(4)),
      level: psi < 0.1 ? 'Low' : psi < 0.25 ? 'Moderate' : 'High',
    });
  }

  features.sort((a, b) => b.psi - a.psi);
  const overall = features.length
    ? Number((features.reduce((s, f) => s + f.psi, 0) / features.length).toFixed(4))
    : 0;

  const reliable = batch.length >= PSI_MIN_SAMPLE;
  return {
    overall,
    level: overall < 0.1 ? 'Low' : overall < 0.25 ? 'Moderate' : 'High',
    features: features.slice(0, 10),
    sampleSize: batch.length,
    reliable,
    note: reliable
      ? `Population Stability Index across ${batch.length} recent assessments against the training deciles.`
      : `Only ${batch.length} recent assessments — below the ${PSI_MIN_SAMPLE}-observation floor where PSI is meaningful. Shown for transparency, not acted on.`,
  };
}

// ---------------------------------------------------------------------------
// Model card / health
// ---------------------------------------------------------------------------

export function metrics(): ModelMetrics {
  return artifact.metrics;
}

export function modelCard() {
  return {
    version: artifact.model_version,
    algorithm: artifact.algorithm,
    trainedAt: artifact.trained_at,
    training: artifact.training,
    bands: artifact.bands,
    escalationThreshold: artifact.escalation_threshold,
    features: artifact.features,
    expectedValues: {
      wri: round1(EXPECTED.wri),
      wri_7d: round1(EXPECTED.wri_7d),
      escalation_logit: Number(EXPECTED.escalation.toFixed(4)),
    },
    treeCount: Object.values(artifact.models).reduce((a, m) => a + m.n_trees, 0),
  };
}

// ---------------------------------------------------------------------------
function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}
function round1(v: number) {
  return Number(v.toFixed(1));
}

export { TRAIN_MEAN, TRAIN_STD, EXPECTED };
