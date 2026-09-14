/**
 * Welfare officer casework.
 *
 * The unit of work is a conversation with a person, not a ticket, and the
 * interface is built around that: the officer sees why the model flagged this
 * individual, what it suggests doing, what effect the model expects, and an
 * explicit control to *disagree* with the recommendation and record why.
 *
 * That last part matters more than it looks. A system where the only available
 * action is "accept" produces compliance, not judgement, and the dissent record
 * is the only honest source of data on where the model is wrong.
 */

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { api, ApiError } from '../api/client.js';
import type { Dossier } from '../api/client.js';
import { useAsync } from '../app/hooks.js';
import { ScreenIntro } from '../app/AppShell.js';
import { duration, ease, screen, stagger, staggerItem } from '../design/motion.js';
import {
  BAND,
  BandBadge,
  Button,
  Chip,
  EmptyState,
  ErrorNote,
  Eyebrow,
  Field,
  Panel,
  PanelHeader,
  Skeleton,
  Tabs,
  cx,
  inputClass,
} from '../design/primitives.js';
import { DriverList, RiskDial, ShapWaterfall } from '../components/explain/Explainability.js';
import { TrajectoryChart, WelfareTrend } from '../components/charts/Charts.js';
import type { CaseStatus, WelfareCase } from '../types.js';

const STATUS_LABEL: Record<CaseStatus, string> = {
  new: 'New',
  acknowledged: 'Acknowledged',
  follow_up_scheduled: 'Follow-up booked',
  closed: 'Closed',
};

