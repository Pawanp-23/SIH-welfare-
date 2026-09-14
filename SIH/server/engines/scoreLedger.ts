/**
 * Period aggregation for the individual's score ledger.
 *
 * The trend chart is built from raw daily assessments; this rolls the same rows
 * up into calendar weeks and months so the "how was my week" summary the
 * personnel screen shows is computed once, on the server, from the source of
 * truth — rather than re-derived in every client that happens to render it.
 *
 * Only the individual's own rows ever pass through here, so nothing in this
 * module needs the cohort-suppression rules that guard the command views.
 *
 * Weeks are Monday-anchored to match duty rosters. All date arithmetic is done
 * on `yyyy-mm-dd` strings in local time so a check-in filed at 23:50 does not
 * migrate to the next day when the server runs in another timezone.
 */

import type { ReviewBand as Band } from '../../src/types.js';

export interface LedgerRow {
  date: string;
  index: number;
  band: Band;
  sleepHours: number | null;
  dutyHours: number | null;
  perceivedStress: number | null;
}

export interface PeriodSummary {
  /** Inclusive period start, yyyy-mm-dd. */
  start: string;
  /** Exclusive period end, yyyy-mm-dd. */
  end: string;
  daysRecorded: number;
  meanIndex: number;
  minIndex: number;
  maxIndex: number;
  /** Change in mean index against the immediately preceding period, if that period has data. */
  deltaVsPrior: number | null;
  bandDays: Record<Band, number>;
  meanSleepHours: number | null;
  meanDutyHours: number | null;
  meanPerceivedStress: number | null;
  /** Worst day — the one a welfare officer would ask about first. */
  peak: { date: string; index: number } | null;
}

export interface LedgerSummary {
  weeks: PeriodSummary[];
  months: PeriodSummary[];
  /** Consecutive days, ending on the latest record, with a check-in filed. */
  currentStreak: number;
}

const parse = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const mondayOf = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));
const firstOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (x: number) => Math.round(x * 10) / 10;
const present = (xs: Array<number | null | undefined>) => xs.filter((x): x is number => typeof x === 'number');

function summarise(rows: LedgerRow[], start: Date, end: Date, prior: LedgerRow[]): PeriodSummary | null {
  if (!rows.length) return null;
  const idx = rows.map((r) => r.index);
  const bandDays: Record<Band, number> = { routine: 0, watch: 0, review: 0 };
  for (const r of rows) bandDays[r.band]++;
  const meanIndex = mean(idx)!;
  const priorMean = mean(prior.map((r) => r.index));
  const peak = rows.reduce((a, b) => (b.index > a.index ? b : a));
  const sleep = mean(present(rows.map((r) => r.sleepHours)));
  const duty = mean(present(rows.map((r) => r.dutyHours)));
  const stress = mean(present(rows.map((r) => r.perceivedStress)));

  return {
    start: iso(start),
    end: iso(end),
    daysRecorded: rows.length,
    meanIndex: round1(meanIndex),
    minIndex: round1(Math.min(...idx)),
    maxIndex: round1(Math.max(...idx)),
    deltaVsPrior: priorMean == null ? null : round1(meanIndex - priorMean),
    bandDays,
    meanSleepHours: sleep == null ? null : round1(sleep),
    meanDutyHours: duty == null ? null : round1(duty),
    meanPerceivedStress: stress == null ? null : round1(stress),
    peak: { date: peak.date, index: round1(peak.index) },
  };
}

export function buildLedgerSummary(rows: LedgerRow[]): LedgerSummary {
  if (!rows.length) return { weeks: [], months: [], currentStreak: 0 };

  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const inRange = (a: Date, b: Date) => sorted.filter((r) => r.date >= iso(a) && r.date < iso(b));
  const first = parse(sorted[0].date);
  const last = parse(sorted[sorted.length - 1].date);

  const weeks: PeriodSummary[] = [];
  for (let w = mondayOf(first); w <= last; w = addDays(w, 7)) {
    const s = summarise(inRange(w, addDays(w, 7)), w, addDays(w, 7), inRange(addDays(w, -7), w));
    if (s) weeks.push(s);
  }

  const months: PeriodSummary[] = [];
  for (let m = firstOfMonth(first); m <= last; m = addMonths(m, 1)) {
    const s = summarise(inRange(m, addMonths(m, 1)), m, addMonths(m, 1), inRange(addMonths(m, -1), m));
    if (s) months.push(s);
  }

  // Streak: walk back from the latest record while each previous calendar day
  // has a row.
  const dates = new Set(sorted.map((r) => r.date));
  let streak = 0;
  for (let d = last; dates.has(iso(d)); d = addDays(d, -1)) streak++;

  return { weeks, months, currentStreak: streak };
}
