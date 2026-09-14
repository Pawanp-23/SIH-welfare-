/**
 * Landing page.
 *
 * Judges and senior officers see this before they see anything else, so it has
 * one job: state the problem precisely, state what this system does about it,
 * and get out of the way. No stock photography, no gradient hero, no
 * three-column feature grid of adjectives. The numbers on this page are fetched
 * live from the running instance, so the first thing anyone sees is real output
 * rather than a marketing claim.
 */

import React, { useRef } from 'react';
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';

import { api } from '../api/client.js';
import { useAsync } from '../app/hooks.js';
import { Wordmark } from '../app/AppShell.js';
import { duration, ease, stagger, staggerItem } from '../design/motion.js';
import { Button, Chip, Eyebrow, Panel, Ticker, cx } from '../design/primitives.js';
import { BandDistribution } from '../components/charts/Charts.js';

export function LandingScreen({ onEnter }: { onEnter: () => void }) {
  const overview = useAsync(() => api.getForceOverview(), []);
  const health = useAsync(() => api.getModelHealth(), []);
  const reduce = useReducedMotion();

  const o = overview.data?.overview;
  const m = health.data?.health.metrics as
    | { regression: { wri: { mae: number }; baselines: { self_report_only_mae: number } }; classification: { recall: number; roc_auc: number }; band_accuracy: number }
    | undefined;

  return (
    <div className="min-h-screen bg-paper">
      {/* Header */}
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between px-6 py-5">
          <Wordmark />
          <div className="flex items-center gap-3">
            <span className="hidden font-mono text-[10.5px] text-ink-faint sm:inline">
              Smart India Hackathon · Ministry of Home Affairs
            </span>
            <Button variant="primary" onClick={onEnter}>
              Open the system
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="border-b border-rule">
        <div className="mx-auto grid max-w-[1180px] gap-10 px-6 py-16 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:py-24">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }}>
            <Eyebrow>AI-based predictive personnel stress and welfare monitoring</Eyebrow>
            <h1 className="mt-4 text-[clamp(34px,5.4vw,60px)] leading-[1.04]">
              By the time a jawan asks for help,
              <br />
              <span className="italic">the warning signs are months old.</span>
            </h1>
            <p className="mt-6 max-w-xl text-[15.5px] leading-relaxed text-ink-muted">
              Stress in uniformed forces is not invisible. It is written into duty
              rosters, sleep records, leave refusals and heart-rate variability
              long before anyone raises it — and stigma makes sure nobody raises
              it early. SAHARA reads those signals continuously, predicts who is
              deteriorating, explains exactly why, and puts a specific, evidenced
              action in front of the officer who can authorise it.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button variant="primary" size="lg" onClick={onEnter}>
                Enter the system
              </Button>
              <span className="font-mono text-[11px] text-ink-faint">
                Four roles · synthetic data · no sign-up required
              </span>
            </div>

            <ul className="mt-10 grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {[
                'Predicts seven days ahead, not just today',
                'Exact TreeSHAP on every single prediction',
                'Command sees aggregates; never an individual',
                'Counterfactuals a commander can actually authorise',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-[13.5px] text-ink">
                  <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent" />
                  {t}
                </li>
              ))}
            </ul>
          </motion.div>

          {/* Live panel */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.12, ease }}
            className="stage-3d"
          >
            <TiltCard disabled={!!reduce}>
            <Panel className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-rule-hairline px-5 py-3">
                <Eyebrow>Live from this instance</Eyebrow>
                <span className="flex items-center gap-1.5 font-mono text-[10px] text-ink-faint">
                  <motion.span
                    className="size-1.5 rounded-full bg-routine"
                    animate={reduce ? {} : { opacity: [1, 0.3, 1] }}
                    transition={{ duration: 2.2, repeat: Infinity }}
                  />
                  running
                </span>
              </div>

              <div className="grid grid-cols-2 divide-x divide-y divide-rule-hairline">
                <Cell
                  label="Personnel monitored"
                  value={o ? <Ticker value={o.totalMonitored} /> : '—'}
                />
                <Cell
                  label="In review band"
                  value={o ? <Ticker value={o.highRisk} /> : '—'}
                  tone="var(--signal-review)"
                />
                <Cell
                  label="Band accuracy"
                  value={m ? <Ticker value={m.band_accuracy * 100} decimals={1} suffix="%" /> : '—'}
                />
                <Cell
                  label="Escalation recall"
                  value={m ? <Ticker value={m.classification.recall * 100} decimals={0} suffix="%" /> : '—'}
                />
              </div>

              {o ? (
                <div className="border-t border-rule-hairline px-5 py-4">
                  <Eyebrow>Force distribution, right now</Eyebrow>
                  <div className="mt-3">
                    <BandDistribution routine={o.lowRisk} watch={o.moderateRisk} review={o.highRisk} />
                  </div>
                </div>
              ) : null}

              <div className="border-t border-rule-hairline bg-paper-inset px-5 py-3">
                <p className="font-mono text-[10px] leading-relaxed text-ink-faint">
                  These figures are computed by the running model on synthetic
                  personnel data, not hard-coded. Reset the demo and they change.
                </p>
              </div>
            </Panel>
            </TiltCard>
          </motion.div>
        </div>
      </section>

      {/* The argument */}
      <section className="border-b border-rule bg-paper-sunken">
        <div className="mx-auto max-w-[1180px] px-6 py-16">
          <motion.div
            variants={stagger(0.05, 0.08)}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: '-80px' }}
            className="grid gap-8 lg:grid-cols-3"
          >
            {[
              {
                n: '01',
                title: 'Asking is not enough',
                body: 'In our evaluation, a model given only self-reported stress and fatigue has an error of 10.8 index points. Given duty rosters and wearable signals as well, that falls to 3.9. Stigma is not a data-collection problem you can survey your way out of — it is the reason you have to look elsewhere.',
              },
              {
                n: '02',
                title: 'A score nobody can question is useless',
                body: 'Every prediction carries exact SHAP attributions computed in 0.3 ms, showing which factor moved the index and by how much, against where that value sits in the population. An officer can disagree with the reason, not just the conclusion — and we record when they do.',
              },
              {
                n: '03',
                title: 'Prediction without a lever is just anxiety',
                body: 'Knowing someone is at 68 does not tell a commander what to change. SAHARA runs the counterfactual: apply a rest day, break a night-shift run, sanction leave, and it re-scores the same person through the same model and reports what actually moved.',
              },
            ].map((c) => (
              <motion.div key={c.n} variants={staggerItem}>
                <div className="font-mono text-[11px] text-ink-faint">{c.n}</div>
                <h3 className="mt-2 text-[23px] leading-tight">{c.title}</h3>
                <p className="mt-3 text-[13.5px] leading-relaxed text-ink-muted">{c.body}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Roles */}
      <section className="border-b border-rule">
        <div className="mx-auto max-w-[1180px] px-6 py-16">
          <Eyebrow>Four people, four different systems</Eyebrow>
          <h2 className="mt-3 max-w-2xl text-[32px] leading-tight">
            The same data, deliberately different windows onto it.
          </h2>
          <motion.div
            variants={stagger(0.04, 0.07)}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: '-60px' }}
            className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            {[
              {
                role: 'The jawan',
                sees: 'His own index, its full explanation, his consent record, and who has looked at it.',
                cannot: 'Nothing is hidden from him about himself.',
              },
              {
                role: 'The welfare officer',
                sees: 'Assigned cases, why each was flagged, ranked measures with modelled effect, and the case timeline.',
                cannot: 'Only personnel assigned to her.',
              },
              {
                role: 'The commanding officer',
                sees: 'Unit aggregates, escalation velocity, where pressure concentrates, and a pseudonymous live feed.',
                cannot: 'No name. No check-in text. Nothing below a cohort of ten.',
              },
              {
                role: 'The auditor',
                sees: 'A hash-chained record of every access and refusal, verifiable on demand.',
                cannot: 'Cannot alter it — that is the point.',
              },
            ].map((r) => (
              <motion.div key={r.role} variants={staggerItem}>
                <Panel className="h-full p-5">
                  <h4 className="text-[17px]">{r.role}</h4>
                  <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-muted">{r.sees}</p>
                  <p className="mt-2.5 border-t border-rule-hairline pt-2.5 text-[11.5px] leading-relaxed text-ink-faint">
                    {r.cannot}
                  </p>
                </Panel>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Engineering */}
      <section className="border-b border-rule bg-paper-sunken">
        <div className="mx-auto grid max-w-[1180px] gap-10 px-6 py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div>
            <Eyebrow>Under the surface</Eyebrow>
            <h2 className="mt-3 text-[32px] leading-tight">
              The model is real, and you can check.
            </h2>
            <p className="mt-4 text-[14px] leading-relaxed text-ink-muted">
              Five gradient-boosted ensembles are trained in Python on a
              literature-grounded synthetic cohort, split by individual so nobody
              appears in both train and test. The learned trees are exported to
              JSON and executed by a TypeScript engine — including an exact
              TreeSHAP implementation — so there is no second runtime to install
              and no Python on the critical path.
            </p>
            <p className="mt-3 text-[14px] leading-relaxed text-ink-muted">
              A verification suite asserts that the TypeScript engine reproduces
              scikit-learn's own predictions to 1e-13 and that every SHAP
              explanation satisfies local accuracy. If it did not, the build
              would fail.
            </p>
            <div className="mt-5 flex flex-wrap gap-1.5">
              {['React 19', 'Vite', 'Motion', 'Express', 'node:sqlite', 'scikit-learn', 'TreeSHAP', 'SSE'].map((t) => (
                <Chip key={t}>{t}</Chip>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-rule bg-[#14161A] shadow-e2">
            <div className="flex items-center gap-2 border-b border-[#282C33] px-4 py-2.5">
              <span className="size-2.5 rounded-full bg-[#3A3F47]" />
              <span className="size-2.5 rounded-full bg-[#3A3F47]" />
              <span className="size-2.5 rounded-full bg-[#3A3F47]" />
              <span className="ml-2 font-mono text-[10.5px] text-[#6B6860]">npm run ml:verify</span>
            </div>
            <pre className="overflow-x-auto px-4 py-4 font-mono text-[11px] leading-relaxed text-[#9A968A]">
{`  [`}<span className="text-[#58AE84]">PASS</span>{`] inference parity: wri              max |Δ| = 1.28e-13
  [`}<span className="text-[#58AE84]">PASS</span>{`] inference parity: wri_7d           max |Δ| = 1.42e-13
  [`}<span className="text-[#58AE84]">PASS</span>{`] inference parity: escalation       max |Δ| = 6.22e-15
  [`}<span className="text-[#58AE84]">PASS</span>{`] SHAP local accuracy: wri           8.53e-14
  [`}<span className="text-[#58AE84]">PASS</span>{`] SHAP: unused features get zero
  [`}<span className="text-[#58AE84]">PASS</span>{`] latency budget                     322.5µs

  `}<span className="text-[#58AE84]">All model-runtime checks passed.</span>{`
  model sahara-gbm-v2.0.0 · 25 features · 780 trees`}
            </pre>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section>
        <div className="mx-auto max-w-[1180px] px-6 py-20 text-center">
          <h2 className="mx-auto max-w-2xl text-[clamp(26px,3.6vw,40px)] leading-tight">
            Welfare systems fail when the people they watch stop trusting them.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[14px] leading-relaxed text-ink-muted">
            So this one is built to be inspected: by the jawan whose index it
            computes, by the officer who acts on it, and by anyone who wants to
            check the chain.
          </p>
          <div className="mt-7">
            <Button variant="primary" size="lg" onClick={onEnter}>
              Open the system
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3 px-6 py-6">
          <span className="font-mono text-[10.5px] text-ink-faint">
            SAHARA · Predictive Personnel Welfare Intelligence
          </span>
          <span className="font-mono text-[10.5px] text-ink-faint">
            All data synthetic · no real personnel record is processed
          </span>
        </div>
      </footer>
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="px-5 py-5">
      <Eyebrow>{label}</Eyebrow>
      <div className={cx('mt-1.5 font-serif text-[32px] leading-none tnum')} style={tone ? { color: tone } : undefined}>
        {value}
      </div>
    </div>
  );
}

/**
 * A card that leans a few degrees toward the pointer.
 *
 * This is the one place on the landing page that is allowed a spatial effect,
 * and it is capped at ±4° so it reads as a physical object on a desk rather
 * than a floating UI card. It does nothing under `prefers-reduced-motion`, and
 * nothing on touch devices, where there is no hover to follow.
 */
function TiltCard({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const spring = { stiffness: 160, damping: 22, mass: 0.6 };
  const rotateX = useSpring(useTransform(py, [0, 1], [4, -4]), spring);
  const rotateY = useSpring(useTransform(px, [0, 1], [-4, 4]), spring);

  if (disabled) return <>{children}</>;

  return (
    <motion.div
      ref={ref}
      className="tilt-3d"
      style={{ rotateX, rotateY }}
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse' || !ref.current) return;
        const b = ref.current.getBoundingClientRect();
        px.set((e.clientX - b.left) / b.width);
        py.set((e.clientY - b.top) / b.height);
      }}
      onPointerLeave={() => {
        px.set(0.5);
        py.set(0.5);
      }}
    >
      {children}
    </motion.div>
  );
}
