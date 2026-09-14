/**
 * "My welfare" — the individual's own view of what the system holds on them.
 *
 * This screen exists for a reason beyond usefulness: a person who can see
 * exactly what the model says about them, why it says it, and who has looked at
 * it, is in a position to challenge it. A welfare system nobody can inspect is
 * a surveillance system with better branding.
 */

import React from 'react';
import { motion } from 'motion/react';

import { api } from '../api/client.js';
import { useAsync } from '../app/hooks.js';
import { ScreenIntro } from '../app/AppShell.js';
import { stagger, staggerItem } from '../design/motion.js';
import {
  BAND,
  BandBadge,
  Button,
  Chip,
  EmptyState,
  ErrorNote,
  Eyebrow,
  Info,
  Panel,
  PanelHeader,
  Skeleton,
  Stat,
  cx,
} from '../design/primitives.js';
import {
  CategoryBreakdown,
  CoverageNote,
  DriverList,
  RiskDial,
  ShapWaterfall,
} from '../components/explain/Explainability.js';
import { WelfareTrend } from '../components/charts/Charts.js';
import { ScoreLedger } from '../components/charts/ScoreLedger.js';
import type { UserProfile } from '../types.js';

export function MyWelfareScreen({ user, onGoToCheckin }: { user: UserProfile; onGoToCheckin: () => void }) {
  const trends = useAsync(() => api.getTrends(), []);
  const consent = useAsync(() => api.getConsentLedger(), []);
  const scores = useAsync(() => api.getScores(), []);

  if (trends.loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-9 w-72" />
        <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Skeleton className="h-[340px]" />
          <Skeleton className="h-[340px]" />
        </div>
      </div>
    );
  }

  if (trends.error) {
    return <ErrorNote onRetry={trends.refetch}>{trends.error.message}</ErrorNote>;
  }

  const detail = trends.data?.detail ?? null;
  const history = trends.data?.history ?? [];

  if (!detail) {
    return (
      <Panel>
        <EmptyState
          title="Nothing recorded yet"
          description="Submit your first check-in and this page will show your index, what is driving it, and where the model expects it to go next."
          action={
            <Button variant="primary" onClick={onGoToCheckin}>
              Start a check-in
            </Button>
          }
        />
      </Panel>
    );
  }

  const trendData = history.map((h) => ({
    date: h.date,
    index: h.index,
    band: h.band,
    forecast: h.forecast ?? null,
  }));

  const first = history[0]?.index ?? detail.wri;
  const change = detail.wri - first;

  const ledgerDays = history.map((h) => ({
    date: h.date,
    index: h.index,
    band: h.band,
    forecast: h.forecast ?? null,
    sleepHours: h.sleepHours,
    dutyHours: h.dutyHours,
    perceivedStress: h.perceivedStress,
    perceivedFatigue: h.perceivedFatigue,
  }));

  const latestDate = history.length ? history[history.length - 1].date : null;

  return (
    <motion.div variants={stagger(0.04, 0.06)} initial="hidden" animate="show">
      <ScreenIntro
        title="Your welfare record"
        lede="Everything the system holds about you, and everything it concluded. Nothing here is shared with your chain of command."
        actions={
          <Button variant="primary" onClick={onGoToCheckin}>
            New check-in
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <motion.div variants={staggerItem} className="space-y-5">
          <Panel className="flex flex-col items-center px-5 py-7">
            <RiskDial value={detail.wri} band={detail.band} interval={detail.interval} forecast={detail.forecast7d} />
            <div className="mt-5 flex flex-col items-center gap-2">
              <BandBadge band={detail.band} />
              <p className="max-w-[250px] text-center text-[12.5px] leading-relaxed text-ink-muted">
                {BAND[detail.band].description}
              </p>
            </div>
          </Panel>

          <Panel className="divide-y divide-rule-hairline">
            <Stat
              label="Seven-day outlook"
              value={detail.forecast7d.toFixed(0)}
              delta={Number((detail.forecast7d - detail.wri).toFixed(1))}
              deltaLabel="pts"
              hint={
                detail.trajectory === 'rising'
                  ? 'The model expects this to climb. Worth acting before it does.'
                  : detail.trajectory === 'improving'
                    ? 'The model expects this to ease off.'
                    : 'The model expects this to hold roughly steady.'
              }
              tone={detail.forecastBand}
            />
            <Stat
              label="Change since first record"
              value={`${change > 0 ? '+' : ''}${change.toFixed(1)}`}
              hint={`Across ${history.length} check-ins, starting at ${first.toFixed(0)}.`}
            />
          </Panel>

          <CoverageNote coverage={detail.coverage} imputed={detail.imputed} />
        </motion.div>

        <motion.div variants={staggerItem} className="space-y-5">
          <Panel>
            <PanelHeader
              eyebrow="History"
              title="Your index over time"
              description="Solid line is what was measured. Dashed is what the model expected seven days later, plotted on the day it was made — so you can see where it was right and where it was not."
            />
            <div className="px-4 py-4">
              <WelfareTrend data={trendData} height={250} />
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              className="flex-wrap"
              eyebrow="Daily record"
              title="Score by day"
              description="Each day's index alongside the inputs that most often explain a move — sleep, duty hours and how you rated your own stress. Weeks start on Monday, like the roster."
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  {scores.data?.currentStreak ? (
                    <Chip>{scores.data.currentStreak}-day streak</Chip>
                  ) : null}
                  {latestDate ? <Chip>last entry {latestDate}</Chip> : null}
                </div>
              }
            />
            <ScoreLedger days={ledgerDays} summaries={scores.data ?? null} />
          </Panel>

          <Panel>
            <PanelHeader
              eyebrow="Explanation"
              title="How today's number was reached"
              description="Starting from the average across the training population, each factor moves the index up or down by exactly this much."
            />
            <div className="px-5 py-5">
              <ShapWaterfall
                baseValue={detail.baseValue}
                prediction={detail.wri}
                attributions={[...detail.drivers, ...detail.protectiveFactors]}
              />
            </div>
          </Panel>

          <div className="grid gap-5 md:grid-cols-2">
            <Panel>
              <div className="px-5 py-5">
                <CategoryBreakdown breakdown={detail.categoryBreakdown} />
              </div>
            </Panel>
            <Panel>
              <div className="px-5 py-5">
                <DriverList
                  attributions={[...detail.drivers, ...detail.protectiveFactors]}
                  limit={5}
                  title="Individual factors"
                />
              </div>
            </Panel>
          </div>

          <Panel>
            <PanelHeader
              eyebrow="Consent"
              title="Your permission record"
              description="Append-only. Withdrawing consent stops processing immediately but does not erase the record that it was once given."
              actions={
                <Info label="Why append-only?">
                  Under the DPDP Act the lawful basis for past processing has to
                  remain auditable. Deleting the grant would make it impossible to
                  show that earlier processing was permitted.
                </Info>
              }
            />
            <div className="px-5 py-4">
              {consent.loading ? (
                <Skeleton className="h-16" />
              ) : consent.data?.ledger.length ? (
                <ul className="space-y-2">
                  {consent.data.ledger.slice(0, 5).map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 text-[12.5px]">
                      <span className="flex items-center gap-2">
                        <span className={cx('size-1.5 rounded-full', c.granted ? 'bg-routine' : 'bg-review')} />
                        <span className="text-ink">{c.granted ? 'Consent granted' : 'Consent withdrawn'}</span>
                        <Chip>{c.scope}</Chip>
                      </span>
                      <span className="font-mono text-[10.5px] text-ink-faint">
                        {new Date(c.timestamp).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12.5px] text-ink-muted">
                  No consent events recorded for {user.id} yet.
                </p>
              )}
            </div>
          </Panel>

          <div className="flex flex-wrap gap-2">
            <Chip>model {detail.modelVersion}</Chip>
            <Chip>{history.length} assessments</Chip>
            <Chip>
              escalation probability {(detail.escalationProbability * 100).toFixed(0)}%
            </Chip>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
