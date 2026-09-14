/**
 * Explainability surface — the components that turn SHAP output into something
 * a welfare officer can act on and disagree with.
 *
 * The design problem here is specific. A SHAP waterfall is the standard way to
 * show an attribution, and it is genuinely the right chart: it makes local
 * accuracy visible, because you can watch the bars carry you from the cohort
 * baseline to this person's score. But the default rendering — twenty grey bars
 * with feature names like `sleep_debt_7d` — is unreadable to the person who has
 * to make the decision. So:
 *
 *   - Bars are ordered by magnitude and capped; the remainder is collapsed into
 *     an explicit "everything else" bar rather than silently dropped, because
 *     dropping it would break the very property the chart exists to show.
 *   - Every feature carries its own value and where that value sits in the
 *     training distribution. "Sleep debt 16h" means nothing on its own;
 *     "16h, 89th percentile" is a finding.
 *   - Direction is encoded in position and colour together, never colour alone.
 */

import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { BAND, Band, Chip, Eyebrow, Info, cx } from '../../design/primitives.js';
import { duration, ease, stagger, staggerItem } from '../../design/motion.js';

export interface Attribution {
  feature: string;
  name: string;
  value: string;
  rawValue: number;
  impact: number;
  direction: 'increases_risk' | 'decreases_risk';
  category: string;
  percentile: number;
  imputed: boolean;
}

const CATEGORY_LABEL: Record<string, string> = {
  sleep: 'Sleep',
  schedule: 'Duty schedule',
  operational: 'Operational tempo',
  physiological: 'Physiological',
  social: 'Social & morale',
  self_report: 'Self-reported',
  demographic: 'Demographic',
  history: 'Welfare history',
};

// ---------------------------------------------------------------------------
// Risk dial
// ---------------------------------------------------------------------------

/**
 * The Welfare Risk Index, drawn as an arc with its 80% prediction interval
 * shown as a band rather than hidden behind a single confident number.
 *
 * Showing the interval is the whole point. A score of 68 with an interval of
 * 57-71 is a different decision from 68 with an interval of 66-70, and a
 * system that presents both identically is training its users to over-trust it.
 */
