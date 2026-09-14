# SAHARA — Implementation Plan

This is the plan the current build was produced against, with the actual
outcome of each phase recorded. It is kept as a record of sequencing decisions
rather than rewritten into a tidy retrospective, because the *order* is the
part worth reusing.

---

## The sequencing principle

**Build the thing judges will probe hardest, first.**

For this problem statement that is the model. Every team will have a dashboard;
the differentiator is whether the numbers on it come from something real. So
the ML pipeline was built and verified before a single screen was designed, and
the verification suite was written before the UI so that a broken model could
never quietly ship into a demo.

The second principle: **anything that can fail to install will fail to install
on demo morning.** The whole system carries zero native modules and zero new
runtime dependencies beyond what the prototype already had.

---

## Phase 0 — Assess what exists (30 min)

The repository already contained ~15k lines: React 19 + Vite + Tailwind v4 +
Express, four role portals, seven screens. Type-checked clean.

**Decision: upgrade, do not rebuild.** The domain model in `src/types.ts` was
well designed and the feature surface was broad. What was wrong was underneath
it — the "ML pipeline" was a hand-tuned formula with comments claiming to be
XGBoost, storage was in-memory, and there was no authentication.

| Kept | Replaced |
|---|---|
| Domain types and API route shapes | Every scoring path |
| Seed personas and unit structure | Storage layer |
| Suppression engine | UI, entirely |
| RAG SOP corpus | Auth, validation, audit |

---

## Phase 1 — A real model (3 h) ✅

**Goal:** a model that survives the question *"show me your training."*

1. **`ml/generate_dataset.py`** — structural causal simulator. 2,200 simulated
   personnel × 12 weeks = 26,400 longitudinal rows, 25 features across 8
   domains, with literature-grounded non-linear effects and interactions
   (saturating sleep-debt response, night shifts super-additive with debt,
   cohesion moderating deployment stress, separation gated on contact lapse).
   Protected attributes generated for fairness audit only.
2. **`ml/train.py`** — five gradient-boosted ensembles:
   - `wri` — current Welfare Risk Index
   - `wri_7d` — index seven days ahead (the predictive core)
   - `escalation` — P(welfare escalation ≤ 14 days)
   - `wri_q10` / `wri_q90` — quantile pair giving a real 80% interval
3. **`GroupShuffleSplit` by personnel id** — no individual in both train and
   test. This is the difference between a held-out score and a leaked one.
4. **Honest evaluation** — against a linear baseline, a logistic baseline, a
   persistence baseline, and a self-report-only baseline; plus calibration
   bins, band confusion, permutation importance and a fairness audit across
   three protected attributes.
5. **Export with verification** — the learned trees serialise to JSON, and the
   training script *re-implements inference in numpy from the JSON* and fails
   the build if it does not reproduce sklearn.

**Calibration notes worth keeping:** the first simulator run put 77 % of the
cohort in the review band. Three tuning passes on the structural equation
brought the distribution to 47/35/18 % routine/watch/review with a mean WRI of
41.7 — realistic for a force under strain, and matching what the live demo
cohort now shows, which is why drift reads low.

---

## Phase 2 — TypeScript inference + exact TreeSHAP (2 h) ✅

**Goal:** no Python at runtime, and provably the same model.

1. **`server/ml/gbm.ts`** — tree traversal and ensemble inference.
2. **Exact TreeSHAP** — the Lundberg path-dependent algorithm, implemented from
   the paper. ~180 lines of extend/unwind path arithmetic.
3. **`server/ml/verify.ts`** — asserts, against a 500-row held-out fixture:
   - inference parity with scikit-learn, all five ensembles
   - SHAP **local accuracy**: `E[f(X)] + Σφ == f(x)`
   - unused features receive exactly zero attribution
   - latency budget

**Two bugs this phase produced, both caught by the verifier rather than by
reading the code:**

- *float32 routing.* scikit-learn demotes the feature matrix to float32 before
  comparing against split thresholds. A value within one float32 ULP of a split
  routes differently in float64 — one prediction in a few hundred drifted by a
  whole leaf value. Fixed with `Math.fround` in the comparison.
- *TreeSHAP off-by-one.* The reference algorithm's `unique_depth` is the index
  of the element just written, not the path length. Getting this wrong produces
  plausible-looking but wrong attributions; local accuracy caught it instantly.

