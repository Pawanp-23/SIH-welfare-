/**
 * Chart components.
 *
 * All of them share one tooltip, one axis treatment, and one palette, which is
 * the difference between a dashboard and a pile of charts. Specific choices
 * worth knowing about:
 *
 *   - Series colours come from the validated categorical tokens in index.css.
 *     Band colours (routine/watch/review) are *status* colours and are never
 *     reused as a series hue.
 *   - The forecast series is dashed as well as differently coloured. Teal and
 *     blue separate well for protan/deutan vision but poorly for tritan, so the
 *     dash carries the identity when the hue cannot.
 *   - Grid and axes are recessive; no chart has two y-scales; every multi-series
 *     chart has a legend, and single-series charts have none because the title
 *     already names the series.
 */

import React, { useMemo } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';

import { BAND, Band, cx } from '../../design/primitives.js';

// ---------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------

const AXIS = {
  stroke: 'var(--viz-grid)',
  tick: { fill: 'var(--viz-axis)', fontSize: 10.5, fontFamily: 'var(--font-mono)' },
  tickLine: false,
  axisLine: false,
};

function TooltipShell({
  title,
  rows,
  footer,
}: {
  title: React.ReactNode;
  rows: Array<{ label: string; value: React.ReactNode; color?: string }>;
  footer?: React.ReactNode;
}) {
  return (
    <div className="rounded-sm border border-rule bg-paper-raised px-3 py-2 shadow-e3">
      <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-faint">{title}</div>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-4 text-[12px]">
            <span className="flex items-center gap-1.5 text-ink-muted">
              {r.color ? <span className="size-2 rounded-[1px]" style={{ background: r.color }} /> : null}
              {r.label}
            </span>
            <span className="font-mono text-ink-strong tnum">{r.value}</span>
          </li>
        ))}
      </ul>
      {footer ? <div className="mt-1.5 border-t border-rule-hairline pt-1.5 text-[10.5px] text-ink-faint">{footer}</div> : null}
    </div>
  );
}

