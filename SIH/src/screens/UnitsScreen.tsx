/**
 * Unit intelligence.
 *
 * A heat grid is the obvious form here and mostly the right one, but the
 * interesting design problem is the suppressed cell. A unit below the
 * k-anonymity threshold must show *something* — an absent tile invites the
 * reader to assume the worst, or worse, to go and find out. So a suppressed
 * unit renders as a deliberate, legible refusal that says why.
 */

import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';

import { api } from '../api/client.js';
import { useAsync } from '../app/hooks.js';
import { ScreenIntro } from '../app/AppShell.js';
import { duration, ease, stagger, staggerItem } from '../design/motion.js';
import {
  BAND,
  BandBadge,
  Chip,
  ErrorNote,
  Eyebrow,
  Info,
  Panel,
  PanelHeader,
  Skeleton,
  cx,
  bandOf,
} from '../design/primitives.js';
import { Sparkline } from '../components/charts/Charts.js';
import type { UnitHeatmapItem } from '../types.js';

export function UnitsScreen() {
  const units = useAsync(() => api.getUnitIntelligence(), []);
  const [selected, setSelected] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...(units.data?.units ?? [])].sort((a, b) => b.riskScore - a.riskScore),
    [units.data],
  );
  const active = sorted.find((u) => u.id === selected) ?? sorted.find((u) => !u.isSuppressed) ?? sorted[0];

  if (units.loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-9 w-72" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[168px]" />
          ))}
        </div>
      </div>
    );
  }
  if (units.error) return <ErrorNote onRetry={units.refetch}>{units.error.message}</ErrorNote>;

  return (
    <motion.div variants={stagger(0.03, 0.06)} initial="hidden" animate="show">
      <ScreenIntro
        title="Unit intelligence"
        lede="Each unit's mean welfare index, its seven-day trajectory, and the operational conditions behind it."
      />

      <motion.div variants={staggerItem} className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((u, i) => (
          <UnitTile
            key={u.id}
            unit={u}
            index={i}
            selected={active?.id === u.id}
            onSelect={() => setSelected(u.id)}
          />
        ))}
      </motion.div>

      {active && !active.isSuppressed ? (
        <motion.div variants={staggerItem}>
          <Panel>
            <PanelHeader
              eyebrow="Detail"
              title={active.unitName}
              description={`${active.personnelCount} personnel · ${active.sector}`}
              actions={<BandBadge band={active.band as 'routine' | 'watch' | 'review'} />}
            />
            <dl className="grid grid-cols-2 divide-x divide-y divide-rule-hairline sm:grid-cols-4 sm:divide-y-0">
              <Metric
                label="Mean index"
                value={active.riskScore.toFixed(0)}
                note={BAND[active.band as 'routine' | 'watch' | 'review'].label}
              />
              <Metric
                label="Avg duty"
                value={`${active.avgShiftHours.toFixed(1)}h`}
                note="per day, seven-day mean"
              />
              <Metric
                label="Night ratio"
                value={`${active.nightShiftRatio}%`}
                note="share of the week on night duty"
              />
              <Metric
                label="Deployment"
                value={`${active.deploymentDurationDays}d`}
                note="mean continuous days in post"
              />
            </dl>
            <div className="border-t border-rule-hairline px-5 py-4">
              <Eyebrow>Seven-day trajectory</Eyebrow>
              <div className="mt-3 flex items-end gap-1.5">
                {active.weeklyTrend.map((v, i) => {
                  const band = bandOf(v);
                  return (
                    <motion.div
                      key={i}
                      initial={{ height: 0 }}
                      animate={{ height: `${Math.max(6, (v / 100) * 92)}px` }}
                      transition={{ duration: duration.slow, ease, delay: i * 0.05 }}
                      className="group relative flex-1 rounded-t-[2px]"
                      style={{ background: BAND[band].css, opacity: 0.85 }}
                      title={`Day ${i + 1}: ${v}`}
                    >
                      <span className="absolute -top-5 left-1/2 -translate-x-1/2 font-mono text-[10px] text-ink-faint opacity-0 transition-opacity group-hover:opacity-100">
                        {v}
                      </span>
                    </motion.div>
                  );
                })}
              </div>
              <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-ink-faint">
                <span>7 days ago</span>
                <span>today</span>
              </div>
            </div>
          </Panel>
        </motion.div>
      ) : null}
    </motion.div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="px-5 py-4">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1.5 font-serif text-[26px] leading-none text-ink-strong tnum">{value}</dd>
      <dd className="mt-1 text-[11.5px] text-ink-faint">{note}</dd>
    </div>
  );
}

function UnitTile({
  unit,
  index,
  selected,
  onSelect,
}: {
  unit: UnitHeatmapItem;
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  if (unit.isSuppressed) {
    return (
      <motion.div
        variants={staggerItem}
        className="relative overflow-hidden rounded-lg border border-dashed border-rule-strong bg-paper-inset p-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Eyebrow>Suppressed</Eyebrow>
            <h4 className="mt-1 truncate text-[16px]">{unit.unitName}</h4>
          </div>
          <Info label="k-anonymity">
            Releasing an average over fewer than ten people, alongside a roster,
            identifies individuals. The suppression is enforced in the query
            layer, not hidden in the interface.
          </Info>
        </div>
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-muted">
          {unit.personnelCount} personnel — below the reporting threshold of 10.
          No aggregate is released for this cohort.
        </p>
        <div className="mt-3">
          <Chip>k &lt; 10</Chip>
        </div>
      </motion.div>
    );
  }

  const band = unit.band as 'routine' | 'watch' | 'review';
  return (
    <motion.button
      variants={staggerItem}
      onClick={onSelect}
      className={cx(
        'group relative overflow-hidden rounded-lg border bg-paper-raised p-5 text-left transition-shadow',
        selected ? 'border-accent/50 shadow-e2' : 'border-rule shadow-e1 hover:shadow-e2',
      )}
    >
      {/* A band-coloured edge, so the tile reads at a glance from across a room. */}
      <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: BAND[band].css }} />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow>{unit.sector}</Eyebrow>
          <h4 className="mt-1 truncate text-[17px]">{unit.unitName}</h4>
        </div>
        <BandBadge band={band} size="sm" showDot={false} />
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <div>
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 * index, duration: duration.base, ease }}
            className="font-serif text-[38px] leading-none tnum"
            style={{ color: BAND[band].css }}
          >
            {unit.riskScore}
          </motion.div>
          <div className="mt-1 font-mono text-[10px] text-ink-faint">
            mean index · {unit.personnelCount} personnel
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Sparkline values={unit.weeklyTrend} color={BAND[band].css} width={80} height={26} />
          <span
            className={cx(
              'font-mono text-[10px]',
              unit.trendDirection === 'rising'
                ? 'text-review'
                : unit.trendDirection === 'declining'
                  ? 'text-routine'
                  : 'text-ink-faint',
            )}
          >
            {unit.trendDirection === 'rising' ? '▲ rising' : unit.trendDirection === 'declining' ? '▼ easing' : '— stable'}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-rule-hairline pt-3">
        <TinyStat label="duty" value={`${unit.avgShiftHours.toFixed(1)}h`} />
        <TinyStat label="nights" value={`${unit.nightShiftRatio}%`} />
        <TinyStat label="posting" value={`${unit.deploymentDurationDays}d`} />
      </div>
    </motion.button>
  );
}

function TinyStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-faint">{label}</div>
      <div className="mt-0.5 font-mono text-[13px] text-ink tnum">{value}</div>
    </div>
  );
}