```
[PASS] inference parity: wri              max |Δ| = 1.28e-13
[PASS] SHAP local accuracy: wri           max |E[f]+Σφ−f(x)| = 8.53e-14
[PASS] latency        predict 7.6µs · full SHAP explain 322.5µs
```

---

## Phase 3 — Backend hardening (3 h) ✅

**Constraint: zero new npm dependencies.**

| Need | Conventional choice | What was built instead | Why |
|---|---|---|---|
| Password hashing | `bcrypt` | `node:crypto` scrypt | Native module; fails to build on some Windows setups |
| Session tokens | `jsonwebtoken` | HMAC-SHA256 JWT, ~40 lines | Same construction, no dependency |
| Validation | `zod` | 150-line schema validator | Covers everything the API needs, including control-character stripping on free text |
| Persistence | `better-sqlite3` | `node:sqlite` | Built into Node 22.5+; no compiler |
| Live updates | WebSocket | Server-sent events | One-directional traffic; survives proxies; browser reconnects itself |

Also built: RBAC middleware where the *refusal* is logged, token-bucket rate
limiting, a hash-chained audit log with on-demand verification, an append-only
consent ledger, and a normalised SQLite schema (11 tables) replacing the
in-memory store.

**Case creation was deliberately kept out of the model.** Four documented rules
open a case: direct request, two consecutive review-band readings, a forecast
crossing into the review band while the person is still in watch, and ten
consecutive watch-band readings still rising. The model decides how worried to
be; a rule a human can read decides when a human is involved.

**Consistency bug worth recording:** the what-if simulator originally started
from `getContext()` — which omits the six check-in-derived features — so its
baseline silently differed from the dossier's number. Two different risk scores
for the same person on two screens is precisely the kind of thing that loses a
room. Fixed by routing everything through one `currentFeatures()` method.

---

## Phase 4 — Design system and UI (4 h) ✅

**Goal: it must not look generated.**

1. **A stated design language.** "Field Manual": warm paper ground, ink
   typography, hairline rules instead of drop shadows, a serif display face, a
   monospace data face, and exactly three signal colours each meaning exactly
   one thing. Every colour is a token; no component contains a hex value.
2. **One motion vocabulary** (`src/design/motion.ts`). Every panel enters the
   same way, on the same curve, at the same speed. Inconsistent timing across
   screens is the most reliable tell of machine-written UI.
3. **A component vocabulary** (`src/design/primitives.tsx`) — panels, stats,
   scales, sliders, tabs with a shared sliding underline, modal, skeleton,
   empty and error states.
4. **A validated chart palette.** The categorical palette was run through a
   colour-vision validator and failed on the first three attempts (chroma
   floor, adjacent-pair CVD separation). The shipped palette passes lightness
   band, chroma floor, CVD separation, normal-vision floor and contrast in
   **both** light and dark mode, with dark steps re-validated against the dark
   surface rather than lightened automatically.
5. **Nine screens rebuilt** against the new API, plus a landing page whose
   headline figures are fetched live from the running instance.

---

## Phase 5 — Verification and delivery ✅

- `npm run lint` — TypeScript, zero errors
- `npm run ml:verify` — model runtime parity and SHAP correctness
- `npm run build` + production smoke test
- Playwright pass over every screen in all three roles, plus dark mode and a
  414 px viewport, checking for console errors

---

## If you have more time before judging

In priority order:

| Priority | Task | Effort | Why |
|---|---|---|---|
| 1 | Rehearse the demo run in §DEMO_SCRIPT twice | 30 min | The single highest-return activity remaining |
| 2 | Read the model card numbers until you can say them without the screen | 20 min | The likeliest hard questions are all there |
| 3 | Hindi labels on the check-in screen | 1 h | Speaks directly to real deployability |
| 4 | Offline queue for the check-in (`localStorage` + retry) | 1.5 h | Border postings; strong deployability answer |
| 5 | Export a unit welfare report as PDF | 1.5 h | Commanders ask for paper |
| 6 | Retrain with `--personnel 8000` for tighter confidence intervals | 20 min run | Marginal; the current numbers are already honest |

**Do not** add features in the last hours. A rehearsed demo of what exists
beats an unrehearsed demo of slightly more.
