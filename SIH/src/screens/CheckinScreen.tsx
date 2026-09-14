/**
 * Daily check-in.
 *
 * This is the screen that decides whether the whole system works, and almost
 * every design choice here is about honesty of disclosure rather than data
 * collection:
 *
 *   - Five questions. Not a PHQ-9, not a twenty-item battery. A jawan finishing
 *     a fourteen-hour shift will complete five questions honestly and abandon
 *     twenty, and an abandoned instrument produces worse data than a short one.
 *   - The privacy statement sits above the form, not buried in a consent modal,
 *     because the single biggest barrier to honest self-report in uniformed
 *     populations is the fear that the answer reaches the chain of command.
 *   - "I would like to speak to someone" is a first-class control, not a
 *     consequence of scoring badly. Asking for help should never require
 *     performing distress for an algorithm first.
 */

import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { api, ApiError } from '../api/client.js';
import type { AssessmentDetail } from '../api/client.js';
import { duration, ease, rise, stagger, staggerItem } from '../design/motion.js';
import {
  BAND,
  BandBadge,
  Button,
  Chip,
  ErrorNote,
  Eyebrow,
  Field,
  Panel,
  PanelHeader,
  Scale,
  Slider,
  Toggle,
  cx,
  inputClass,
} from '../design/primitives.js';
import { CoverageNote, DriverList, RiskDial } from '../components/explain/Explainability.js';
import { ScreenIntro } from '../app/AppShell.js';
import type { UserProfile } from '../types.js';

const STRESS_LABELS = ['None', 'Slight', 'Moderate', 'High', 'Severe'];
const FATIGUE_LABELS = ['Fresh', 'Mild', 'Moderate', 'Heavy', 'Exhausted'];

export function CheckinScreen({
  user,
  onSubmitted,
}: {
  user: UserProfile;
  onSubmitted?: () => void;
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [sleep, setSleep] = useState(6.5);
  const [duty, setDuty] = useState(9);
  const [stress, setStress] = useState(3);
  const [fatigue, setFatigue] = useState(3);
  const [night, setNight] = useState(false);
  const [support, setSupport] = useState(false);
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<{ detail: AssessmentDetail; message: string } | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.submitCheckin({
        date: today,
        sleepHours: sleep,
        perceivedStress: stress,
        perceivedFatigue: fatigue,
        dutyHours: duty,
        nightShift: night,
        supportRequested: support,
        notes: notes.trim() || undefined,
      });
      const trends = await api.getTrends();
      if (trends.detail) setResult({ detail: trends.detail, message: res.message });
      onSubmitted?.();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(String(err), 0));
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return <CheckinResult detail={result.detail} message={result.message} onAgain={() => setResult(null)} />;
  }

  return (
    <div>
      <ScreenIntro
        title={<>Good to see you, {user.name.split(' ')[0]}.</>}
        lede="Five questions about the last twenty-four hours. It takes about thirty seconds, and nothing you write here reaches your commanding officer."
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <motion.div variants={stagger(0.05, 0.06)} initial="hidden" animate="show" className="min-w-0 space-y-5">
          <motion.div variants={staggerItem}>
            <Panel>
              <PanelHeader eyebrow="01 · Rest" title="How much did you sleep?" />
              <div className="space-y-5 px-5 py-5">
                <Slider
                  value={sleep}
                  onChange={setSleep}
                  min={0}
                  max={12}
                  step={0.5}
                  format={(v) => `${v.toFixed(1)} hours`}
                />
                <Toggle
                  checked={night}
                  onChange={setNight}
                  label="I was on night duty"
                  description="Night shifts are scored differently — the model tracks consecutive runs, not totals."
                />
              </div>
            </Panel>
          </motion.div>

          <motion.div variants={staggerItem}>
            <Panel>
              <PanelHeader eyebrow="02 · Duty" title="Roughly how long were you on duty?" />
              <div className="px-5 py-5">
                <Slider
                  value={duty}
                  onChange={setDuty}
                  min={0}
                  max={18}
                  step={0.5}
                  format={(v) => `${v.toFixed(1)} hours`}
                />
              </div>
            </Panel>
          </motion.div>

          <motion.div variants={staggerItem}>
            <Panel>
              <PanelHeader
                eyebrow="03 · How you feel"
                title="Stress and fatigue, in your own judgement"
                description="There is no right answer and nobody reviews these individually against you."
              />
              <div className="space-y-5 px-5 py-5">
                <Field label="Stress today">
                  <Scale value={stress} onChange={setStress} labels={STRESS_LABELS} name="Stress" />
                </Field>
                <Field label="Physical fatigue today">
                  <Scale value={fatigue} onChange={setFatigue} labels={FATIGUE_LABELS} name="Fatigue" />
                </Field>
              </div>
            </Panel>
          </motion.div>

          <motion.div variants={staggerItem}>
            <Panel className={cx(support && 'ring-1 ring-accent/40')}>
              <PanelHeader eyebrow="04 · Support" title="Would you like to speak to someone?" />
              <div className="space-y-4 px-5 py-5">
                <Toggle
                  checked={support}
                  onChange={setSupport}
                  label="Yes — ask a welfare officer to contact me"
                  description="This opens a case immediately, whatever your score. You do not have to justify it."
                />
                <Field
                  label="Anything you want to add (optional)"
                  hint="Free text is never sent to the model and is visible only to your assigned welfare officer."
                >
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    maxLength={2000}
                    placeholder="Leave blank if you would rather not."
                    className={cx(inputClass, 'resize-none')}
                  />
                </Field>
              </div>
            </Panel>
          </motion.div>

          {error ? (
            <ErrorNote onRetry={() => setError(null)}>
              {error.issues.length ? error.issues.join('; ') : error.message}
            </ErrorNote>
          ) : null}

          <motion.div variants={staggerItem} className="flex flex-wrap items-center gap-3">
            <Button variant="primary" size="lg" onClick={submit} loading={submitting}>
              {submitting ? 'Recording' : 'Submit check-in'}
            </Button>
            <span className="font-mono text-[10.5px] text-ink-faint">
              {today} · submitted as {user.id}
            </span>
          </motion.div>
        </motion.div>

        <motion.aside variants={rise} initial="hidden" animate="show" className="space-y-4">
          <Panel inset className="p-4">
            <Eyebrow>Who sees this</Eyebrow>
            <ul className="mt-3 space-y-3 text-[12.5px] leading-relaxed text-ink-muted">
              <SeeRow who="You" what="Everything, always." tone="ok" />
              <SeeRow
                who="Your welfare officer"
                what="Your score, its drivers, and your notes — only if a case opens."
                tone="ok"
              />
              <SeeRow
                who="Your commanding officer"
                what="Nothing about you individually. Unit aggregates only, and only above a cohort of ten."
                tone="block"
              />
              <SeeRow
                who="Promotion and disciplinary boards"
                what="Nothing. Ever. Barred by SOP-WEL-04."
                tone="block"
              />
            </ul>
          </Panel>

          <Panel inset className="p-4">
            <Eyebrow>Why five questions</Eyebrow>
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-muted">
              Self-report alone is a weak predictor — in our evaluation it carries
              roughly a third of the signal. The rest comes from duty rosters and
              issued wearables, which is precisely why we do not need to ask you
              twenty questions every morning.
            </p>
          </Panel>
        </motion.aside>
      </div>
    </div>
  );
}

