/**
 * Audit and privacy.
 *
 * The log is hash-chained, and this screen lets anyone verify the chain on
 * demand rather than take our word for it. That verification is the thing worth
 * demonstrating: a welfare system inevitably accumulates the ability to look up
 * individuals, and the only real check on that power is an access record the
 * powerful cannot quietly edit.
 */

import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { api, ApiError } from '../api/client.js';
import { useAsync } from '../app/hooks.js';
import { ScreenIntro } from '../app/AppShell.js';
import { duration, ease, stagger, staggerItem } from '../design/motion.js';
import {
  Button,
  Chip,
  ErrorNote,
  Eyebrow,
  Info,
  Panel,
  PanelHeader,
  Skeleton,
  Stat,
  cx,
  inputClass,
} from '../design/primitives.js';

const PRIVACY_CONTROLS = [
  {
    title: 'k-anonymity, enforced in the query layer',
    body: 'Any cohort smaller than ten returns a suppression notice instead of numbers. The check runs before the data leaves the database, so no interface change can expose it.',
  },
  {
    title: 'Keyed pseudonyms, not hashes',
    body: 'Command-facing identifiers are HMAC-SHA256 of the personnel id under a server-held key. A leaked roster does not let anyone rebuild the mapping by brute force.',
  },
  {
    title: 'Free text never reaches the model',
    body: 'Notes written during a check-in are stored for the assigned welfare officer only and are not a model input. Nothing a person writes is scored.',
  },
  {
    title: 'Command cannot read individual records',
    body: 'Enforced by middleware, not by hiding a button: a command role requesting an individual record receives 403 and the refusal is itself logged.',
  },
  {
    title: 'Append-only consent ledger',
    body: 'Withdrawal halts processing immediately. The historical grant is retained so the lawful basis for past processing stays auditable under the DPDP Act.',
  },
  {
    title: 'Non-punitive by regulation',
    body: 'SOP-WEL-04 bars disciplinary and promotion boards from reviewing welfare content. The system holds no pathway that would let them.',
  },
];

