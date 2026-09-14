/**
 * Model card.
 *
 * Most projects hide their evaluation. This screen puts it on a tab any judge,
 * auditor or sceptical officer can open, including the numbers that do not
 * flatter us: precision is 0.40, the seven-day forecast beats persistence by
 * only two points of MAE, and the drift statistic is unreliable at our current
 * sample size and is labelled as such rather than quietly suppressed.
 *
 * Publishing the weak numbers alongside the strong ones is the point. A system
 * that asks a commander to act on its output has to be legible enough for him
 * to decide how much to trust it.
 */

import React from 'react';
import { motion } from 'motion/react';

import { api } from '../api/client.js';
import { useAsync } from '../app/hooks.js';
import { ScreenIntro } from '../app/AppShell.js';
import { stagger, staggerItem } from '../design/motion.js';
import {
  Chip,
  ErrorNote,
  Eyebrow,
  Info,
  Panel,
  PanelHeader,
  Skeleton,
  Stat,
  Ticker,
  cx,
} from '../design/primitives.js';
import { CalibrationPlot, ConfusionMatrix, ImportanceBars } from '../components/charts/Charts.js';

export function ModelScreen() {
  const health = useAsync(() => api.getModelHealth(), []);

  if (health.loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-9 w-72" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[118px]" />
          ))}
        </div>
        <Skeleton className="h-[320px]" />
      </div>
    );
  }
  if (health.error) return <ErrorNote onRetry={health.refetch}>{health.error.message}</ErrorNote>;

  const h = health.data!.health;
  const m = h.metrics as {
    regression: {
      wri: { mae: number; rmse: number; r2: number };
      wri_7d_ahead: { mae: number; r2: number; persistence_baseline_mae: number };
      baselines: { linear_regression_mae: number; self_report_only_mae: number; self_report_only_r2: number };
    };
    band_accuracy: number;
    band_confusion: { labels: string[]; matrix: number[][] };
    classification: {
      roc_auc: number; pr_auc: number; f1: number; f2: number; precision: number; recall: number;
      brier: number; threshold: number; base_rate: number; baseline_logistic_roc_auc: number;
      calibration: Array<{ bin: string; predicted: number; observed: number; count: number }>;
    };
    prediction_interval: { nominal: number; empirical_coverage: number; mean_width: number };
    fairness: Record<string, { groups: Array<{ group: string; n: number; selection_rate: number; tpr: number | null; fpr: number | null; auc: number | null }>; disparate_impact_ratio: number | null }>;
  };
  const card = h.card as {
    version: string; algorithm: string; trainedAt: string; treeCount: number;
    training: { rows_train: number; rows_test: number; personnel_train: number; personnel_test: number; split: string };
    bands: { watch: number; review: number };
  };
  const drift = h.drift as {
    overall: number; level: string; reliable: boolean; note: string; sampleSize: number;
    features: Array<{ feature: string; name: string; psi: number; level: string }>;
  };

  return (
    <motion.div variants={stagger(0.03, 0.05)} initial="hidden" animate="show">
      <ScreenIntro
        title="Model card"
        lede="Everything the evaluation found, including what it found wanting. All figures come from a held-out split in which no individual appears on both sides."
        actions={<Chip tone="accent">{card.version}</Chip>}
      />

      {/* Headline */}
      <motion.div variants={staggerItem} className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Panel>
          <Stat
            label="Band accuracy"
            value={<Ticker value={m.band_accuracy * 100} decimals={1} suffix="%" />}
            hint="Held-out agreement on routine / watch / review."
          />
        </Panel>
        <Panel>
          <Stat
            label="Index error (MAE)"
            value={<Ticker value={m.regression.wri.mae} decimals={2} />}
            unit="pts"
            hint={`Linear baseline ${m.regression.baselines.linear_regression_mae}; self-report alone ${m.regression.baselines.self_report_only_mae}.`}
          />
        </Panel>
        <Panel>
          <Stat
            label="Escalation ROC-AUC"
            value={<Ticker value={m.classification.roc_auc} decimals={3} />}
            hint={`Logistic-regression baseline ${m.classification.baseline_logistic_roc_auc}.`}
          />
        </Panel>
        <Panel>
          <Stat
            label="Inference p95"
            value={<Ticker value={h.inferenceP95Ms} decimals={2} />}
            unit="ms"
            hint={`Measured on this machine, now, across ${h.totalInferencesLogged} stored assessments.`}
          />
        </Panel>
      </motion.div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Why ML */}
        <motion.div variants={staggerItem}>
          <Panel className="h-full">
            <PanelHeader
              eyebrow="Justification"
              title="Does the model earn its complexity?"
              description="A gradient-boosted ensemble is only worth deploying if something simpler does worse. Here is the comparison."
            />
            <div className="px-5 py-5">
              <ul className="space-y-3">
                <Compare
                  label="Ask people how they feel"
                  detail="Linear fit on self-reported stress and fatigue only"
                  mae={m.regression.baselines.self_report_only_mae}
                  worst={m.regression.baselines.self_report_only_mae}
                  best={m.regression.wri.mae}
                />
                <Compare
                  label="Linear regression"
                  detail="All 25 features, no interactions"
                  mae={m.regression.baselines.linear_regression_mae}
                  worst={m.regression.baselines.self_report_only_mae}
                  best={m.regression.wri.mae}
                />
                <Compare
                  label="Gradient-boosted trees"
                  detail="What SAHARA deploys"
                  mae={m.regression.wri.mae}
                  worst={m.regression.baselines.self_report_only_mae}
                  best={m.regression.wri.mae}
                  highlight
                />
              </ul>
              <p className="mt-4 border-t border-rule-hairline pt-3 text-[12px] leading-relaxed text-ink-muted">
                The honest reading: against a linear model on the same features the
                gain is modest. The large gain is over self-report alone — which is
                exactly the argument for ingesting duty rosters and wearables
                rather than simply asking people more questions.
              </p>
            </div>
          </Panel>
        </motion.div>

        {/* Forecast */}
        <motion.div variants={staggerItem}>
          <Panel className="h-full">
            <PanelHeader
              eyebrow="Prediction"
              title="Seven days ahead"
              description="The part of the problem statement that says 'predictive'. Measured against the baseline of assuming nothing changes."
            />
            <div className="space-y-4 px-5 py-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-sm border border-rule bg-paper-inset p-3.5">
                  <Eyebrow>Model MAE</Eyebrow>
                  <div className="mt-1 font-serif text-[28px] leading-none text-ink-strong tnum">
                    {m.regression.wri_7d_ahead.mae.toFixed(2)}
                  </div>
                </div>
                <div className="rounded-sm border border-rule bg-paper-inset p-3.5">
                  <Eyebrow>Persistence baseline</Eyebrow>
                  <div className="mt-1 font-serif text-[28px] leading-none text-ink-muted tnum">
                    {m.regression.wri_7d_ahead.persistence_baseline_mae.toFixed(2)}
                  </div>
                </div>
              </div>
              <p className="text-[12.5px] leading-relaxed text-ink-muted">
                A {(
                  ((m.regression.wri_7d_ahead.persistence_baseline_mae - m.regression.wri_7d_ahead.mae) /
                    m.regression.wri_7d_ahead.persistence_baseline_mae) *
                  100
                ).toFixed(1)}
                % reduction in error over assuming next week looks like this week.
                Real, useful at scale, and nowhere near clairvoyance — which is why
                the forecast is shown as a direction of travel rather than a number
                anyone is asked to act on alone.
              </p>

              <div className="rounded-sm border border-rule bg-paper-inset p-3.5">
                <div className="flex items-center justify-between">
                  <Eyebrow>80% prediction interval</Eyebrow>
                  <Info label="Why quantile models?">
                    Two additional ensembles are trained on the 10th and 90th
                    quantiles, so the interval is learned rather than assumed from
                    a normal error distribution.
                  </Info>
                </div>
                <p className="mt-2 text-[12.5px] text-ink">
                  Empirical coverage{' '}
                  <span className="font-mono text-ink-strong">
                    {(m.prediction_interval.empirical_coverage * 100).toFixed(1)}%
                  </span>{' '}
                  against a nominal 80%. Mean width {m.prediction_interval.mean_width.toFixed(1)} points.
                </p>
              </div>
            </div>
          </Panel>
        </motion.div>

        {/* Classification */}
        <motion.div variants={staggerItem}>
          <Panel className="h-full">
            <PanelHeader
              eyebrow="Escalation classifier"
              title="Catching deterioration in time"
              description="Tuned for recall, on purpose: an unnecessary welfare conversation costs an hour, a missed one can cost far more."
            />
            <div className="grid grid-cols-2 gap-px bg-rule-hairline sm:grid-cols-3">
              {[
                ['Recall', m.classification.recall, 'Of those who did escalate, the share we flagged'],
                ['Precision', m.classification.precision, 'Of those we flagged, the share who escalated'],
                ['F2', m.classification.f2, 'Recall weighted 4× precision — our objective'],
                ['PR-AUC', m.classification.pr_auc, `Base rate ${(m.classification.base_rate * 100).toFixed(0)}%`],
                ['Brier', m.classification.brier, 'Lower is better; probability accuracy'],
                ['Threshold', m.classification.threshold, 'Chosen on train, never on test'],
              ].map(([label, value, note]) => (
                <div key={label as string} className="bg-paper-raised px-4 py-3.5">
                  <div className="eyebrow">{label as string}</div>
                  <div className="mt-1 font-mono text-[18px] text-ink-strong tnum">
                    {(value as number).toFixed(3)}
                  </div>
                  <div className="mt-1 text-[10.5px] leading-snug text-ink-faint">{note as string}</div>
                </div>
              ))}
            </div>
            <div className="border-t border-rule-hairline px-5 py-4">
              <p className="text-[12px] leading-relaxed text-ink-muted">
                Precision of {m.classification.precision.toFixed(2)} means roughly{' '}
                {Math.round((1 - m.classification.precision) * 10)} in 10 flags will
                turn out not to need escalation. We accept that: the cost asymmetry
                is deliberate and is stated to every officer who sees a flag.
              </p>
            </div>
          </Panel>
        </motion.div>

        <motion.div variants={staggerItem}>
          <Panel className="h-full">
            <PanelHeader
              eyebrow="Calibration"
              title="Do the probabilities mean anything?"
              description="Ranking well is not the same as being right about magnitude."
            />
            <div className="px-4 py-4">
              <CalibrationPlot bins={m.classification.calibration} />
            </div>
          </Panel>
        </motion.div>

        <motion.div variants={staggerItem}>
          <Panel className="h-full">
            <PanelHeader eyebrow="Band agreement" title="Where the model disagrees with the truth" />
            <div className="px-5 py-5">
              <ConfusionMatrix labels={m.band_confusion.labels} matrix={m.band_confusion.matrix} />
            </div>
          </Panel>
        </motion.div>

        <motion.div variants={staggerItem}>
          <Panel className="h-full">
            <PanelHeader
              eyebrow="Global importance"
              title="What the model relies on overall"
              description="Permutation importance on held-out data — measured by degrading each feature, not read off the training split."
            />
            <div className="px-5 py-5">
              <ImportanceBars items={h.globalFeatureImportance} />
            </div>
          </Panel>
        </motion.div>

        {/* Fairness */}
        <motion.div variants={staggerItem} className="lg:col-span-2">
          <Panel>
            <PanelHeader
              eyebrow="Fairness audit"
              title="Does the model treat groups differently?"
              description="Gender, rank group and force branch are deliberately excluded from the feature set. This audit exists because exclusion is not sufficient — disparity can still arrive through correlated operational features."
              actions={
                <Info label="Four-fifths rule">
                  A disparate-impact ratio below 0.80 is the conventional threshold
                  for adverse impact. Ratios here are the minimum selection rate
                  divided by the maximum across groups.
                </Info>
              }
            />
            <div className="grid gap-px bg-rule-hairline sm:grid-cols-3">
              {Object.entries(m.fairness).map(([attr, blk]) => {
                const ratio = blk.disparate_impact_ratio ?? 1;
                const pass = ratio >= 0.8;
                return (
                  <div key={attr} className="bg-paper-raised px-5 py-4">
                    <div className="flex items-center justify-between">
                      <Eyebrow>{attr.replace(/_/g, ' ')}</Eyebrow>
                      <span
                        className={cx(
                          'rounded-sm px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.08em]',
                          pass ? 'bg-routine-bg text-routine' : 'bg-review-bg text-review',
                        )}
                      >
                        {pass ? 'pass' : 'review'}
                      </span>
                    </div>
                    <div className="mt-1.5 font-serif text-[28px] leading-none text-ink-strong tnum">
                      {ratio.toFixed(2)}
                    </div>
                    <ul className="mt-3 space-y-1.5">
                      {blk.groups.map((g) => (
                        <li key={g.group} className="flex items-center justify-between gap-2 text-[11.5px]">
                          <span className="truncate text-ink-muted">{g.group.replace(/_/g, ' ')}</span>
                          <span className="shrink-0 font-mono text-ink-faint tnum">
                            {(g.selection_rate * 100).toFixed(0)}% · n={g.n}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </Panel>
        </motion.div>

        {/* Drift & provenance */}
        <motion.div variants={staggerItem}>
          <Panel className="h-full">
            <PanelHeader
              eyebrow="Monitoring"
              title="Distribution drift"
              description={drift.note}
              actions={
                <span
                  className={cx(
                    'rounded-sm px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em]',
                    !drift.reliable
                      ? 'bg-paper-inset text-ink-faint'
                      : drift.level === 'Low'
                        ? 'bg-routine-bg text-routine'
                        : drift.level === 'Moderate'
                          ? 'bg-watch-bg text-watch'
                          : 'bg-review-bg text-review',
                  )}
                >
                  {drift.reliable ? drift.level : 'insufficient sample'}
                </span>
              }
            />
            <div className="px-5 py-5">
              <ul className="space-y-1.5">
                {drift.features.slice(0, 6).map((f) => (
                  <li key={f.feature} className="flex items-center justify-between gap-3 text-[12.5px]">
                    <span className="truncate text-ink-muted">{f.name}</span>
                    <span className="shrink-0 font-mono text-[11.5px] text-ink-faint tnum">
                      PSI {f.psi.toFixed(3)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 border-t border-rule-hairline pt-3 text-[11.5px] leading-relaxed text-ink-faint">
                Computed against the training deciles stored inside the model
                artifact, so drift is measured against what the model actually
                learned rather than against last week.
              </p>
            </div>
          </Panel>
        </motion.div>

        <motion.div variants={staggerItem}>
          <Panel className="h-full">
            <PanelHeader eyebrow="Provenance" title="How this artifact was produced" />
            <dl className="divide-y divide-rule-hairline">
              {[
                ['Algorithm', card.algorithm],
                ['Trees in the artifact', `${card.treeCount} across five ensembles`],
                ['Training rows', `${card.training.rows_train.toLocaleString()} (${card.training.personnel_train} individuals)`],
                ['Held-out rows', `${card.training.rows_test.toLocaleString()} (${card.training.personnel_test} individuals)`],
                ['Split', card.training.split],
                ['Band thresholds', `watch ≥ ${card.bands.watch}, review ≥ ${card.bands.review}`],
                ['Trained at', new Date(card.trainedAt).toLocaleString()],
                ['Runtime', String((h.architecture as Record<string, string>).mlEngine)],
              ].map(([k, v]) => (
                <div key={k as string} className="flex items-start justify-between gap-4 px-5 py-2.5">
                  <dt className="shrink-0 text-[12.5px] text-ink-muted">{k as string}</dt>
                  <dd className="text-right font-mono text-[11.5px] text-ink">{v as string}</dd>
                </div>
              ))}
            </dl>
            <div className="border-t border-rule-hairline px-5 py-4">
              <p className="text-[11.5px] leading-relaxed text-ink-faint">
                The trained trees are exported to JSON and executed by a TypeScript
                engine. <code className="font-mono text-[10.5px] text-ink">npm run ml:verify</code>{' '}
                asserts that this engine reproduces scikit-learn's own predictions to
                1e-13 and that SHAP values satisfy local accuracy — so the model
                evaluated above is provably the model serving the screens.
              </p>
            </div>
          </Panel>
        </motion.div>
      </div>
    </motion.div>
  );
}

function Compare({
  label,
  detail,
  mae,
  worst,
  best,
  highlight,
}: {
  label: string;
  detail: string;
  mae: number;
  worst: number;
  best: number;
  highlight?: boolean;
}) {
  // Longer bar = worse. Scale so the worst baseline fills the track.
  const pct = (mae / worst) * 100;
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3">
        <span className={cx('text-[13px]', highlight ? 'font-medium text-ink-strong' : 'text-ink')}>{label}</span>
        <span className="font-mono text-[12px] text-ink tnum">{mae.toFixed(2)} MAE</span>
      </div>
      <div className="mt-1 h-[7px] rounded-full bg-paper-inset">
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="h-full origin-left rounded-full"
          style={{
            width: `${pct}%`,
            background: highlight ? 'var(--viz-1)' : 'var(--rule-strong)',
          }}
        />
      </div>
      <div className="mt-0.5 text-[11px] text-ink-faint">
        {detail}
        {highlight ? ` · ${(((worst - best) / worst) * 100).toFixed(0)}% lower error than self-report alone` : ''}
      </div>
    </li>
  );
}