function SeeRow({ who, what, tone }: { who: string; what: string; tone: 'ok' | 'block' }) {
  return (
    <li className="flex gap-2.5">
      <span
        className={cx(
          'mt-[7px] size-1.5 shrink-0 rounded-full',
          tone === 'ok' ? 'bg-routine' : 'bg-review',
        )}
      />
      <span>
        <span className="block text-ink">{who}</span>
        <span className="block text-[11.5px] text-ink-faint">{what}</span>
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------

function CheckinResult({
  detail,
  message,
  onAgain,
}: {
  detail: AssessmentDetail;
  message: string;
  onAgain: () => void;
}) {
  const band = detail.band;
  return (
    <motion.div initial="hidden" animate="show" variants={stagger(0.06, 0.08)}>
      <motion.div variants={staggerItem}>
        <ScreenIntro
          title="Recorded."
          lede={message}
          actions={
            <Button variant="secondary" onClick={onAgain}>
              Amend today's entry
            </Button>
          }
        />
      </motion.div>

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <motion.div variants={staggerItem}>
          <Panel className="flex flex-col items-center px-5 py-7">
            <RiskDial
              value={detail.wri}
              band={band}
              interval={detail.interval}
              forecast={detail.forecast7d}
            />
            <div className="mt-5 flex flex-col items-center gap-2">
              <BandBadge band={band} />
              <p className="max-w-[240px] text-center text-[12.5px] leading-relaxed text-ink-muted">
                {BAND[band].description}
              </p>
            </div>

            <div className="mt-5 w-full rounded-sm border border-rule bg-paper-inset px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-ink-muted">Projected in 7 days</span>
                <span className="font-mono text-[13px] text-ink-strong tnum">
                  {detail.forecast7d.toFixed(0)}
                </span>
              </div>
              <div className="mt-1 font-mono text-[10px] text-ink-faint">
                {detail.trajectory === 'rising'
                  ? 'Trending upward — worth acting on now'
                  : detail.trajectory === 'improving'
                    ? 'Trending down — current measures appear to be working'
                    : 'Broadly stable'}
              </div>
            </div>
          </Panel>
        </motion.div>

        <motion.div variants={staggerItem} className="min-w-0 space-y-5">
          <Panel>
            <PanelHeader
              eyebrow="Explanation"
              title="What moved your index today"
              description="These are exact contributions from the model that produced your score — not a general description of what tends to matter."
            />
            <div className="px-5 py-5">
              <DriverList attributions={[...detail.drivers, ...detail.protectiveFactors]} limit={6} title="Factors" />
            </div>
          </Panel>

          <CoverageNote coverage={detail.coverage} imputed={detail.imputed} />

          <div className="flex flex-wrap items-center gap-2">
            <Chip>model {detail.modelVersion}</Chip>
            <Chip>scored in {detail.computedInMs.toFixed(1)} ms</Chip>
            <Chip>baseline {detail.baseValue.toFixed(1)}</Chip>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
