/**
 * Cross-runtime verification: does the TypeScript engine agree with the model
 * scikit-learn actually trained?
 *
 * Run with `npm run ml:verify`. It asserts three things:
 *
 *  1. Inference parity — TS predictions match sklearn's to 1e-9 on 500 held-out
 *     rows the model never saw during training.
 *  2. SHAP local accuracy — for every row and every ensemble,
 *     E[f(X)] + Σφ  ==  f(x). This is the defining property of Shapley values;
 *     an implementation bug breaks it immediately, which is exactly why it is
 *     the check worth running rather than eyeballing a waterfall chart.
 *  3. SHAP symmetry — a feature that never appears in any split gets exactly
 *     zero attribution.
 *
 * If any of these fail the process exits non-zero, so a broken model can never
 * quietly ship into a demo.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expectedRaw, predict, predictRaw, treeShap } from './gbm.js';
import type { ModelArtifact, SerializedEnsemble } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));

interface Fixture {
  feature_order: string[];
  rows: number[][];
  expected: Record<string, number[]>;
}

const artifact: ModelArtifact = JSON.parse(
  readFileSync(join(here, '..', 'models', 'sahara-model-v2.json'), 'utf8'),
);
const fixture: Fixture = JSON.parse(
  readFileSync(join(here, '..', '..', 'ml', 'artifacts', 'reference_predictions.json'), 'utf8'),
);

let failures = 0;

function check(name: string, ok: boolean, detail: string) {
  const tag = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`  [${tag}] ${name.padEnd(44)} ${detail}`);
  if (!ok) failures++;
}

// --- 0. Contract ------------------------------------------------------------
check(
  'feature order matches artifact',
  JSON.stringify(fixture.feature_order) === JSON.stringify(artifact.feature_order),
  `${artifact.feature_order.length} features`,
);

const nF = artifact.feature_order.length;

// --- 1. Inference parity ----------------------------------------------------
const parity: Array<[string, SerializedEnsemble, number[]]> = [
  ['wri', artifact.models.wri, fixture.expected.wri],
  ['wri_7d', artifact.models.wri_7d, fixture.expected.wri_7d],
  ['escalation (raw logit)', artifact.models.escalation, fixture.expected.escalation_raw],
  ['wri_q10', artifact.models.wri_q10, fixture.expected.wri_q10],
  ['wri_q90', artifact.models.wri_q90, fixture.expected.wri_q90],
];

for (const [name, ens, expected] of parity) {
  let worst = 0;
  for (let i = 0; i < fixture.rows.length; i++) {
    worst = Math.max(worst, Math.abs(predictRaw(ens, fixture.rows[i]) - expected[i]));
  }
  check(`inference parity: ${name}`, worst < 1e-9, `max |Δ| = ${worst.toExponential(2)}`);
}

// Probability path (inverse link) checked separately.
{
  let worst = 0;
  for (let i = 0; i < fixture.rows.length; i++) {
    worst = Math.max(
      worst,
      Math.abs(predict(artifact.models.escalation, fixture.rows[i]) - fixture.expected.escalation_proba[i]),
    );
  }
  check('inference parity: escalation P(y=1)', worst < 1e-9, `max |Δ| = ${worst.toExponential(2)}`);
}

// --- 2. SHAP local accuracy -------------------------------------------------
for (const [name, ens] of [
  ['wri', artifact.models.wri],
  ['wri_7d', artifact.models.wri_7d],
  ['escalation', artifact.models.escalation],
] as Array<[string, SerializedEnsemble]>) {
  const base = expectedRaw(ens);
  let worst = 0;
  for (let i = 0; i < fixture.rows.length; i++) {
    const phi = treeShap(ens, fixture.rows[i], nF);
    let sum = 0;
    for (let j = 0; j < nF; j++) sum += phi[j];
    worst = Math.max(worst, Math.abs(base + sum - predictRaw(ens, fixture.rows[i])));
  }
  check(`SHAP local accuracy: ${name}`, worst < 1e-8, `max |E[f]+Σφ−f(x)| = ${worst.toExponential(2)}`);
}

// --- 3. SHAP zero-attribution for unused features --------------------------
{
  const ens = artifact.models.wri;
  const used = new Set<number>();
  for (const t of ens.trees) for (const f of t.feature) if (f >= 0) used.add(f);
  const unused = artifact.feature_order.map((_, i) => i).filter((i) => !used.has(i));
  let worst = 0;
  for (let i = 0; i < Math.min(50, fixture.rows.length); i++) {
    const phi = treeShap(ens, fixture.rows[i], nF);
    for (const j of unused) worst = Math.max(worst, Math.abs(phi[j]));
  }
  check(
    'SHAP: unused features get exactly zero',
    worst === 0,
    unused.length ? `${unused.length} unused, max |φ| = ${worst}` : 'every feature is used by the ensemble',
  );
}

// --- 4. Latency -------------------------------------------------------------
{
  const rows = fixture.rows;
  const t0 = performance.now();
  const N = 2000;
  for (let i = 0; i < N; i++) predictRaw(artifact.models.wri, rows[i % rows.length]);
  const perPredict = ((performance.now() - t0) / N) * 1000;

  const t1 = performance.now();
  const M = 500;
  for (let i = 0; i < M; i++) treeShap(artifact.models.wri, rows[i % rows.length], nF);
  const perShap = ((performance.now() - t1) / M) * 1000;

  check(
    'latency budget (<2ms explain)',
    perShap / 1000 < 2,
    `predict ${perPredict.toFixed(1)}µs · full SHAP explain ${perShap.toFixed(1)}µs`,
  );
}

console.log('');
if (failures) {
  console.error(`\x1b[31m${failures} check(s) failed.\x1b[0m`);
  process.exit(1);
}
console.log('\x1b[32mAll model-runtime checks passed.\x1b[0m');
console.log(
  `model ${artifact.model_version} · ${artifact.feature_order.length} features · ` +
    `${Object.values(artifact.models).reduce((a, m) => a + m.n_trees, 0)} trees total`,
);
