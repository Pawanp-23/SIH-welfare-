/**
 * Score ledger — the day-by-day record beneath the trend line.
 *
 * The chart above answers "which way am I heading". This answers the question
 * people actually ask when they open the page on a Sunday evening: "what was
 * Tuesday, and why was it worse than Monday". It lays each day out as a row of
 * cells with the index, the band it landed in, and the two or three inputs that
 * most often explain a move — sleep, duty hours, self-reported stress.
 *
 * Two views. The week is the working rhythm of a unit, so it is the default
 * and it is exhaustive: every day, every input. The month is for stepping back;
 * it is a calendar, coloured by band, with the number written in — so it reads
 * in greyscale and the colour is only a second channel.
 *
 * Weeks start on Monday, because duty rosters do.
 */

import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { BAND, Band, Tabs, bandOf, cx } from '../../design/primitives.js';
import { duration, ease } from '../../design/motion.js';
import type { PeriodSummary } from '../../api/client.js';

export interface LedgerDay {
  date: string; // ISO yyyy-mm-dd
  index: number;
  band: string;
  forecast?: number | null;
  sleepHours?: number | null;
  dutyHours?: number | null;
  perceivedStress?: number | null;
  perceivedFatigue?: number | null;
}

type View = 'week' | 'month';

// ---------------------------------------------------------------------------
// Date helpers — local-date arithmetic on yyyy-mm-dd strings, no timezone drift
// ---------------------------------------------------------------------------

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const parse = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
};
/** Monday of the week containing `d`. */
const mondayOf = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));
const firstOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

const fmtRange = (a: Date, b: Date) =>
  a.getMonth() === b.getMonth()
    ? `${a.getDate()}–${b.getDate()} ${MONTH[a.getMonth()]} ${a.getFullYear()}`
    : `${a.getDate()} ${MONTH[a.getMonth()]} – ${b.getDate()} ${MONTH[b.getMonth()]} ${b.getFullYear()}`;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

// ---------------------------------------------------------------------------
// Summary strip shared by both views
// ---------------------------------------------------------------------------

