# SAHARA

**AI-Based Predictive Personnel Stress and Welfare Monitoring System for Uniformed Forces**

Stress in the armed and central police forces is not invisible. It is written
into duty rosters, sleep records, leave refusals and heart-rate variability
months before anyone raises it — and stigma makes sure nobody raises it early.

SAHARA reads those signals continuously, predicts who is deteriorating seven
days out, explains every prediction with exact SHAP attributions, and puts a
specific evidenced action in front of the officer who can authorise it —
without ever letting command see an individual.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:3000
```

That is the whole setup. There are **no native modules**, so `npm install`
cannot fail to compile, and there is **no Python at runtime** — the trained
model ships as JSON and is executed by TypeScript.

Every demo account's password is `sahara`:

| Account | Role | What they see |
|---|---|---|
| `p-014` | Personnel | Their own index, its full explanation, their audit trail |
| `wo-001` | Welfare officer | Assigned cases, ranked interventions, the simulator |
| `cmd-001` | Command | Unit aggregates, escalation velocity, model card |
| `adm-001` | Administrator | Everything, plus the demo reset control |

Press `?` in the app for keyboard shortcuts; `1`–`9` jump between screens.

---

## Verifying the model

The headline claim is that the model is real and that the model serving these
screens is provably the model that was evaluated. Both are checkable:

```bash
npm run ml:verify
```

```
[PASS] feature order matches artifact             25 features
[PASS] inference parity: wri                      max |Δ| = 1.28e-13
[PASS] inference parity: wri_7d                   max |Δ| = 1.42e-13
[PASS] inference parity: escalation (raw logit)   max |Δ| = 6.22e-15
[PASS] inference parity: escalation P(y=1)        max |Δ| = 5.55e-16
[PASS] SHAP local accuracy: wri                   max |E[f]+Σφ−f(x)| = 8.53e-14
[PASS] SHAP local accuracy: escalation            max |E[f]+Σφ−f(x)| = 4.00e-15
[PASS] SHAP: unused features get exactly zero
[PASS] latency budget (<2ms explain)              predict 7.6µs · full SHAP explain 322.5µs

All model-runtime checks passed.
model sahara-gbm-v2.0.0 · 25 features · 780 trees total
```

To regenerate the cohort and retrain from scratch (needs Python with
scikit-learn, pandas and numpy — **only for training, never at runtime**):

```bash
npm run ml:all       # generate → train → verify   (~90 s)
```

---

## What it does

| | |
|---|---|
| **Detects** | A 0–100 Welfare Risk Index from 25 features across sleep, duty schedule, operational tempo, physiology, social factors and self-report |
| **Predicts** | A separately trained ensemble forecasts the index seven days ahead, plus a calibrated probability of escalation within 14 days |
| **Quantifies uncertainty** | A genuine 80 % prediction interval from quantile-regression ensembles — empirical coverage 79.5 % |
| **Explains** | Exact TreeSHAP on every prediction in ~320 µs, with each factor's value and its percentile in the training population |
| **Recommends** | Interventions ranked by *measured* counterfactual effect on that individual, each with a literature citation and the rank that can authorise it |
| **Simulates** | Apply command-authorisable levers and see the re-scored index and which attributions moved |
| **Protects** | k-anonymity in the query layer, HMAC pseudonyms, RBAC with logged refusals, append-only consent, hash-chained audit |

---

## Evaluation

All figures are held-out, split by **individual** (`GroupShuffleSplit` on
personnel id) so nobody appears in both train and test.

| Metric | SAHARA | Baseline |
|---|---|---|
| WRI mean absolute error | **3.87** | linear 4.23 · **self-report only 10.83** |
| Band accuracy | **90.3 %** | — |
| 7-day-ahead MAE | **14.02** | persistence 16.00 |
| Escalation ROC-AUC | **0.812** | logistic 0.808 |
| Escalation recall / precision | **0.784** / 0.396 | base rate 0.23 |
| Brier score | 0.126 | — |
| 80 % interval coverage | **79.5 %** | nominal 80 % |
| Fairness (four-fifths) | gender 0.91 · rank 0.83 · branch 0.82 | threshold 0.80 |

**Read the first row carefully.** Against a linear model on the same features
the gain is modest. The large gain is over self-report alone — which is the
entire argument for ingesting duty rosters and wearables rather than
lengthening the questionnaire, and the reason the daily check-in can stay at
five questions.

Precision of 0.40 is deliberate: the operating threshold is tuned on F2 (recall
weighted 4× precision) because an unnecessary welfare conversation costs an
hour and a missed deterioration can cost far more. The number is published in
the product, on the model card.

The full model card — calibration, band confusion, permutation importance,
fairness slices, drift and provenance — is a screen in the app, not a document.

---

## Architecture

```
ml/                          Python — training only, never at runtime
├── generate_dataset.py      Structural causal simulator (2,200 personnel × 12 weeks)
├── train.py                 Trains 5 ensembles, evaluates, exports + verifies
└── artifacts/               metrics.json, reference_predictions.json