export function Legend({
  items,
  className,
}: {
  items: Array<{ label: string; color: string; dashed?: boolean }>;
  className?: string;
}) {
  return (
    <ul className={cx('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)}>
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
          {i.dashed ? (
            <span className="flex h-0 w-4 items-center">
              <span className="h-[2px] w-full" style={{ background: `repeating-linear-gradient(to right, ${i.color} 0 4px, transparent 4px 7px)` }} />
            </span>
          ) : (
            <span className="h-[2px] w-4 rounded-full" style={{ background: i.color }} />
          )}
          {i.label}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Welfare trend
// ---------------------------------------------------------------------------

export interface TrendPoint {
  date: string;
  index: number;
  forecast?: number | null;
  band?: string;
}

/**
 * The individual's index over time, with the three operating bands shown as
 * background zones.
 *
 * Zones rather than gridlines because the question a person actually asks of
 * this chart is "which band am I in and am I heading for the next one" — an
 * unlabelled y-axis at 65 answers that far worse than a coloured region does.
 */
export function WelfareTrend({
  data,
  height = 240,
  showForecast = true,
}: {
  data: TrendPoint[];
  height?: number;
  showForecast?: boolean;
}) {
  const shaped = useMemo(
    () =>
      data.map((d) => ({
        ...d,
        label: d.date.slice(5),
      })),
    [data],
  );

  if (!shaped.length) {
    return (
      <div className="flex items-center justify-center py-10 text-[12.5px] text-ink-faint" style={{ height }}>
        No assessments recorded yet.
      </div>
    );
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={shaped} margin={{ top: 8, right: 10, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="wri-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--viz-1)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--viz-1)" stopOpacity={0.01} />
            </linearGradient>
          </defs>

          <ReferenceArea y1={0} y2={40} fill="var(--signal-routine)" fillOpacity={0.05} />
          <ReferenceArea y1={40} y2={65} fill="var(--signal-watch)" fillOpacity={0.06} />
          <ReferenceArea y1={65} y2={100} fill="var(--signal-review)" fillOpacity={0.07} />
          <ReferenceLine y={40} stroke="var(--signal-watch)" strokeOpacity={0.35} strokeDasharray="2 3" />
          <ReferenceLine y={65} stroke="var(--signal-review)" strokeOpacity={0.4} strokeDasharray="2 3" />

          <CartesianGrid vertical={false} stroke="var(--viz-grid)" strokeOpacity={0.55} />
          <XAxis dataKey="label" {...AXIS} minTickGap={18} />
          <YAxis domain={[0, 100]} ticks={[0, 40, 65, 100]} width={44} {...AXIS} />

          <Tooltip
            cursor={{ stroke: 'var(--ink-faint)', strokeWidth: 1, strokeDasharray: '3 3' }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as TrendPoint & { label: string };
              const band = (p.band ?? 'routine') as Band;
              return (
                <TooltipShell
                  title={p.date}
                  rows={[
                    { label: 'Index', value: p.index.toFixed(1), color: 'var(--viz-1)' },
                    ...(p.forecast != null
                      ? [{ label: '7-day forecast', value: p.forecast.toFixed(1), color: 'var(--viz-forecast)' }]
                      : []),
                  ]}
                  footer={`${BAND[band].label} band · ${label}`}
                />
              );
            }}
          />

          <Area
            type="monotone"
            dataKey="index"
            stroke="none"
            fill="url(#wri-fill)"
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="index"
            stroke="var(--viz-1)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--paper-raised)' }}
            animationDuration={900}
          />
          {showForecast ? (
            <Line
              type="monotone"
              dataKey="forecast"
              stroke="var(--viz-forecast)"
              strokeWidth={2}
              strokeDasharray="4 3"
              dot={false}
              connectNulls
              animationDuration={900}
            />
          ) : null}
        </ComposedChart>
      </ResponsiveContainer>

      <Legend
        className="mt-2 pl-6"
        items={[
          { label: 'Welfare Risk Index', color: 'var(--viz-1)' },
          ...(showForecast ? [{ label: '7-day model forecast', color: 'var(--viz-forecast)', dashed: true }] : []),
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Band distribution
// ---------------------------------------------------------------------------

/**
 * Segmented bar of the force split across the three bands.
 *
 * Segments carry a 2px surface gap and a written count, so the split survives
 * greyscale printing and colour-vision deficiency without relying on the hue.
 */
export function BandDistribution({
  routine,
  watch,
  review,
}: {
  routine: number;
  watch: number;
  review: number;
}) {
  const total = routine + watch + review || 1;
  const segments: Array<{ band: Band; count: number }> = [
    { band: 'routine', count: routine },
    { band: 'watch', count: watch },
    { band: 'review', count: review },
  ];

  return (
    <div>
      <div className="flex h-9 w-full gap-[2px] overflow-hidden rounded-sm">
        {segments.map((s) => (
          <div
            key={s.band}
            className="relative flex items-center justify-center transition-[flex-grow] duration-700"
            style={{
              flexGrow: Math.max(s.count, 0.001),
              background: BAND[s.band].css,
              transitionTimingFunction: 'cubic-bezier(0.22,1,0.36,1)',
            }}
            title={`${BAND[s.band].label}: ${s.count}`}
          >
            {s.count / total > 0.09 ? (
              <span className="font-mono text-[11px] text-[var(--paper-raised)] tnum">{s.count}</span>
            ) : null}
          </div>
        ))}
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5">
        {segments.map((s) => (
          <li key={s.band} className="flex items-baseline gap-1.5 text-[12px]">
            <span className="size-2 translate-y-[-1px] rounded-[1px]" style={{ background: BAND[s.band].css }} />
            <span className="text-ink-muted">{BAND[s.band].label}</span>
            <span className="font-mono text-ink-strong tnum">{s.count}</span>
            <span className="font-mono text-[10.5px] text-ink-faint tnum">
              {Math.round((s.count / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alert velocity
// ---------------------------------------------------------------------------

export function AlertVelocity({
  data,
  height = 190,
}: {
  data: Array<{ date: string; newAlerts: number; resolved: number; activeTotal: number }>;
  height?: number;
}) {
  const shaped = data.map((d) => ({ ...d, label: d.date.slice(5) }));
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={shaped} margin={{ top: 6, right: 8, bottom: 0, left: -22 }}>
          <CartesianGrid vertical={false} stroke="var(--viz-grid)" strokeOpacity={0.55} />
          <XAxis dataKey="label" {...AXIS} minTickGap={16} />
          <YAxis width={40} {...AXIS} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: 'var(--paper-inset)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as { date: string; newAlerts: number; resolved: number; activeTotal: number };
              return (
                <TooltipShell
                  title={p.date}
                  rows={[
                    { label: 'Entered review band', value: p.newAlerts, color: 'var(--viz-4)' },
                    { label: 'Left review band', value: p.resolved, color: 'var(--viz-1)' },
                    { label: 'Active caseload', value: p.activeTotal, color: 'var(--viz-3)' },
                  ]}
                />
              );
            }}
          />
          <Bar dataKey="newAlerts" fill="var(--viz-4)" radius={[3, 3, 0, 0]} maxBarSize={16} animationDuration={700} />
          <Bar dataKey="resolved" fill="var(--viz-1)" radius={[3, 3, 0, 0]} maxBarSize={16} animationDuration={700} />
          <Line
            type="monotone"
            dataKey="activeTotal"
            stroke="var(--viz-3)"
            strokeWidth={2}
            dot={false}
            animationDuration={900}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <Legend
        className="mt-2 pl-5"
        items={[
          { label: 'Entered review band', color: 'var(--viz-4)' },
          { label: 'Left review band', color: 'var(--viz-1)' },
          { label: 'Active caseload', color: 'var(--viz-3)' },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Counterfactual trajectory
// ---------------------------------------------------------------------------

export function TrajectoryChart({
  data,
  height = 220,
}: {
  data: Array<{ day: string; baseline: number; simulated: number }>;
  height?: number;
}) {
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 8, right: 10, bottom: 0, left: -18 }}>
          <ReferenceArea y1={0} y2={40} fill="var(--signal-routine)" fillOpacity={0.05} />
          <ReferenceArea y1={40} y2={65} fill="var(--signal-watch)" fillOpacity={0.06} />
          <ReferenceArea y1={65} y2={100} fill="var(--signal-review)" fillOpacity={0.07} />
          <CartesianGrid vertical={false} stroke="var(--viz-grid)" strokeOpacity={0.5} />
          <XAxis dataKey="day" {...AXIS} />
          <YAxis domain={[0, 100]} ticks={[0, 40, 65, 100]} width={44} {...AXIS} />
          <Tooltip
            cursor={{ stroke: 'var(--ink-faint)', strokeDasharray: '3 3' }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as { baseline: number; simulated: number };
              return (
                <TooltipShell
                  title={String(label)}
                  rows={[
                    { label: 'No action', value: p.baseline.toFixed(1), color: 'var(--viz-4)' },
                    { label: 'With intervention', value: p.simulated.toFixed(1), color: 'var(--viz-1)' },
                  ]}
                  footer={`Difference ${(p.simulated - p.baseline).toFixed(1)} index points`}
                />
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="baseline"
            stroke="var(--viz-4)"
            strokeWidth={2}
            strokeDasharray="4 3"
            dot={false}
            animationDuration={800}
          />
          <Line
            type="monotone"
            dataKey="simulated"
            stroke="var(--viz-1)"
            strokeWidth={2.4}
            dot={{ r: 2.5, strokeWidth: 0, fill: 'var(--viz-1)' }}
            animationDuration={800}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <Legend
        className="mt-2 pl-6"
        items={[
          { label: 'If nothing changes', color: 'var(--viz-4)', dashed: true },
          { label: 'With the selected measures', color: 'var(--viz-1)' },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

/**
 * Predicted probability against observed frequency.
 *
 * A model can have excellent ranking (AUC) and still lie about magnitude. This
 * is the chart that shows whether "72% chance of escalation" means anything,
 * and it is the one a careful evaluator looks for.
 */
export function CalibrationPlot({
  bins,
  height = 230,
}: {
  bins: Array<{ bin: string; predicted: number; observed: number; count: number }>;
  height?: number;
}) {
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: -14 }}>
          <CartesianGrid stroke="var(--viz-grid)" strokeOpacity={0.55} />
          <XAxis
            type="number"
            dataKey="predicted"
            domain={[0, 1]}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            {...AXIS}
            label={{ value: 'predicted', position: 'insideBottom', offset: -2, fill: 'var(--viz-axis)', fontSize: 10 }}
          />
          <YAxis
            type="number"
            dataKey="observed"
            domain={[0, 1]}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
            width={46}
            {...AXIS}
          />
          <ZAxis type="number" dataKey="count" range={[40, 320]} />
          <ReferenceLine
            segment={[
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ]}
            stroke="var(--ink-faint)"
            strokeDasharray="4 4"
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as { bin: string; predicted: number; observed: number; count: number };
              return (
                <TooltipShell
                  title={`bin ${p.bin}`}
                  rows={[
                    { label: 'Predicted', value: `${(p.predicted * 100).toFixed(1)}%` },
                    { label: 'Observed', value: `${(p.observed * 100).toFixed(1)}%` },
                    { label: 'Cases', value: p.count },
                  ]}
                  footer={
                    Math.abs(p.predicted - p.observed) < 0.05
                      ? 'Well calibrated in this range'
                      : p.predicted > p.observed
                        ? 'Model is over-confident here'
                        : 'Model is under-confident here'
                  }
                />
              );
            }}
          />
          <Scatter data={bins} fill="var(--viz-1)" fillOpacity={0.75} />
        </ScatterChart>
      </ResponsiveContainer>
      <p className="mt-1.5 pl-6 text-[11.5px] text-ink-muted">
        Points on the dashed line mean a stated probability matches how often it
        actually happened. Marker size is the number of cases in that bin.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

export function Sparkline({
  values,
  width = 72,
  height = 22,
  color = 'var(--viz-1)',
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  if (values.length < 2) return <div style={{ width, height }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * width},${height - ((v - min) / span) * (height - 3) - 1.5}`)
    .join(' ');

  return (
    <svg width={width} height={height} aria-hidden className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      <circle
        cx={width}
        cy={height - ((values[values.length - 1] - min) / span) * (height - 3) - 1.5}
        r={2.2}
        fill={color}
      />
    </svg>
  );
}

/** Global feature importance, as a ranked bar list. */
export function ImportanceBars({
  items,
  height = 250,
}: {
  items: Array<{ name: string; importance: number }>;
  height?: number;
}) {
  const max = Math.max(...items.map((i) => i.importance), 0.001);
  return (
    <ul className="space-y-2" style={{ minHeight: height }}>
      {items.map((item, i) => (
        <li key={item.name} className="flex items-center gap-3">
          <span className="w-[150px] shrink-0 truncate text-[12.5px] text-ink-muted" title={item.name}>
            {item.name}
          </span>
          <div className="h-[14px] flex-1 rounded-[2px] bg-paper-inset">
            <div
              className="h-full rounded-[2px] transition-[width] duration-700"
              style={{
                width: `${(item.importance / max) * 100}%`,
                background: 'var(--viz-1)',
                opacity: 1 - i * 0.055,
                transitionTimingFunction: 'cubic-bezier(0.22,1,0.36,1)',
              }}
            />
          </div>
          <span className="w-[42px] shrink-0 text-right font-mono text-[11px] text-ink-faint tnum">
            {(item.importance * 100).toFixed(1)}%
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Confusion matrix rendered as a small heat grid with written counts. */
export function ConfusionMatrix({
  labels,
  matrix,
}: {
  labels: string[];
  matrix: number[][];
}) {
  const max = Math.max(...matrix.flat(), 1);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[320px] border-separate border-spacing-[2px] text-[12px]">
        <thead>
          <tr>
            <th className="w-[84px]" />
            {labels.map((l) => (
              <th key={l} className="pb-1 font-mono text-[10px] font-normal uppercase tracking-[0.08em] text-ink-faint">
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={labels[i]}>
              <th className="pr-2 text-right font-mono text-[10px] font-normal uppercase tracking-[0.08em] text-ink-faint">
                {labels[i]}
              </th>
              {row.map((v, j) => (
                <td
                  key={`${i}-${j}`}
                  className="rounded-[3px] p-2 text-center font-mono tnum"
                  style={{
                    background:
                      i === j
                        ? `color-mix(in srgb, var(--viz-1) ${12 + (v / max) * 68}%, var(--paper-inset))`
                        : `color-mix(in srgb, var(--viz-4) ${8 + (v / max) * 55}%, var(--paper-inset))`,
                    color: v / max > 0.45 ? 'var(--paper-raised)' : 'var(--ink)',
                  }}
                  title={`Actual ${labels[i]} predicted ${labels[j]}: ${v}`}
                >
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11.5px] text-ink-muted">
        Rows are the actual band, columns the predicted band. The diagonal is agreement.
      </p>
    </div>
  );
}

export { Cell };