export function RiskDial({
  value,
  band,
  interval,
  forecast,
  size = 200,
}: {
  value: number;
  band: Band;
  interval: [number, number];
  forecast?: number;
  size?: number;
}) {
  const stroke = 12;
  const r = (size - stroke * 2) / 2;
  const cx0 = size / 2;
  const cy0 = size / 2;
  // A 260° arc leaves a visual "gap" at the bottom that reads as a gauge.
  const sweep = 260;
  const start = 90 + (360 - sweep) / 2;

  const polar = (pct: number, radius = r) => {
    const angle = ((start + (sweep * pct) / 100) * Math.PI) / 180;
    return { x: cx0 + radius * Math.cos(angle), y: cy0 + radius * Math.sin(angle) };
  };

  const arcPath = (from: number, to: number, radius = r) => {
    const a = polar(from, radius);
    const b = polar(to, radius);
    const large = ((to - from) / 100) * sweep > 180 ? 1 : 0;
    return `M ${a.x} ${a.y} A ${radius} ${radius} 0 ${large} 1 ${b.x} ${b.y}`;
  };

  const tick = polar(value, r + stroke / 2 + 4);
  const tickIn = polar(value, r - stroke / 2 - 4);
  // Filter ids must be unique per instance or two dials on one page share one.
  const uid = React.useId().replace(/:/g, '');

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        role="img"
        aria-label={`Welfare Risk Index ${value}, ${band} band`}
        className="overflow-visible"
      >
        <defs>
          {/* The value arc casts a short shadow onto the track, so it reads
              as sitting a millimetre above it rather than painted on. */}
          <filter id={`${uid}-lift`} x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="1.5" stdDeviation="1.6" floodColor="rgb(0 0 0)" floodOpacity="0.28" />
          </filter>
          {/* Soft ambient glow in the band colour behind the figure. */}
          <radialGradient id={`${uid}-glow`}>
            <stop offset="0%" stopColor={BAND[band].css} stopOpacity={0.16} />
            <stop offset="70%" stopColor={BAND[band].css} stopOpacity={0.03} />
            <stop offset="100%" stopColor={BAND[band].css} stopOpacity={0} />
          </radialGradient>
          <linearGradient id={`${uid}-sheen`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff" stopOpacity={0.35} />
            <stop offset="55%" stopColor="#fff" stopOpacity={0} />
          </linearGradient>
        </defs>

        <circle cx={cx0} cy={cy0} r={r - stroke} fill={`url(#${uid}-glow)`} />

        {/* Track: a debossed channel — a darker arc offset a pixel down, then
            the channel itself, then a hairline of light on its lower lip. */}
        <path d={arcPath(0, 100)} fill="none" stroke="rgb(0 0 0 / 0.10)" strokeWidth={stroke} strokeLinecap="round" transform="translate(0 1)" />
        <path d={arcPath(0, 100)} fill="none" stroke="var(--paper-sunken)" strokeWidth={stroke} strokeLinecap="round" />
        <path d={arcPath(0, 100)} fill="none" stroke="rgb(255 255 255 / 0.28)" strokeWidth={1} strokeLinecap="round" transform="translate(0 5.5)" />

        {/* Band boundaries at 40 and 65, so the scale is legible without a key */}
        {[40, 65].map((t) => {
          const a = polar(t, r - stroke / 2 - 1);
          const b = polar(t, r + stroke / 2 + 1);
          return (
            <line
              key={t}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="var(--paper-raised)"
              strokeWidth={2}
            />
          );
        })}

        {/* 80% prediction interval */}
        <path
          d={arcPath(Math.max(0, interval[0]), Math.min(100, interval[1]))}
          fill="none"
          stroke={BAND[band].css}
          strokeWidth={stroke}
          strokeLinecap="round"
          opacity={0.22}
        />

        {/* Point estimate */}
        <g filter={`url(#${uid}-lift)`}>
          <motion.path
            d={arcPath(0, Math.max(0.5, value))}
            fill="none"
            stroke={BAND[band].css}
            strokeWidth={stroke}
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.05, ease }}
          />
        </g>
        {/* Sheen along the top of the value arc, clipped to its length by
            sharing the same pathLength animation. */}
        <motion.path
          d={arcPath(0, Math.max(0.5, value))}
          fill="none"
          stroke={`url(#${uid}-sheen)`}
          strokeWidth={stroke * 0.55}
          strokeLinecap="round"
          transform="translate(0 -1.5)"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.05, ease }}
          aria-hidden
        />

        {/* Forecast marker */}
        {forecast !== undefined ? (
          <motion.circle
            cx={polar(forecast).x}
            cy={polar(forecast).y}
            r={4}
            fill="var(--paper-raised)"
            stroke="var(--viz-forecast)"
            strokeWidth={2.5}
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.9, duration: duration.base, ease }}
          />
        ) : null}

        <line
          x1={tickIn.x}
          y1={tickIn.y}
          x2={tick.x}
          y2={tick.y}
          stroke="var(--ink-strong)"
          strokeWidth={1.5}
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center pt-1">
        <div className="font-serif text-[46px] leading-none text-ink-strong tnum">{value.toFixed(0)}</div>
        <div className="eyebrow mt-1">Welfare Risk Index</div>
        <div className="mt-2 font-mono text-[10.5px] text-ink-faint tnum">
          80% CI {interval[0].toFixed(0)}–{interval[1].toFixed(0)}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Waterfall
// ---------------------------------------------------------------------------