server/
├── models/
│   └── sahara-model-v2.json The actual learned trees (780 across 5 ensembles)
├── ml/
│   ├── gbm.ts               Tree inference + exact TreeSHAP (Lundberg algorithm)
│   ├── engine.ts            WRI, intervals, forecast, attribution, counterfactuals, PSI
│   ├── interventions.ts     Evidence-linked playbook, ranked by measured effect
│   └── verify.ts            Cross-runtime parity + SHAP local-accuracy assertions
├── core/                    crypto (scrypt, HMAC JWT, pseudonyms), validation, audit chain, SSE
├── db/database.ts           node:sqlite, 11-table normalised schema
├── middleware/              identity, RBAC, rate limiting, error shaping
├── cruds/repository.ts      The only place that touches SQL; holds the escalation rules
└── server.ts                API

src/
├── design/                  Design tokens, motion vocabulary, component primitives
├── components/
│   ├── explain/             Risk dial, SHAP waterfall, driver list, coverage
│   └── charts/              Themed Recharts wrappers on a CVD-validated palette
├── screens/                 Nine screens
└── app/                     Shell, hooks, live event stream
```

### Notable engineering decisions

**Zero new dependencies.** scrypt from `node:crypto` instead of `bcrypt`; a
hand-rolled HMAC JWT instead of `jsonwebtoken`; a 150-line validator instead of
`zod`; `node:sqlite` instead of `better-sqlite3`. Every one of those swaps
removes a way for the build to fail on a machine you have not tested on.

**The model runs in TypeScript.** Training happens in Python; the learned trees
are exported to JSON and executed by `server/ml/gbm.ts`. No second runtime, no
Python on the critical path, and `npm run ml:verify` proves the two agree to
1e-13. (One subtlety it caught: scikit-learn demotes features to float32 before
comparing against thresholds, so the runtime uses `Math.fround` to route
identically.)

**Escalation is a rule, not a model output.** Four documented triggers open a
case: direct request, two consecutive review-band readings, a forecast crossing
into review while still in watch, and ten consecutive watch-band readings still
rising. The model decides how worried to be; an inspectable rule decides when a
human gets involved.

**Privacy is enforced in the query layer.** k-anonymity suppression happens
before data leaves the repository, and a command role requesting an individual
record receives 403 — with the refusal written to the audit chain.

---

## Documentation

| Document | What is in it |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | Problem framing, users, scope, requirements, metrics, privacy position, risks |
| [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) | Phased build plan, decisions and their rationale, bugs found and how |
| [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md) | 7-minute run sheet, what to say at each step, and the hard judge questions with answers |

---

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Dev server with HMR at :3000 |
| `npm run build` | Production client bundle + ESM server bundle |
| `npm start` | Run the production build |
| `npm run lint` | TypeScript, no emit |
| `npm run ml:verify` | Model runtime parity + SHAP correctness |
| `npm run ml:all` | Regenerate cohort → retrain → verify |
| `npm run verify` | lint + ml:verify |

Optional environment (`.env`): `GEMINI_API_KEY` enables LLM synthesis over the
SOP retrieval layer. Without it the retrieval layer still returns the SOP text
and its citation — there is no LLM on the critical path, deliberately.

---

## A note on the data

Every personnel record here is synthetic, generated by a structural causal
simulator whose effect directions come from published occupational-health
literature. No public dataset of forces welfare telemetry exists, and using
real personnel records for a prototype would be an ethics and DPDP Act
violation.

The pipeline is dataset-agnostic: point `ml/train.py` at a real CSV with the
same columns and it retrains without a code change. The evaluation harness,
fairness audit and calibration plots carry over unchanged.