export function CaseworkScreen() {
  const cases = useAsync(() => api.getCases(), []);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'open' | 'all'>('open');

  if (cases.loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-64" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }
  if (cases.error) return <ErrorNote onRetry={cases.refetch}>{cases.error.message}</ErrorNote>;

  const all = cases.data?.cases ?? [];
  const open = all.filter((c) => c.status !== 'closed');
  const shown = filter === 'open' ? open : all;
  const active = shown.find((c) => c.id === openId) ?? shown[0] ?? null;

  return (
    <motion.div variants={stagger(0.03, 0.05)} initial="hidden" animate="show">
      <ScreenIntro
        title="Casework"
        lede="Cases assigned to you. Each was opened by one of four documented rules: someone asked for help, their index stayed in the review band, the forecast says it is about to, or they have spent a fortnight in the watch band still climbing."
      />

      <motion.div variants={staggerItem} className="mb-5">
        <Tabs
          items={[
            { id: 'open' as const, label: 'Open', count: open.length },
            { id: 'all' as const, label: 'All', count: all.length },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </motion.div>

      {shown.length === 0 ? (
        <Panel>
          <EmptyState
            title="No open cases"
            description="Nobody assigned to you is currently in the review band, and no one has asked to be contacted."
          />
        </Panel>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[330px_minmax(0,1fr)]">
          <motion.ul variants={staggerItem} className="space-y-2.5">
            {shown.map((c) => (
              <CaseRow key={c.id} kase={c} active={active?.id === c.id} onSelect={() => setOpenId(c.id)} />
            ))}
          </motion.ul>

          <AnimatePresence mode="wait">
            {active ? (
              <motion.div key={active.id} variants={screen} initial="hidden" animate="show" exit="exit">
                <CaseDetail kase={active} onChanged={cases.refetch} />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  );
}

function CaseRow({
  kase,
  active,
  onSelect,
}: {
  kase: WelfareCase;
  active: boolean;
  onSelect: () => void;
}) {
  const band = kase.latestBand as 'routine' | 'watch' | 'review';
  const overdue = new Date(kase.dueAt).getTime() < Date.now() && kase.status !== 'closed';

  return (
    <li>
      <button
        onClick={onSelect}
        className={cx(
          'relative w-full overflow-hidden rounded-lg border bg-paper-raised p-4 text-left transition-shadow',
          active ? 'border-accent/50 shadow-e2' : 'border-rule shadow-e1 hover:shadow-e2',
        )}
      >
        <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: BAND[band].css }} />
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-mono text-[11px] text-ink-faint">{kase.personnelAlias}</div>
            <div className="mt-0.5 truncate text-[13px] text-ink">{kase.unitName}</div>
          </div>
          <span className="shrink-0 font-serif text-[24px] leading-none tnum" style={{ color: BAND[band].css }}>
            {Math.round(kase.latestIndex)}
          </span>
        </div>
        <p className="mt-2 line-clamp-2 text-[12px] leading-snug text-ink-muted">{kase.reason}</p>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Chip tone={kase.status === 'closed' ? 'neutral' : 'accent'}>{STATUS_LABEL[kase.status]}</Chip>
          {kase.supportRequested ? <Chip tone="accent">asked for support</Chip> : null}
          {overdue ? <Chip tone="warn">overdue</Chip> : null}
        </div>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------

function CaseDetail({ kase, onChanged }: { kase: WelfareCase; onChanged: () => void }) {
  const dossier = useAsync(() => api.getDossier(kase.personnelId), [kase.personnelId]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'why' | 'plan' | 'timeline'>('why');

  const act = async (status: CaseStatus) => {
    if (note.trim().length < 3) {
      setErr('Add a short note describing the action taken — it becomes part of the case record.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.updateCase(kase.id, status, note.trim());
      setNote('');
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reviewRec = async (recId: string, decision: 'accepted' | 'dismissed') => {
    const reason =
      decision === 'dismissed'
        ? window.prompt('Why is this recommendation not appropriate? This is recorded and used to evaluate the model.')
        : window.prompt('Any note on how this will be actioned?') || 'Accepted as proposed';
    if (!reason) return;
    setBusy(true);
    try {
      await api.reviewRecommendation(kase.id, recId, decision, reason);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const d: Dossier | null = dossier.data?.dossier ?? null;
  const band = kase.latestBand as 'routine' | 'watch' | 'review';

  return (
    <div className="space-y-5">
      <Panel>
        <PanelHeader
          eyebrow={kase.personnelAlias}
          title={kase.unitName}
          description={kase.reason}
          actions={<BandBadge band={band} />}
        />

        <div className="grid gap-5 px-5 py-5 sm:grid-cols-[200px_minmax(0,1fr)]">
          <div className="flex justify-center">
            {d ? (
              <RiskDial
                value={d.assessment.wri}
                band={d.assessment.band}
                interval={d.assessment.interval}
                forecast={d.assessment.forecast7d}
                size={168}
              />
            ) : (
              <Skeleton className="size-[168px] rounded-full" />
            )}
          </div>

          <div className="space-y-3">
            <Tabs
              items={[
                { id: 'why' as const, label: 'Why flagged' },
                { id: 'plan' as const, label: 'What to do', count: d?.recommendations.length },
                { id: 'timeline' as const, label: 'Timeline', count: kase.events.length },
              ]}
              value={tab}
              onChange={setTab}
              layoutId={`case-tabs-${kase.id}`}
            />

            <AnimatePresence mode="wait">
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: duration.fast, ease }}
                className="pt-1"
              >
                {tab === 'why' ? (
                  d ? (
                    <DriverList
                      attributions={[...d.assessment.drivers, ...d.assessment.protectiveFactors]}
                      limit={5}
                      title="Contributing factors"
                    />
                  ) : (
                    <Skeleton className="h-40" />
                  )
                ) : null}

                {tab === 'plan' ? (
                  d ? (
                    <div className="space-y-3">
                      {d.recommendations.length === 0 ? (
                        <p className="text-[12.5px] text-ink-muted">
                          The model does not project a meaningful reduction from any
                          standing measure for this individual. Use your own judgement.
                        </p>
                      ) : (
                        d.recommendations.map((r) => (
                          <div key={r.id} className="rounded-sm border border-rule bg-paper-inset p-3.5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-[13.5px] text-ink-strong">{r.title}</div>
                                <div className="mt-0.5 font-mono text-[10px] text-ink-faint">
                                  {r.owner} · {r.effortDays}d
                                </div>
                              </div>
                              <span className="shrink-0 font-mono text-[13px] text-routine tnum">
                                −{r.projectedRiskReduction}
                              </span>
                            </div>
                            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-muted">{r.action}</p>
                            <p className="mt-2 border-l-2 border-rule pl-2.5 text-[11.5px] leading-relaxed text-ink-faint">
                              {r.evidence}
                              <span className="mt-1 block font-mono text-[10px]">{r.citation}</span>
                            </p>
                            <p className="mt-2 font-mono text-[10.5px] leading-relaxed text-ink-faint">
                              {r.rationale}
                            </p>
                          </div>
                        ))
                      )}

                      {d.plan ? (
                        <div className="rounded-sm border border-accent/25 bg-accent-soft p-3.5">
                          <Eyebrow>All measures together</Eyebrow>
                          <div className="mt-1.5 flex items-baseline gap-2">
                            <span className="font-serif text-[26px] leading-none text-accent tnum">
                              −{d.plan.combinedRiskReduction}
                            </span>
                            <span className="text-[12px] text-ink-muted">index points</span>
                          </div>
                          <p className="mt-2 text-[11.5px] leading-relaxed text-ink-muted">
                            Individually these sum to −{d.plan.naiveSumOfIndividualEffects}.{' '}
                            {d.plan.interactionNote}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <Skeleton className="h-40" />
                  )
                ) : null}

                {tab === 'timeline' ? (
                  <ol className="relative space-y-3 pl-4">
                    <span className="absolute inset-y-1 left-[3px] w-px bg-rule" />
                    {[...kase.events].reverse().map((e) => (
                      <li key={e.id} className="relative">
                        <span className="absolute -left-4 top-[6px] size-[7px] rounded-full border-2 border-paper-raised bg-rule-strong" />
                        <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-faint">
                          {e.action.replace(/_/g, ' ')} · {new Date(e.timestamp).toLocaleString()}
                        </div>
                        <div className="mt-0.5 text-[12.5px] leading-snug text-ink">{e.conciseNote}</div>
                        <div className="text-[11px] text-ink-faint">{e.actorName}</div>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </Panel>

      {d ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel>
            <PanelHeader eyebrow="Attribution" title="How the index was reached" />
            <div className="px-5 py-5">
              <ShapWaterfall
                baseValue={d.assessment.baseValue}
                prediction={d.assessment.wri}
                attributions={[...d.assessment.drivers, ...d.assessment.protectiveFactors]}
                maxBars={6}
              />
            </div>
          </Panel>
          <Panel>
            <PanelHeader eyebrow="History" title="Index over the last fortnight" />
            <div className="px-4 py-4">
              <WelfareTrend
                data={d.history.map((h) => ({ date: h.date, index: h.index, band: h.band, forecast: h.forecast ?? null }))}
                height={200}
              />
            </div>
          </Panel>
        </div>
      ) : null}

      {d?.plan ? (
        <Panel>
          <PanelHeader
            eyebrow="Projection"
            title="Expected recovery if the full plan is actioned"
            description="Modelled by re-running this individual's own feature vector through the same ensemble with the intervention applied."
          />
          <div className="px-4 py-4">
            <TrajectoryChart data={d.plan.projected} />
          </div>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader eyebrow="Record an action" title="Update the case" />
        <div className="space-y-3 px-5 py-5">
          <Field
            label="What did you do?"
            hint="This becomes a permanent, hash-chained entry on the case and in the audit log."
          >
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder="Spoke privately; rest day authorised from Thursday; will review Monday."
              className={cx(inputClass, 'resize-none')}
            />
          </Field>
          {err ? <ErrorNote>{err}</ErrorNote> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={busy} onClick={() => act('acknowledged')}>
              Acknowledge
            </Button>
            <Button loading={busy} onClick={() => act('follow_up_scheduled')}>
              Schedule follow-up
            </Button>
            <Button variant="ghost" loading={busy} onClick={() => act('closed')}>
              Close case
            </Button>
          </div>

          {kase.recommendations.some((r) => r.reviewStatus === 'pending') ? (
            <div className="rule-t pt-4">
              <Eyebrow>Pending recommendations</Eyebrow>
              <ul className="mt-2.5 space-y-2">
                {kase.recommendations
                  .filter((r) => r.reviewStatus === 'pending')
                  .map((r) => (
                    <li key={r.id} className="rounded-sm border border-rule bg-paper-inset p-3">
                      <p className="text-[12.5px] leading-relaxed text-ink">{r.proposedAction}</p>
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" variant="primary" onClick={() => reviewRec(r.id, 'accepted')}>
                          Accept
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => reviewRec(r.id, 'dismissed')}>
                          Not appropriate
                        </Button>
                      </div>
                    </li>
                  ))}
              </ul>
              <p className="mt-2.5 text-[11.5px] leading-relaxed text-ink-faint">
                Dismissing a recommendation is a legitimate outcome, not a failure.
                Recorded reasons are how we find out where the model is wrong.
              </p>
            </div>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