export function ShapWaterfall({
  baseValue,
  prediction,
  attributions,
  maxBars = 7,
}: {
  baseValue: number;
  prediction: number;
  attributions: Attribution[];
  maxBars?: number;
}) {
  const rows = useMemo(() => {
    const sorted = [...attributions].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
    const head = sorted.slice(0, maxBars);
    const tail = sorted.slice(maxBars);
    const tailSum = tail.reduce((s, a) => s + a.impact, 0);

    const out = head.map((a) => ({ key: a.feature, label: a.name, value: a.value, impact: a.impact, pct: a.percentile }));
    if (tail.length) {
      out.push({
        key: '__rest__',
        label: `${tail.length} further factors`,
        value: '',
        impact: tailSum,
        pct: -1,
      });
    }
    return out;
  }, [attributions, maxBars]);

  // Lay out the cumulative walk from the base value to the prediction.
  const steps = useMemo(() => {
    let running = baseValue;
    return rows.map((row) => {
      const from = running;
      running += row.impact;
      return { ...row, from, to: running };
    });
  }, [rows, baseValue]);

  const lo = Math.min(baseValue, prediction, ...steps.map((s) => Math.min(s.from, s.to)));
  const hi = Math.max(baseValue, prediction, ...steps.map((s) => Math.max(s.from, s.to)));
  const pad = Math.max(4, (hi - lo) * 0.08);
  const domainLo = Math.max(0, lo - pad);
  const domainHi = Math.min(100, hi + pad);
  const span = domainHi - domainLo || 1;
  const x = (v: number) => ((v - domainLo) / span) * 100;

  const residual = prediction - (baseValue + rows.reduce((s, r) => s + r.impact, 0));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Eyebrow>Attribution walk</Eyebrow>
        <div className="flex items-center gap-3 font-mono text-[10px] text-ink-faint">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-[1px] bg-review" /> raises
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-[1px] bg-routine" /> lowers
          </span>
        </div>
      </div>

      <motion.div variants={stagger(0.1, 0.05)} initial="hidden" animate="show" className="space-y-1">
        {/* Cohort baseline */}
        <Row
          label="Cohort baseline"
          sub="Average across the training population"
          left={0}
          width={0}
          impact={null}
          marker={x(baseValue)}
          value={baseValue.toFixed(1)}
        />

        {steps.map((s) => {
          const from = x(Math.min(s.from, s.to));
          const to = x(Math.max(s.from, s.to));
          return (
            <Row
              key={s.key}
              label={s.label}
              sub={
                s.pct >= 0
                  ? `${s.value}${s.pct >= 0 ? ` · ${Math.round(s.pct * 100)}th pct` : ''}`
                  : 'Combined remainder'
              }
              left={from}
              width={Math.max(0.6, to - from)}
              impact={s.impact}
              value={`${s.impact > 0 ? '+' : ''}${s.impact.toFixed(1)}`}
            />
          );
        })}

        <Row
          label="Welfare Risk Index"
          sub="This individual, today"
          left={0}
          width={0}
          impact={null}
          marker={x(prediction)}
          value={prediction.toFixed(1)}
          emphasis
        />
      </motion.div>

      <p className="mt-3 border-t border-rule-hairline pt-2.5 font-mono text-[10.5px] leading-relaxed text-ink-faint">
        Exact TreeSHAP. Contributions sum to the prediction minus the baseline
        {Math.abs(residual) > 0.05 ? (
          <> (residual {residual.toFixed(2)} from clamping to the 0–100 scale)</>
        ) : (
          <> to within {Math.abs(residual).toFixed(2)} points</>
        )}
        .
      </p>
    </div>
  );
}

function Row({
  label,
  sub,
  left,
  width,
  impact,
  value,
  marker,
  emphasis,
}: {
  label: string;
  sub?: string;
  left: number;
  width: number;
  impact: number | null;
  value: string;
  marker?: number;
  emphasis?: boolean;
}) {
  const color = impact === null ? 'var(--ink-faint)' : impact > 0 ? 'var(--signal-review)' : 'var(--signal-routine)';
  return (
    <motion.div variants={staggerItem} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
      <div className="grid grid-cols-[minmax(0,168px)_minmax(0,1fr)] items-center gap-3">
        <div className="min-w-0">
          <div
            className={cx(
              'truncate text-[12.5px] leading-tight',
              emphasis ? 'font-medium text-ink-strong' : 'text-ink',
            )}
            title={label}
          >
            {label}
          </div>
          {sub ? <div className="truncate font-mono text-[10px] text-ink-faint">{sub}</div> : null}
        </div>

        <div className={cx('relative h-[22px] rounded-[3px]', emphasis ? 'bg-paper-sunken' : 'bg-paper-inset')}>
          {marker !== undefined ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-y-0 w-[2px] rounded-full"
              style={{ left: `${marker}%`, background: emphasis ? 'var(--ink-strong)' : 'var(--ink-faint)' }}
            />
          ) : (
            <motion.div
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: 1 }}
              transition={{ duration: duration.slow, ease }}
              className="absolute inset-y-[3px] rounded-[2px]"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                background: color,
                transformOrigin: impact !== null && impact > 0 ? 'left' : 'right',
              }}
            />
          )}
        </div>
      </div>

      <div
        className={cx('w-[52px] text-right font-mono text-[11.5px] tnum', emphasis && 'font-semibold')}
        style={{ color: impact === null ? 'var(--ink)' : color }}
      >
        {value}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Driver list
// ---------------------------------------------------------------------------

