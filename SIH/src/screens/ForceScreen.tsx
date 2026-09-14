/**
 * Force overview — the command view.
 *
 * The hard part of this screen is what it must *not* show. A commanding officer
 * genuinely needs to know where his force is under strain; he must not be able
 * to work out which of his people is struggling. So everything here is an
 * aggregate over a cohort of at least ten, individuals appear only as
 * pseudonyms in the live feed, and the privacy rule is stated on the screen
 * rather than buried in documentation — partly so the officer trusts it, and
 * partly so his people do.
 */

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { api } from '../api/client.js';
import { useAsync, useLiveEvents, usePolling } from '../app/hooks.js';
import { ScreenIntro } from '../app/AppShell.js';
import { alertIn, stagger, staggerItem } from '../design/motion.js';
import {
  BandBadge,
  Chip,
  EmptyState,
  ErrorNote,
  Eyebrow,
  Info,
  Panel,
  PanelHeader,
  Skeleton,
  Stat,
  Ticker,
  cx,
  bandOf,
} from '../design/primitives.js';
import { AlertVelocity, BandDistribution, Sparkline } from '../components/charts/Charts.js';

const LIVE_TYPES = ['alert.raised', 'case.opened', 'assessment.created'];

export function ForceScreen({ onOpenUnits }: { onOpenUnits: () => void }) {
  const overview = useAsync(() => api.getForceOverview(), []);
  const units = useAsync(() => api.getUnitIntelligence(), []);
  const { events, connected } = useLiveEvents(LIVE_TYPES, { limit: 12 });

  // A check-in submitted on another screen should show up here without a
  // refresh; the stream tells us something changed, this refetches the numbers.
  usePolling(() => {
    overview.refetch();
    units.refetch();
  }, 30_000);

  React.useEffect(() => {
    if (events.length) {
      const t = setTimeout(() => overview.refetch(), 600);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.length]);

  if (overview.loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-9 w-80" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[118px]" />
          ))}
        </div>
        <Skeleton className="h-[280px]" />
      </div>
    );
  }

  if (overview.error) return <ErrorNote onRetry={overview.refetch}>{overview.error.message}</ErrorNote>;
  const o = overview.data!.overview;
  const assessed = o.lowRisk + o.moderateRisk + o.highRisk;

  return (
    <motion.div variants={stagger(0.03, 0.05)} initial="hidden" animate="show">
      <ScreenIntro
        title="Force welfare posture"
        lede={`${o.totalMonitored} personnel monitored across ${units.data?.units.length ?? 0} units. Aggregates only — no individual record on this screen, by design.`}
      />

      {/* Headline figures */}
      <motion.div variants={staggerItem} className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Panel>
          <Stat
            label="Readiness score"
            value={<Ticker value={o.readinessScore} />}
            unit="/ 100"
            hint="Derived from the mean welfare index across all assessed personnel."
          />
        </Panel>
        <Panel>
          <Stat
            label="In review band"
            value={<Ticker value={o.highRisk} />}
            unit={`of ${assessed}`}
            tone="review"
            hint="Each has a welfare officer contact due within 24 hours."
          />
        </Panel>
        <Panel>
          <Stat
            label="In watch band"
            value={<Ticker value={o.moderateRisk} />}
            unit={`of ${assessed}`}
            tone="watch"
            hint="Raise at the next unit welfare review."
          />
        </Panel>
        <Panel>
          <Stat
            label="Entered review today"
            value={<Ticker value={o.criticalTrendAlerts} />}
            hint="New escalations in the most recent scored day."
          />
        </Panel>
      </motion.div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-5">
          <motion.div variants={staggerItem}>
            <Panel>
              <PanelHeader
                eyebrow="Distribution"
                title="Where the force sits"
                description="Every assessed individual, placed in one of three operating bands."
                actions={
                  <Info label="Band thresholds">
                    Routine below 40, watch 40–64, review 65 and above. Thresholds
                    are fixed in the model artifact and shown on the model card.
                  </Info>
                }
              />
              <div className="px-5 py-5">
                <BandDistribution routine={o.lowRisk} watch={o.moderateRisk} review={o.highRisk} />
              </div>
            </Panel>
          </motion.div>

          <motion.div variants={staggerItem}>
            <Panel>
              <PanelHeader
                eyebrow="Fourteen days"
                title="Escalation velocity"
                description="Movement in and out of the review band, and the resulting active caseload."
              />
              <div className="px-4 py-4">
                <AlertVelocity data={o.alertVelocity} />
              </div>
            </Panel>
          </motion.div>

          <motion.div variants={staggerItem}>
            <Panel>
              <PanelHeader
                eyebrow="Systemic"
                title="Where the pressure is concentrated"
                description="Units ranked by mean index, each with the factor its own members' attributions most often name."
                actions={
                  <button
                    onClick={onOpenUnits}
                    className="font-mono text-[10.5px] uppercase tracking-[0.09em] text-ink-faint hover:text-ink"
                  >
                    All units →
                  </button>
                }
              />
              <ul className="divide-y divide-rule-hairline">
                {o.systemicHotspots.length === 0 ? (
                  <li>
                    <EmptyState
                      title="No unit above the force average"
                      description="Every cohort large enough to report is sitting at or below the mean."
                    />
                  </li>
                ) : (
                  o.systemicHotspots.map((h, i) => {
                    const unit = units.data?.units.find((u) => u.unitName === h.unitName);
                    return (
                      <motion.li
                        key={h.unitName}
                        variants={staggerItem}
                        className="flex items-center gap-4 px-5 py-3.5"
                      >
                        <span className="w-5 shrink-0 font-mono text-[11px] text-ink-faint tnum">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13.5px] text-ink">{h.unitName}</div>
                          <div className="truncate text-[11.5px] text-ink-faint">
                            Dominant driver: {h.primaryFactor}
                          </div>
                        </div>
                        {unit?.weeklyTrend?.length ? (
                          <Sparkline values={unit.weeklyTrend} color="var(--viz-1)" />
                        ) : null}
                        <span className="w-10 shrink-0 text-right font-mono text-[14px] text-ink-strong tnum">
                          {h.riskScore}
                        </span>
                        <BandBadge band={bandOf(h.riskScore)} size="sm" showDot={false} />
                      </motion.li>
                    );
                  })
                )}
              </ul>
            </Panel>
          </motion.div>
        </div>

        {/* Live column */}
        <motion.div variants={staggerItem} className="min-w-0 space-y-5">
          <Panel>
            <PanelHeader
              eyebrow="Live"
              title="Welfare feed"
              description="Pushed from the server as check-ins are scored."
              actions={
                <span
                  className={cx(
                    'size-1.5 rounded-full',
                    connected ? 'bg-routine' : 'bg-watch',
                  )}
                  title={connected ? 'Stream connected' : 'Reconnecting'}
                />
              }
            />
            <div className="max-h-[420px] overflow-y-auto px-4 py-3">
              {events.length === 0 ? (
                <p className="py-6 text-center text-[12px] leading-relaxed text-ink-faint">
                  Nothing since this page opened.
                  <br />
                  Submit a check-in and it will appear here within a second.
                </p>
              ) : (
                <ul className="space-y-2">
                  <AnimatePresence initial={false}>
                    {events.map((e) => (
                      <motion.li
                        key={e.id + e.type}
                        variants={alertIn}
                        initial="hidden"
                        animate="show"
                        exit="exit"
                        className="overflow-hidden rounded-sm border border-rule bg-paper-inset px-3 py-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-faint">
                            {String(e.type).replace('.', ' · ')}
                          </span>
                          <span className="font-mono text-[10px] text-ink-faint">
                            {new Date(e.at).toLocaleTimeString()}
                          </span>
                        </div>
                        <div className="mt-1 text-[12.5px] text-ink">
                          {(e.payload.headline as string) ??
                            (e.payload.reason as string) ??
                            `Index ${e.payload.wri ?? '—'} recorded`}
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="font-mono text-[10px] text-ink-faint">
                            {(e.payload.token as string) ?? 'anonymous'}
                          </span>
                          {e.payload.unitName ? (
                            <span className="truncate text-[10.5px] text-ink-faint">
                              · {e.payload.unitName as string}
                            </span>
                          ) : null}
                        </div>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </div>
          </Panel>

          <Panel inset className="px-4 py-4">
            <Eyebrow>What command cannot see</Eyebrow>
            <ul className="mt-3 space-y-2.5 text-[12.5px] leading-relaxed text-ink-muted">
              {[
                'Any individual by name or service number.',
                'Any check-in text, ever.',
                'Any figure for a cohort smaller than ten people.',
                'Anything at all about a specific person, including from this feed — entries carry a keyed pseudonym that cannot be reversed without the server key.',
              ].map((line) => (
                <li key={line} className="flex gap-2.5">
                  <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-review" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Chip>k-anonymity k=10</Chip>
              <Chip>HMAC pseudonyms</Chip>
              <Chip>every access logged</Chip>
            </div>
          </Panel>
        </motion.div>
      </div>
    </motion.div>
  );
}
