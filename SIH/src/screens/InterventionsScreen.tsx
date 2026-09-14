/**
 * Intervention queue.
 *
 * Ranked by *measured* effect, not by severity. That ordering is the whole
 * argument: a welfare officer with four hours this week should spend them where
 * the model says they will move the most, which is frequently not on the
 * highest-scoring individual. Every row carries the counterfactual it came from
 * and the evidence behind it, so the ranking can be argued with.
 */

import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { api, ApiError } from '../api/client.js';
import { useAsync } from '../app/hooks.js';
import { ScreenIntro } from '../app/AppShell.js';
import { duration, ease, stagger, staggerItem } from '../design/motion.js';
import {
  BAND,
  Button,
  Chip,
  EmptyState,
  ErrorNote,
  Eyebrow,
  Panel,
  PanelHeader,
  Skeleton,
  Tabs,
  cx,
  bandOf,
} from '../design/primitives.js';
import type { InterventionItem } from '../types.js';

const URGENCY_ORDER = { high: 0, medium: 1, routine: 2 } as const;

export function InterventionsScreen() {
  const items = useAsync(() => api.getInterventions(), []);
  const [tab, setTab] = useState<'queue' | 'actioned'>('queue');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const all = items.data?.interventions ?? [];
  const queue = all.filter((i) => i.status === 'recommended');
  const actioned = all.filter((i) => i.status !== 'recommended');
  const shown = useMemo(() => {
    const list = tab === 'queue' ? queue : actioned;
    return [...list].sort(
      (a, b) =>
        URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency] ||
        b.projectedRiskReduction - a.projectedRiskReduction,
    );
  }, [tab, all]);

  const totalEffect = queue.reduce((s, i) => s + i.projectedRiskReduction, 0);

  const act = async (id: string, action: 'approve' | 'dismiss' | 'complete') => {
    const note =
      action === 'dismiss'
        ? window.prompt('Why is this not appropriate? Recorded against the model.')
        : window.prompt('Note for the record (optional)') ?? '';
    if (action === 'dismiss' && !note) return;
    setBusy(id);
    setErr(null);
    try {
      await api.updateInterventionAction(id, action, note || undefined);
      items.refetch();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (items.loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-72" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }
  if (items.error) return <ErrorNote onRetry={items.refetch}>{items.error.message}</ErrorNote>;

  return (
    <motion.div variants={stagger(0.03, 0.05)} initial="hidden" animate="show">
      <ScreenIntro
        title="Intervention queue"
        lede={
          queue.length
            ? `${queue.length} measures outstanding. Actioning all of them is modelled to remove ${totalEffect.toFixed(0)} index points across the force.`
            : 'Nothing outstanding.'
        }
      />

      <motion.div variants={staggerItem} className="mb-5">
        <Tabs
          items={[
            { id: 'queue' as const, label: 'Outstanding', count: queue.length },
            { id: 'actioned' as const, label: 'Actioned', count: actioned.length },
          ]}
          value={tab}
          onChange={setTab}
        />
      </motion.div>

      {err ? <ErrorNote>{err}</ErrorNote> : null}

      {shown.length === 0 ? (
        <Panel>
          <EmptyState
            title={tab === 'queue' ? 'Queue is clear' : 'Nothing actioned yet'}
            description={
              tab === 'queue'
                ? 'No open case currently has a measure the model projects will help.'
                : 'Approved and dismissed measures will collect here with who decided and why.'
            }
          />
        </Panel>
      ) : (
        <motion.ul variants={staggerItem} className="space-y-3">
          {shown.map((item, i) => (
            <Row
              key={item.id}
              item={item}
              rank={i + 1}
              busy={busy === item.id}
              expanded={expanded === item.id}
              onToggle={() => setExpanded((e) => (e === item.id ? null : item.id))}
              onAct={act}
            />
          ))}
        </motion.ul>
      )}
    </motion.div>
  );
}

function Row({
  item,
  rank,
  busy,
  expanded,
  onToggle,
  onAct,
}: {
  item: InterventionItem;
  rank: number;
  busy: boolean;
  expanded: boolean;
  onToggle: () => void;
  onAct: (id: string, action: 'approve' | 'dismiss' | 'complete') => void;
}) {
  const beforeBand = bandOf(item.preInterventionRisk);
  const afterBand = bandOf(item.postInterventionRisk ?? item.preInterventionRisk);
  const crosses = beforeBand !== afterBand;

  return (
    <motion.li variants={staggerItem}>
      <Panel className="overflow-hidden">
        <div className="flex flex-wrap items-start gap-4 px-5 py-4">
          <span className="mt-1 w-6 shrink-0 font-mono text-[12px] text-ink-faint tnum">
            {String(rank).padStart(2, '0')}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-[16px]">{item.title}</h4>
              {item.urgency === 'high' ? <Chip tone="warn">priority</Chip> : null}
              {crosses ? <Chip tone="accent">changes band</Chip> : null}
              {item.status !== 'recommended' ? <Chip>{item.status}</Chip> : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10.5px] text-ink-faint">
              <span>{item.targetPersonnelToken}</span>
              <span>· {item.targetUnitName}</span>
              <span>· {item.category}</span>
            </div>

            <AnimatePresence initial={false}>
              {expanded ? (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: duration.base, ease }}
                  className="overflow-hidden"
                >
                  <div className="mt-3 space-y-2.5 border-t border-rule-hairline pt-3">
                    <div>
                      <Eyebrow>Evidence</Eyebrow>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">{item.ragEvidenceQuote}</p>
                      <p className="mt-1 font-mono text-[10.5px] text-ink-faint">{item.policyCitation}</p>
                    </div>
                    <div>
                      <Eyebrow>Modelled effect</Eyebrow>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
                        Index {item.preInterventionRisk.toFixed(1)} → {(item.postInterventionRisk ?? 0).toFixed(1)} (
                        {BAND[beforeBand].label} → {BAND[afterBand].label}). Computed by
                        re-running this individual's feature vector with the measure
                        applied, not by looking the number up in a table.
                      </p>
                    </div>
                    {item.officerNotes ? (
                      <div>
                        <Eyebrow>Officer note</Eyebrow>
                        <p className="mt-1 text-[12.5px] text-ink-muted">{item.officerNotes}</p>
                      </div>
                    ) : null}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <button
              onClick={onToggle}
              className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.09em] text-ink-faint transition-colors hover:text-ink"
            >
              {expanded ? 'Less' : 'Evidence & mechanism'}
            </button>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="text-right">
              <div className="font-serif text-[30px] leading-none text-routine tnum">
                −{item.projectedRiskReduction.toFixed(1)}
              </div>
              <div className="eyebrow mt-1">index points</div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[11px] text-ink-faint tnum">
                {item.preInterventionRisk.toFixed(0)}
              </span>
              <span className="text-ink-faint">→</span>
              <span
                className="font-mono text-[13px] tnum"
                style={{ color: BAND[afterBand].css }}
              >
                {(item.postInterventionRisk ?? 0).toFixed(0)}
              </span>
            </div>
          </div>
        </div>

        {item.status === 'recommended' ? (
          <div className="flex flex-wrap gap-2 border-t border-rule-hairline bg-paper-inset px-5 py-3">
            <Button size="sm" variant="primary" loading={busy} onClick={() => onAct(item.id, 'approve')}>
              Authorise
            </Button>
            <Button size="sm" loading={busy} onClick={() => onAct(item.id, 'complete')}>
              Mark complete
            </Button>
            <Button size="sm" variant="ghost" loading={busy} onClick={() => onAct(item.id, 'dismiss')}>
              Not appropriate
            </Button>
          </div>
        ) : item.approvedBy ? (
          <div className="border-t border-rule-hairline bg-paper-inset px-5 py-2.5 font-mono text-[10.5px] text-ink-faint">
            {item.status} by {item.approvedBy}
            {item.approvedAt ? ` · ${new Date(item.approvedAt).toLocaleString()}` : ''}
          </div>
        ) : null}
      </Panel>
    </motion.li>
  );
}