export function DriverList({
  attributions,
  limit = 6,
  title = 'What is driving this',
}: {
  attributions: Attribution[];
  limit?: number;
  title?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const sorted = useMemo(
    () => [...attributions].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)),
    [attributions],
  );
  const shown = expanded ? sorted : sorted.slice(0, limit);
  const max = Math.max(...sorted.map((a) => Math.abs(a.impact)), 0.1);

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <Eyebrow>{title}</Eyebrow>
        <Info label="Per-factor contribution">
          Each figure is that factor's exact SHAP contribution to this
          individual's index, in index points. Percentile shows where their value
          sits in the training population.
        </Info>
      </div>

      <motion.ul variants={stagger(0.04, 0.04)} initial="hidden" animate="show" className="space-y-2">
        {shown.map((a) => {
          const positive = a.impact > 0;
          return (
            <motion.li key={a.feature} variants={staggerItem} className="group">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[13px] text-ink">{a.name}</span>
                  {a.imputed ? (
                    <Chip tone="warn" className="shrink-0">
                      estimated
                    </Chip>
                  ) : null}
                </div>
                <span
                  className="shrink-0 font-mono text-[12px] tnum"
                  style={{ color: positive ? 'var(--signal-review)' : 'var(--signal-routine)' }}
                >
                  {positive ? '+' : ''}
                  {a.impact.toFixed(1)}
                </span>
              </div>

              <div className="mt-1 flex items-center gap-2.5">
                <div className="relative h-[5px] flex-1 overflow-hidden rounded-full bg-paper-inset">
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: Math.abs(a.impact) / max }}
                    transition={{ duration: duration.slow, ease }}
                    className="h-full origin-left rounded-full"
                    style={{ background: positive ? 'var(--signal-review)' : 'var(--signal-routine)' }}
                  />
                </div>
                <span className="shrink-0 font-mono text-[10px] text-ink-faint tnum">
                  {a.value}
                  {a.percentile >= 0 ? ` · p${Math.round(a.percentile * 100)}` : ''}
                </span>
              </div>
            </motion.li>
          );
        })}
      </motion.ul>

      {sorted.length > limit ? (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 font-mono text-[10.5px] uppercase tracking-[0.09em] text-ink-faint transition-colors hover:text-ink"
        >
          {expanded ? 'Show fewer' : `Show all ${sorted.length} factors`}
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category roll-up
// ---------------------------------------------------------------------------

/**
 * Contributions grouped by category.
 *
 * Correlated features split their SHAP credit between themselves — sleep debt
 * and average sleep hours describe the same underlying state, so each receives
 * a share and either can outrank the other from one day to the next. Rolling up
 * by category gives a headline that does not flip for reasons the reader cannot
 * see, while the per-factor list underneath keeps the detail available.
 */
export function CategoryBreakdown({
  breakdown,
}: {
  breakdown: Array<{ category: string; impact: number }>;
}) {
  const max = Math.max(...breakdown.map((b) => Math.abs(b.impact)), 0.1);
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <Eyebrow>By domain</Eyebrow>
        <Info label="Why group them?">
          Related features share attribution between themselves. Grouping gives a
          stable headline; the factor list below keeps the detail.
        </Info>
      </div>
      <ul className="space-y-2.5">
        {breakdown.slice(0, 6).map((b, i) => {
          const positive = b.impact > 0;
          return (
            <li key={b.category} className="flex items-center gap-3">
              <span className="w-[124px] shrink-0 truncate text-[12.5px] text-ink-muted">
                {CATEGORY_LABEL[b.category] ?? b.category}
              </span>
              <div className="relative h-[18px] flex-1">
                <div className="absolute inset-y-0 left-1/2 w-px bg-rule" />
                <motion.div
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{ duration: duration.slow, ease, delay: i * 0.05 }}
                  className="absolute inset-y-[3px] rounded-[2px]"
                  style={{
                    left: positive ? '50%' : `calc(50% - ${(Math.abs(b.impact) / max) * 50}%)`,
                    width: `${(Math.abs(b.impact) / max) * 50}%`,
                    background: positive ? 'var(--signal-review)' : 'var(--signal-routine)',
                    transformOrigin: positive ? 'left' : 'right',
                  }}
                />
              </div>
              <span
                className="w-[46px] shrink-0 text-right font-mono text-[11.5px] tnum"
                style={{ color: positive ? 'var(--signal-review)' : 'var(--signal-routine)' }}
              >
                {positive ? '+' : ''}
                {b.impact.toFixed(1)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/**
 * How much of this assessment rests on observed data versus imputation.
 *
 * If a third of the inputs were filled in from population averages, the person
 * reading the score deserves to know before they act on it.
 */
export function CoverageNote({ coverage, imputed }: { coverage: number; imputed: string[] }) {
  const pct = Math.round(coverage * 100);
  const good = pct >= 90;
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-sm border border-rule bg-paper-inset px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={cx('size-1.5 rounded-full', good ? 'bg-routine' : 'bg-watch')}
          />
          <span className="text-[12.5px] text-ink">
            {pct}% of model inputs observed
          </span>
        </div>
        {imputed.length ? (
          <button
            onClick={() => setOpen((v) => !v)}
            className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-faint hover:text-ink"
          >
            {open ? 'hide' : `${imputed.length} estimated`}
          </button>
        ) : null}
      </div>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: duration.base, ease }}
            className="overflow-hidden"
          >
            <p className="pt-2 font-mono text-[10.5px] leading-relaxed text-ink-faint">
              Filled from the training mean: {imputed.join(', ')}. A production
              deployment sources these from HRMS and issued wearables.
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
