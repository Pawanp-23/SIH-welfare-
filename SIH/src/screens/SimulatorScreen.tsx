/**
 * What-if simulator.
 *
 * The product's argument is that prediction on its own is not much use to a
 * commander: knowing a jawan is at 68 does not tell you what to change. This
 * screen closes that loop by running an actual counterfactual — the same
 * individual's feature vector, with the levers applied, back through the same
 * ensemble — and showing not just the new number but *which attributions moved*.
 *
 * It is deliberately honest about its own limits. The projection curve is a
 * modelled trajectory, not a promise, and the copy says so.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { api, ApiError } from '../api/client.js';
import { useAsync } from '../app/hooks.js';
import { ScreenIntro } from '../app/AppShell.js';
import { duration, ease, rise, stagger, staggerItem } from '../design/motion.js';
import {
  BAND,
  BandBadge,
  Button,
  Chip,
  ErrorNote,
  Eyebrow,
  Info,
  Panel,
  PanelHeader,
  Skeleton,
  Slider,
  Toggle,
  cx,
} from '../design/primitives.js';
import { TrajectoryChart } from '../components/charts/Charts.js';
import type { UserProfile } from '../types.js';

type Sim = Awaited<ReturnType<typeof api.runWhatIfSimulation>>['simulation'];

export function SimulatorScreen({ user }: { user: UserProfile }) {
  const people = useAsync(() => api.listUsers(), []);
  const personnel = useMemo(
    () => (people.data?.users ?? []).filter((u) => u.role === 'personnel'),
    [people.data],
  );

  const [target, setTarget] = useState<string>('p-014');
  const [duty, setDuty] = useState(-2);
  const [nights, setNights] = useState(-2);
  const [rest, setRest] = useState(2);
  const [leave, setLeave] = useState(false);
  const [peer, setPeer] = useState(false);

  const [sim, setSim] = useState<Sim | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await api.runWhatIfSimulation({
        personnelId: target,
        dutyHoursDelta: duty,
        nightShiftsDelta: nights,
        grantedRestDays: rest,
        leaveAuthorized: leave,
        peerSupportSession: peer,
      });
      setSim(res.simulation);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Run once on mount so the screen is never an empty form.
  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const anyLever = duty !== 0 || nights !== 0 || rest !== 0 || leave || peer;

  return (
    <motion.div variants={stagger(0.03, 0.05)} initial="hidden" animate="show">
      <ScreenIntro
        title="Test a decision before you make it"
        lede="Apply the measures you are actually able to authorise, and see what the model expects them to do. Nothing here writes to any record."
      />

      <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* Controls */}
        <motion.div variants={staggerItem} className="min-w-0 space-y-5">
          <Panel>
            <PanelHeader eyebrow="Subject" title="Who are we planning for?" />
            <div className="px-5 py-4">
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className="w-full rounded-sm border border-rule-strong bg-paper px-3 py-2 text-[13.5px] text-ink focus:border-accent focus:outline-none"
              >
                {personnel.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.alias} — {p.unitName}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-faint">
                The simulation starts from this individual's current feature
                vector — the same one that produced the number on their dossier.
              </p>
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              eyebrow="Levers"
              title="What can you actually change?"
              actions={
                <Info label="Why these five?">
                  Each maps to a real command authority — a roster change, a rest
                  day, a leave sanction, a buddy pairing. Levers a commander
                  cannot pull would make a prettier demo and a useless tool.
                </Info>
              }
            />
            <div className="space-y-5 px-5 py-5">
              <div>
                <Eyebrow>Daily duty hours</Eyebrow>
                <div className="mt-2">
                  <Slider
                    value={duty}
                    onChange={setDuty}
                    min={-6}
                    max={2}
                    step={0.5}
                    format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} h/day`}
                  />
                </div>
              </div>
              <div>
                <Eyebrow>Consecutive night shifts</Eyebrow>
                <div className="mt-2">
                  <Slider
                    value={nights}
                    onChange={setNights}
                    min={-5}
                    max={3}
                    step={1}
                    format={(v) => `${v > 0 ? '+' : ''}${v} nights`}
                  />
                </div>
              </div>
              <div>
                <Eyebrow>Rest days granted</Eyebrow>
                <div className="mt-2">
                  <Slider value={rest} onChange={setRest} min={0} max={10} step={1} format={(v) => `${v} days`} />
                </div>
              </div>
              <Toggle
                checked={leave}
                onChange={setLeave}
                label="Sanction pending leave"
                description="Also shortens the modelled gap since family contact."
              />
              <Toggle
                checked={peer}
                onChange={setPeer}
                label="Structured peer-support pairing"
                description="Raises the unit cohesion score, the strongest protective factor in the model."
              />

              <div className="flex items-center gap-2 pt-1">
                <Button variant="primary" onClick={run} loading={busy} disabled={!anyLever}>
                  Run simulation
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDuty(0);
                    setNights(0);
                    setRest(0);
                    setLeave(false);
                    setPeer(false);
                  }}
                >
                  Reset
                </Button>
              </div>
              {!anyLever ? (
                <p className="text-[11.5px] text-ink-faint">Move at least one lever to run a counterfactual.</p>
              ) : null}
            </div>
          </Panel>
        </motion.div>

        {/* Results */}
        <motion.div variants={staggerItem} className="min-w-0 space-y-5">
          {err ? <ErrorNote onRetry={run}>{err}</ErrorNote> : null}

          {!sim && busy ? <Skeleton className="h-[220px]" /> : null}

          <AnimatePresence mode="wait">
            {sim ? (
              <motion.div key={`${sim.baselineRisk}-${sim.simulatedRisk}`} variants={rise} initial="hidden" animate="show" className="space-y-5">
                <Panel>
                  <PanelHeader
                    eyebrow="Counterfactual"
                    title="Modelled effect"
                    description={sim.clinicalRationale}
                  />
                  <div className="grid gap-0 sm:grid-cols-[1fr_auto_1fr]">
                    <Outcome label="As things stand" value={sim.baselineRisk} band={sim.baselineBand} />
                    <div className="flex items-center justify-center border-y border-rule-hairline px-4 py-4 sm:border-x sm:border-y-0">
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.25, duration: duration.base, ease }}
                        className="text-center"
                      >
                        <div
                          className="font-serif text-[34px] leading-none tnum"
                          style={{ color: sim.riskDelta < 0 ? 'var(--signal-routine)' : 'var(--signal-review)' }}
                        >
                          {sim.riskDelta > 0 ? '+' : ''}
                          {sim.riskDelta.toFixed(1)}
                        </div>
                        <div className="eyebrow mt-1.5">index points</div>
                      </motion.div>
                    </div>
                    <Outcome label="With these measures" value={sim.simulatedRisk} band={sim.simulatedBand} />
                  </div>

                  {sim.baselineBand !== sim.simulatedBand ? (
                    <div className="border-t border-rule-hairline bg-accent-soft px-5 py-3">
                      <p className="text-[13px] text-ink">
                        This moves the individual out of the{' '}
                        <strong className="font-medium">{BAND[sim.baselineBand].label.toLowerCase()}</strong> band and into{' '}
                        <strong className="font-medium">{BAND[sim.simulatedBand].label.toLowerCase()}</strong>.
                      </p>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap gap-1.5 border-t border-rule-hairline px-5 py-3">
                    {sim.appliedLevers.map((l) => (
                      <Chip key={l.key}>
                        {l.label} {l.delta > 0 ? '+' : ''}
                        {l.delta}
                        {l.unit}
                      </Chip>
                    ))}
                  </div>
                </Panel>

                <Panel>
                  <PanelHeader
                    eyebrow="Mechanism"
                    title="Which factors moved, and by how much"
                    description="The difference between the two SHAP attributions. This is what the model thinks the intervention actually did."
                  />
                  <div className="px-5 py-5">
                    <ul className="space-y-2.5">
                      {sim.attributionShift.map((s, i) => {
                        const max = Math.max(...sim.attributionShift.map((x) => Math.abs(x.shift)), 0.1);
                        const good = s.shift < 0;
                        return (
                          <li key={s.feature} className="flex items-center gap-3">
                            <span className="w-[150px] shrink-0 truncate text-[12.5px] text-ink-muted">{s.name}</span>
                            <div className="relative h-[16px] flex-1">
                              <div className="absolute inset-y-0 left-1/2 w-px bg-rule" />
                              <motion.div
                                initial={{ scaleX: 0 }}
                                animate={{ scaleX: 1 }}
                                transition={{ duration: duration.slow, ease, delay: i * 0.05 }}
                                className="absolute inset-y-[2px] rounded-[2px]"
                                style={{
                                  left: good ? `calc(50% - ${(Math.abs(s.shift) / max) * 48}%)` : '50%',
                                  width: `${(Math.abs(s.shift) / max) * 48}%`,
                                  background: good ? 'var(--signal-routine)' : 'var(--signal-review)',
                                  transformOrigin: good ? 'right' : 'left',
                                }}
                              />
                            </div>
                            <span
                              className="w-[52px] shrink-0 text-right font-mono text-[11.5px] tnum"
                              style={{ color: good ? 'var(--signal-routine)' : 'var(--signal-review)' }}
                            >
                              {s.shift > 0 ? '+' : ''}
                              {s.shift.toFixed(1)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </Panel>

                <Panel>
                  <PanelHeader
                    eyebrow="Trajectory"
                    title="Next seven days"
                    description="Recovery is modelled on a saturating curve rather than a straight line — sleep debt does not clear in a night. This is a projection, not a guarantee."
                  />
                  <div className="px-4 py-4">
                    <TrajectoryChart data={sim.projectedTrajectory} />
                  </div>
                </Panel>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.div>
      </div>
    </motion.div>
  );
}

function Outcome({
  label,
  value,
  band,
}: {
  label: string;
  value: number;
  band: 'routine' | 'watch' | 'review';
}) {
  return (
    <div className="px-5 py-5">
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-2 flex items-baseline gap-2.5">
        <span className="font-serif text-[42px] leading-none tnum" style={{ color: BAND[band].css }}>
          {value.toFixed(0)}
        </span>
        <BandBadge band={band} size="sm" />
      </div>
    </div>
  );
}