function Summary({
  days,
  priorDays,
  server,
}: {
  days: LedgerDay[];
  priorDays: LedgerDay[];
  /** Server roll-up for the same period; when present it is the figure of record. */
  server?: PeriodSummary | null;
}) {
  const localAvg = mean(days.map((d) => d.index));
  const localPrior = mean(priorDays.map((d) => d.index));
  const avg = server?.meanIndex ?? localAvg;
  const delta = server ? server.deltaVsPrior : avg != null && localPrior != null ? avg - localPrior : null;
  const counts: Record<Band, number> = server
    ? server.bandDays
    : (() => {
        const c = { routine: 0, watch: 0, review: 0 } as Record<Band, number>;
        for (const d of days) c[(d.band as Band) ?? bandOf(d.index)]++;
        return c;
      })();
  const sleep = server ? server.meanSleepHours : mean(days.map((d) => d.sleepHours).filter((x): x is number => x != null));
  const duty = server ? server.meanDutyHours : mean(days.map((d) => d.dutyHours).filter((x): x is number => x != null));
  const peak = server?.peak ?? null;

  const cell = 'flex min-w-0 flex-col gap-1 px-4 py-3';
  return (
    <div className="grid grid-cols-2 divide-x divide-rule-hairline border-b border-rule-hairline md:grid-cols-[1.15fr_1.45fr_1fr_1fr]">
      <div className={cell}>
        <span className="eyebrow">Average index</span>
        <span className="flex items-baseline gap-2">
          <span className="font-serif text-[26px] leading-none tnum" style={avg != null ? { color: BAND[bandOf(avg)].css } : undefined}>
            {avg != null ? avg.toFixed(0) : '—'}
          </span>
          {delta != null ? (
            <span className={cx('font-mono text-[11px]', delta < -0.5 ? 'text-routine' : delta > 0.5 ? 'text-review' : 'text-ink-faint')}>
              {delta > 0 ? '+' : ''}
              {delta.toFixed(1)} <span className="text-ink-faint">vs prior</span>
            </span>
          ) : null}
        </span>
        {peak ? (
          <span className="font-mono text-[10.5px] tnum text-ink-faint">
            peak {peak.index.toFixed(0)} on {peak.date.slice(5).replace('-', '/')}
          </span>
        ) : null}
      </div>
      <div className={cell}>
        <span className="eyebrow">Days by band</span>
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-1">
          {(['routine', 'watch', 'review'] as Band[]).map((b) => (
            <span key={b} className="flex items-center gap-1 whitespace-nowrap font-mono text-[11px] text-ink">
              <span className={cx('size-1.5 rounded-full', BAND[b].dot)} />
              {counts[b]}
              <span className="text-ink-faint">{BAND[b].label.toLowerCase()}</span>
            </span>
          ))}
        </span>
      </div>
      <div className={cell}>
        <span className="eyebrow">Mean sleep</span>
        <span className="font-serif text-[26px] leading-none tnum">
          {sleep != null ? sleep.toFixed(1) : '—'}
          <span className="ml-1 font-sans text-[11px] text-ink-faint">h / night</span>
        </span>
      </div>
      <div className={cell}>
        <span className="eyebrow">Mean duty</span>
        <span className="font-serif text-[26px] leading-none tnum">
          {duty != null ? duty.toFixed(1) : '—'}
          <span className="ml-1 font-sans text-[11px] text-ink-faint">h / day</span>
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Week view — seven columns, every input
// ---------------------------------------------------------------------------

function WeekView({ start, byDate }: { start: Date; byDate: Map<string, LedgerDay> }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = iso(new Date());

  // Previous day's index for the per-cell delta, looking back across the week
  // boundary so Monday still has one.
  const prevIndex = (d: Date) => byDate.get(iso(addDays(d, -1)))?.index ?? null;

  return (
    <div className="grid grid-cols-7 divide-x divide-rule-hairline">
      {days.map((d) => {
        const key = iso(d);
        const rec = byDate.get(key);
        const band = rec ? ((rec.band as Band) ?? bandOf(rec.index)) : null;
        const prev = rec ? prevIndex(d) : null;
        const delta = rec && prev != null ? rec.index - prev : null;
        const isToday = key === today;
        const future = key > today;

        return (
          <div
            key={key}
            className={cx('flex min-w-0 flex-col gap-3 px-2.5 py-3.5 sm:px-3.5', future && 'opacity-40')}
          >
            <div className="flex items-baseline justify-between">
              <span className={cx('font-mono text-[10.5px] uppercase tracking-[0.08em]', isToday ? 'text-ink-strong' : 'text-ink-faint')}>
                {DAY[(d.getDay() + 6) % 7]}
              </span>
              <span className={cx('font-mono text-[10.5px] tnum', isToday ? 'text-ink-strong' : 'text-ink-faint')}>
                {String(d.getDate()).padStart(2, '0')}
              </span>
            </div>

            {rec && band ? (
              <>
                <div>
                  <div className="flex items-baseline gap-1">
                    <span className="font-serif text-[28px] leading-none tnum" style={{ color: BAND[band].css }}>
                      {rec.index.toFixed(0)}
                    </span>
                    {delta != null ? (
                      <span className={cx('font-mono text-[10.5px]', delta < -0.5 ? 'text-routine' : delta > 0.5 ? 'text-review' : 'text-ink-faint')}>
                        {delta > 0 ? '+' : delta < 0 ? '−' : '±'}
                        {Math.abs(delta).toFixed(0)}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1.5 h-[3px] w-full rounded-full bg-paper-sunken">
                    <div className="h-full rounded-full" style={{ width: `${rec.index}%`, background: BAND[band].css }} />
                  </div>
                </div>

                <dl className="hidden space-y-1 font-mono text-[10.5px] tnum sm:block">
                  <Row label="Sleep" value={rec.sleepHours != null ? `${rec.sleepHours.toFixed(1)}h` : '—'} />
                  <Row label="Duty" value={rec.dutyHours != null ? `${rec.dutyHours.toFixed(0)}h` : '—'} />
                  <Row label="Stress" value={rec.perceivedStress != null ? `${rec.perceivedStress}/10` : '—'} />
                </dl>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-start gap-2 pt-1">
                <span className="font-serif text-[28px] leading-none text-ink-faint/50">—</span>
                <span className="text-[10.5px] leading-snug text-ink-faint">{future ? 'Ahead' : 'No check-in'}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-1">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Month view — a calendar, band-tinted, number written in
// ---------------------------------------------------------------------------

function MonthView({ start, byDate }: { start: Date; byDate: Map<string, LedgerDay> }) {
  const first = firstOfMonth(start);
  const gridStart = mondayOf(first);
  const nextMonth = addMonths(first, 1);
  // Enough full weeks to cover the month.
  const totalDays = Math.ceil((nextMonth.getTime() - gridStart.getTime()) / 86_400_000);
  const weeks = Math.ceil(totalDays / 7);
  const today = iso(new Date());

  return (
    <div className="px-3 py-3">
      <div className="mb-1.5 grid grid-cols-7">
        {DAY.map((d) => (
          <span key={d} className="px-1 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-faint">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: weeks * 7 }, (_, i) => {
          const d = addDays(gridStart, i);
          const key = iso(d);
          const inMonth = d.getMonth() === first.getMonth();
          const rec = byDate.get(key);
          const band = rec ? ((rec.band as Band) ?? bandOf(rec.index)) : null;
          const isToday = key === today;

          return (
            <div
              key={key}
              title={rec ? `${key} · ${rec.index.toFixed(1)} · ${BAND[band!].label}` : key}
              className={cx(
                'relative flex aspect-[4/3] min-h-[52px] flex-col justify-between rounded-sm border px-1.5 py-1',
                inMonth ? 'border-rule-hairline' : 'border-transparent opacity-30',
                rec && band ? BAND[band].bg : 'bg-paper-inset/40',
                isToday && 'ring-1 ring-inset ring-ink-faint/60',
              )}
            >
              <span className={cx('font-mono text-[10px] tnum', isToday ? 'text-ink-strong' : 'text-ink-faint')}>
                {d.getDate()}
              </span>
              {rec && band ? (
                <span className="flex items-baseline justify-between">
                  <span className="font-serif text-[17px] leading-none tnum" style={{ color: BAND[band].css }}>
                    {rec.index.toFixed(0)}
                  </span>
                  <span className={cx('size-1.5 rounded-full', BAND[band].dot)} />
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
        {(['routine', 'watch', 'review'] as Band[]).map((b) => (
          <li key={b} className="flex items-center gap-1.5 text-[11px] text-ink-muted">
            <span className={cx('size-2.5 rounded-[2px] border border-rule-hairline', BAND[b].bg)} />
            {BAND[b].label}
            <span className="font-mono text-[10px] text-ink-faint">
              {b === 'routine' ? '<40' : b === 'watch' ? '40–64' : '≥65'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------

export function ScoreLedger({
  days,
  summaries,
}: {
  days: LedgerDay[];
  summaries?: { weeks: PeriodSummary[]; months: PeriodSummary[] } | null;
}) {
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const latest = useMemo(
    () => (days.length ? parse(days.reduce((a, b) => (a.date > b.date ? a : b)).date) : new Date()),
    [days],
  );
  const earliest = useMemo(
    () => (days.length ? parse(days.reduce((a, b) => (a.date < b.date ? a : b)).date) : new Date()),
    [days],
  );

  const [view, setView] = useState<View>('week');
  // Open on the latest week — unless it has only just begun, in which case a
  // strip of six empty cells tells the reader nothing. Then show last week.
  const [weekStart, setWeekStart] = useState(() => {
    const monday = mondayOf(latest);
    const filled = days.filter((d) => d.date >= iso(monday)).length;
    return filled >= 3 || days.length <= filled ? monday : addDays(monday, -7);
  });
  const [monthStart, setMonthStart] = useState(() => firstOfMonth(latest));

  const inRange = (a: Date, b: Date) => days.filter((d) => d.date >= iso(a) && d.date < iso(b));

  const period =
    view === 'week'
      ? {
          label: fmtRange(weekStart, addDays(weekStart, 6)),
          current: inRange(weekStart, addDays(weekStart, 7)),
          prior: inRange(addDays(weekStart, -7), weekStart),
          canBack: weekStart > mondayOf(earliest),
          canFwd: addDays(weekStart, 7) <= latest,
          back: () => setWeekStart((s) => addDays(s, -7)),
          fwd: () => setWeekStart((s) => addDays(s, 7)),
        }
      : {
          label: `${MONTH[monthStart.getMonth()]} ${monthStart.getFullYear()}`,
          current: inRange(monthStart, addMonths(monthStart, 1)),
          prior: inRange(addMonths(monthStart, -1), monthStart),
          canBack: monthStart > firstOfMonth(earliest),
          canFwd: addMonths(monthStart, 1) <= latest,
          back: () => setMonthStart((s) => addMonths(s, -1)),
          fwd: () => setMonthStart((s) => addMonths(s, 1)),
        };

  const key = view === 'week' ? `w-${iso(weekStart)}` : `m-${iso(monthStart)}`;
  const periodStart = iso(view === 'week' ? weekStart : monthStart);
  const server = (view === 'week' ? summaries?.weeks : summaries?.months)?.find((p) => p.start === periodStart) ?? null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule-hairline px-5">
        <Tabs<View>
          items={[
            { id: 'week', label: 'Week' },
            { id: 'month', label: 'Month' },
          ]}
          value={view}
          onChange={setView}
          layoutId="ledger-tabs"
        />
        <div className="flex items-center gap-1 py-2">
          <NavButton onClick={period.back} disabled={!period.canBack} label="Earlier">
            <ChevronLeft size={14} />
          </NavButton>
          <span className="min-w-[150px] text-center font-mono text-[11px] tnum text-ink-muted">{period.label}</span>
          <NavButton onClick={period.fwd} disabled={!period.canFwd} label="Later">
            <ChevronRight size={14} />
          </NavButton>
        </div>
      </div>

      <Summary days={period.current} priorDays={period.prior} server={server} />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={key}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: duration.fast, ease }}
        >
          {view === 'week' ? <WeekView start={weekStart} byDate={byDate} /> : <MonthView start={monthStart} byDate={byDate} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function NavButton({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex size-8 cursor-pointer items-center justify-center rounded-sm border border-rule text-ink-muted transition-colors hover:border-rule-strong hover:bg-paper-inset hover:text-ink active:bg-paper-sunken disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-rule disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}