export function AuditScreen() {
  const [filter, setFilter] = useState('');
  const logs = useAsync(() => api.getAuditLogs(undefined, 150), []);
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState<{
    valid: boolean;
    entries: number;
    brokenAtSeq: number | null;
    reason: string | null;
    headHash: string;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const rows = useMemo(() => {
    const all = logs.data?.logs ?? [];
    if (!filter.trim()) return all;
    const q = filter.toLowerCase();
    return all.filter(
      (l) =>
        l.action.toLowerCase().includes(q) ||
        l.actorId.toLowerCase().includes(q) ||
        l.resource.toLowerCase().includes(q) ||
        (l.actorRole ?? '').toLowerCase().includes(q),
    );
  }, [logs.data, filter]);

  const verify = async () => {
    setVerifying(true);
    setErr(null);
    try {
      const res = await api.verifyAuditChain();
      setVerification(res.verification);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setVerifying(false);
    }
  };

  return (
    <motion.div variants={stagger(0.03, 0.05)} initial="hidden" animate="show">
      <ScreenIntro
        title="Audit & privacy"
        lede="Every access, every refusal, every model run. Each entry commits to the hash of the one before it, so a deleted or edited record breaks verification for everything after it."
        actions={
          <Button variant="primary" onClick={verify} loading={verifying}>
            Verify the chain
          </Button>
        }
      />

      {err ? <ErrorNote onRetry={verify}>{err}</ErrorNote> : null}

      <AnimatePresence>
        {verification ? (
          <motion.div
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: duration.base, ease }}
            className="mb-5 overflow-hidden"
          >
            <div
              className={cx(
                'rounded-lg border px-5 py-4',
                verification.valid ? 'border-routine/30 bg-routine-bg' : 'border-review/30 bg-review-bg',
              )}
            >
              <div className="flex items-start gap-3">
                <span
                  className={cx(
                    'mt-1.5 size-2 shrink-0 rounded-full',
                    verification.valid ? 'bg-routine' : 'bg-review',
                  )}
                />
                <div className="min-w-0">
                  <p className={cx('text-[14px]', verification.valid ? 'text-routine' : 'text-review')}>
                    {verification.valid
                      ? `Chain intact across all ${verification.entries} entries.`
                      : `Chain broken at entry ${verification.brokenAtSeq}.`}
                  </p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-muted">
                    {verification.valid
                      ? 'Every record was recomputed from its contents and its predecessor. Nothing has been inserted, removed, reordered or edited since it was written.'
                      : verification.reason}
                  </p>
                  <p className="mt-1.5 break-all font-mono text-[10px] text-ink-faint">
                    head {verification.headHash}
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <motion.div variants={staggerItem} className="mb-5 grid gap-4 sm:grid-cols-3">
        <Panel>
          <Stat
            label="Entries recorded"
            value={logs.data?.totalCount ?? '—'}
            hint="Since this database was seeded."
          />
        </Panel>
        <Panel>
          <Stat
            label="Privacy filters applied"
            value={logs.data?.kAnonymityEnforcedCount ?? '—'}
            hint="Accesses where suppression or pseudonymisation was enforced."
          />
        </Panel>
        <Panel>
          <Stat
            label="Chain state"
            value={logs.data?.chainValid === false ? 'Broken' : 'Intact'}
            tone={logs.data?.chainValid === false ? 'review' : 'routine'}
            hint="Recomputed on every read of this page."
          />
        </Panel>
      </motion.div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <motion.div variants={staggerItem} className="min-w-0">
          <Panel>
            <PanelHeader
              eyebrow="Access trail"
              title="Who looked at what"
              actions={
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter by action, actor or resource"
                  className={cx(inputClass, 'w-[230px] py-1.5 text-[12.5px]')}
                />
              }
            />
            <div className="max-h-[560px] overflow-y-auto">
              {logs.loading ? (
                <div className="space-y-2 p-4">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-12" />
                  ))}
                </div>
              ) : rows.length === 0 ? (
                <p className="px-5 py-10 text-center text-[12.5px] text-ink-muted">
                  No entries match that filter.
                </p>
              ) : (
                <ul className="divide-y divide-rule-hairline">
                  {rows.map((l) => (
                    <li key={l.id} className="px-5 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span
                          className={cx(
                            'font-mono text-[11px] uppercase tracking-[0.07em]',
                            l.action.includes('DENIED') || l.action.includes('FAILED')
                              ? 'text-review'
                              : 'text-ink',
                          )}
                        >
                          {l.action.replace(/_/g, ' ')}
                        </span>
                        <span className="font-mono text-[10px] text-ink-faint">
                          {new Date(l.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-muted">
                        <span>
                          {l.actorName ?? l.actorId}{' '}
                          <span className="text-ink-faint">({l.actorRole})</span>
                        </span>
                        <span className="truncate font-mono text-[11px] text-ink-faint">→ {l.resource}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Chip>{l.privacyFilterEnforced.replace(/_/g, ' ')}</Chip>
                        <span className="truncate text-[11px] text-ink-faint">{l.justification}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>
        </motion.div>

        <motion.div variants={staggerItem} className="min-w-0">
          <Panel>
            <PanelHeader
              eyebrow="By design"
              title="The privacy controls"
              actions={
                <Info label="Why so specific?">
                  Welfare monitoring in a hierarchical organisation only works if
                  the people being monitored believe the limits are real. Stating
                  each control, and where it is enforced, is part of the product.
                </Info>
              }
            />
            <ul className="divide-y divide-rule-hairline">
              {PRIVACY_CONTROLS.map((c) => (
                <li key={c.title} className="px-5 py-3.5">
                  <div className="flex gap-2.5">
                    <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />
                    <div>
                      <div className="text-[13px] text-ink-strong">{c.title}</div>
                      <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">{c.body}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </motion.div>
      </div>
    </motion.div>
  );
}
