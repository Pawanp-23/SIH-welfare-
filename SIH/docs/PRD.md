# SAHARA — Product Requirements Document

**AI-Based Predictive Personnel Stress and Welfare Monitoring System for Uniformed Forces**

| | |
|---|---|
| Version | 2.0 |
| Status | Prototype complete, evaluated |
| Model | `sahara-gbm-v2.0.0` |
| Problem statement | AI-Based Predictive Personnel Stress and Welfare Monitoring System for Uniformed Forces |

---

## 1. The problem, stated precisely

India's Central Armed Police Forces have lost more personnel to suicide than to
hostile action for several years running. The Parliamentary Standing Committee
on Home Affairs has repeatedly identified the same contributing factors:
prolonged deployment away from family, denied or deferred leave, sustained
duty hours without rest days, and grievances that stay unresolved.

None of those factors are hidden. All of them are already recorded — in duty
rosters, leave registers, posting orders and, increasingly, in issued
wearables. The failure is not one of data collection. It is that **nobody is
reading the data as a welfare signal**, and that the one mechanism designed to
surface distress — a person raising their hand — is the mechanism stigma most
reliably suppresses.

So the problem decomposes into four sub-problems, and a system that solves only
the first is not useful:

| # | Sub-problem | Why the obvious answer fails |
|---|---|---|
| P1 | **Detection.** Identify personnel whose welfare is deteriorating. | Asking them does not work. Self-report is attenuated by stigma and by the well-founded fear that an honest answer reaches the chain of command. |
| P2 | **Anticipation.** Identify them *before* the crisis, not during it. | A system that reports today's state gives a commander no time to act. The lever — a rest day, a roster change, a leave sanction — takes days to have effect. |
| P3 | **Explanation.** Make the finding actionable and contestable. | A risk score with no reason attached is either ignored or obeyed blindly. Both are failures. An officer must be able to disagree with the *reason*. |
| P4 | **Trust.** Ensure the monitored population does not experience the system as surveillance. | If a jawan believes his check-in reaches his CO, he answers it dishonestly, and every downstream number becomes noise. Privacy here is not compliance overhead; it is a data-quality requirement. |

---

## 2. Users and what each one needs

### 2.1 The jawan (constable / personnel) — the monitored individual

**Needs:** to spend under a minute a day on this; to know exactly who can see
what; to be able to ask for help without first performing distress for an
algorithm; to see and contest what the system concludes about him.

**Explicitly does not need:** a mental-health questionnaire. A twenty-item
battery every morning gets abandoned inside a week, and an abandoned
instrument produces worse data than a short one.

### 2.2 The welfare officer — the person who acts

**Needs:** a ranked queue, because she has four hours a week and thirty people;
the reason each person was flagged, at the level of individual factors; a
specific action she can actually take, with the policy that authorises it; and
a first-class way to say *this recommendation is wrong* and have that recorded.

### 2.3 The commanding officer — the person who can change conditions

**Needs:** to know where his force is under strain and why, and to be able to
test a decision (roster change, rest days, rotation) before making it.

**Must not have:** the ability to identify an individual. Not because of
regulation alone, but because the moment his people believe he can, the input
data degrades to uselessness.

### 2.4 The auditor / system administrator

**Needs:** an access record nobody — including command — can quietly edit, and
a model card honest enough to decide how much to trust the system.

---

## 3. Scope

### 3.1 In scope (built)

- **Daily check-in** — five questions, under 30 seconds, with the privacy
  position stated on the form rather than in a policy document.
- **Welfare Risk Index (WRI)** — a 0–100 continuous index with a genuine 80%
  prediction interval, banded routine / watch / review.
- **Seven-day forecast** — a separately trained ensemble predicting the index a
  week ahead, evaluated against a persistence baseline.
- **Escalation classifier** — calibrated probability of a welfare escalation
  within 14 days, thresholded on a recall-weighted objective.
- **Per-prediction explanation** — exact TreeSHAP attributions, with each
  factor's value and its percentile in the training population.
- **Documented escalation rules** — four inspectable triggers that open a case.
  The model decides how worried to be; a rule decides when a human is involved.
- **Evidence-linked interventions** — ranked by *measured* counterfactual effect
  on that specific individual, each carrying a literature citation and the rank
  that can authorise it.
- **What-if simulator** — apply command-authorisable levers, re-score through
  the same ensemble, and show which attributions moved.
- **Command aggregates** — force posture, escalation velocity, unit
  intelligence, with k-anonymity enforced in the query layer.
- **Privacy architecture** — keyed pseudonyms, role-based access control,
  append-only consent ledger, hash-chained audit log with on-demand verification.
- **Model card** — performance, baselines, calibration, fairness audit, drift,
  and provenance, published in the product rather than in a slide.

### 3.2 Explicitly out of scope (and why)

- **Clinical diagnosis.** SAHARA produces a welfare *risk index*, not a
  psychiatric assessment. It is a triage aid for a human welfare officer.
- **Automated decisions.** No action is taken without a named human approving
  it. Every recommendation carries an explicit dismiss control.
- **Free-text analysis.** Notes written during a check-in are stored for the
  assigned officer and are **not a model input**. Scoring a person's words would
  destroy the willingness to write them.
- **Protected attributes as features.** Gender, rank group and force branch are
  generated for fairness auditing only and are never model inputs.

---

## 4. Functional requirements

| ID | Requirement | Status |
|---|---|---|
| FR-1 | Personnel submit a daily check-in of ≤ 5 items in ≤ 30 seconds | Built |
| FR-2 | Each check-in produces a WRI, a band, an 80% interval and a 7-day forecast | Built |
| FR-3 | Each prediction carries per-factor SHAP attributions summing to the prediction | Built, asserted in CI |
| FR-4 | Assessments where inputs were imputed report reduced coverage, visibly | Built |
| FR-5 | Four documented rules open a welfare case; each case records which fired | Built |
| FR-6 | Recommendations are ranked by counterfactual effect on that individual | Built |
| FR-7 | Officers can dismiss a recommendation with a recorded reason | Built |
| FR-8 | A what-if simulator re-scores through the same ensemble and reports attribution shift | Built |
| FR-9 | Command sees no individual record; requests are refused and the refusal logged | Built |
| FR-10 | No aggregate is released for a cohort below k = 10 | Built, enforced in query layer |
| FR-11 | Every access, refusal and model run is written to a hash-chained audit log | Built |
| FR-12 | The audit chain can be verified on demand by any user | Built |
| FR-13 | Consent is append-only; withdrawal halts processing without erasing history | Built |
| FR-14 | Alerts reach command dashboards without a page refresh | Built (SSE) |
| FR-15 | The model card is published in-product, including unfavourable metrics | Built |

---

## 5. Non-functional requirements

| Area | Requirement | Achieved |
|---|---|---|
| Latency | Score + full explanation under 50 ms p95 | **0.76 ms p95** measured in-product; 322 µs for a full 25-feature TreeSHAP explanation |
| Setup | Runs from a clean clone with one command, no native compilation | `npm install && npm run dev`; zero native modules |
| Offline | Must survive a venue with no internet | No runtime LLM dependency; Gemini is an optional enhancement over a local retrieval layer that always answers |
| Persistence | Data survives a restart | `node:sqlite`, normalised schema, WAL |
| Portability | Must run on Windows, macOS and Linux | No shell-specific scripts; production mode selected by CLI flag, not an env var |
| Accessibility | Keyboard navigable; no colour-only encoding; honours reduced-motion | Band always carries a text label; `prefers-reduced-motion` respected globally |
| Auditability | The deployed model must provably be the evaluated model | `npm run ml:verify` asserts TS inference matches scikit-learn to 1e-13 |

---

## 6. Data

### 6.1 Why synthetic, and why that is defensible

No public dataset of uniformed-forces welfare telemetry exists, and using real
personnel records for a prototype would be both an ethics violation and a DPDP
Act violation. SAHARA is trained on a **structural causal simulator**: a
longitudinal generative model whose effect directions and magnitudes are taken
from published occupational-health literature (sleep-debt dose-response,
circadian misalignment from consecutive night shifts, HRV as a marker of
allostatic load, unit cohesion as a protective moderator, deployment length,
leave denial).

The important property is that **the pipeline is dataset-agnostic**. The
simulator emits exactly the schema a real deployment would ingest. Point
`ml/train.py` at a CSV of real CAPF HRMS + wearable data with the same columns
and it retrains without a code change.

### 6.2 Feature set (25 features, 8 domains)

| Domain | Features |
|---|---|
| Sleep | 7-day average sleep, cumulative sleep debt, sleep irregularity |
| Schedule | consecutive night shifts, 7-day average duty hours, overtime, days since rest day |
| Operational | continuous deployment days, high-altitude posting, hardship index, distance from home, transfers in 24m |
| Social | days since family contact, leave requests denied in 6m, unit cohesion score, pending grievance |
| Physiological | HRV (RMSSD), resting HR vs personal baseline, 7-day step average, physical readiness |
| Self-report | perceived stress (1–5), perceived fatigue (1–5) |
| Demographic | age, years of service |
| History | prior welfare contact |

Self-report is two of twenty-five features by design. The evaluation quantifies
why: see §7.

### 6.3 Data sources in a real deployment

| Feature group | Source |
|---|---|
| Duty, rest, night shifts, deployment, posting, transfers, leave | Existing CAPF HRMS / e-office roster systems |
| HRV, resting HR, steps | Issued wearables (opt-in, per the consent ledger) |
| Cohesion, grievance | Periodic unit survey + existing grievance register |
| Stress, fatigue, sleep | The daily check-in |

---

## 7. Success metrics

### 7.1 Model metrics (held-out, split by individual)

| Metric | Value | Baseline |
|---|---|---|
| WRI mean absolute error | **3.87** pts | Linear regression 4.23; self-report only 10.83 |
| WRI R² | 0.952 | — |
| Band accuracy (routine/watch/review) | **90.3 %** | — |
| 7-day-ahead MAE | **14.02** | Persistence 16.00 (−12.4 % error) |
| Escalation ROC-AUC | **0.812** | Logistic regression 0.808 |
| Escalation recall @ operating threshold | **0.784** | — |
| Escalation precision | 0.396 | Base rate 0.23 |
| Brier score | 0.126 | — |
| 80 % interval empirical coverage | **79.5 %** | Nominal 80 % |
| Fairness (four-fifths rule) | gender 0.91, rank 0.83, branch 0.82 | Threshold 0.80 |

**The two numbers that carry the argument:**

1. **10.83 → 3.87 MAE.** Self-report alone is a poor predictor. Adding roster
   and wearable signals cuts error by 64 %. This is the quantified case for the
   whole architecture, and the reason the check-in can stay at five questions.
2. **16.00 → 14.02 seven-day MAE.** A real but modest 12 % improvement over
   assuming nothing changes. Stated plainly rather than dressed up, because a
   commander deciding how much weight to put on a forecast deserves the honest
   number.

Precision of 0.40 is a deliberate choice, not a weakness: the threshold is
tuned on F2 (recall weighted 4× precision) because an unnecessary welfare
conversation costs an hour and a missed deterioration can cost far more.

### 7.2 Deployment metrics (what would be measured in a pilot)

| Metric | Target |
|---|---|
| Check-in completion rate | > 70 % of roster, sustained past week 4 |
| Median time from flag to first officer contact | < 24 h |
| Share of flags an officer judged appropriate | > 50 % (the dissent record is the measurement) |
| Share of interventions authorised where the model projected > 5 pts | > 60 % |
| Self-reported trust that command cannot see individual data | > 80 % |

That third metric matters most. A system whose flags officers routinely dismiss
is mis-calibrated to the operational reality, and the dismiss control exists so
that this is measurable rather than invisible.

---

## 8. Privacy, ethics and legal position

| Control | Implementation | Enforced where |
|---|---|---|
| k-anonymity (k = 10) | Cohorts below threshold return a suppression notice, not numbers | Repository / query layer |
| Pseudonymisation | HMAC-SHA256 under a server key, deterministic, not reversible from a roster | `core/crypto.ts` |
| Individual-record shield | Command roles receive 403 on any individual endpoint | `middleware/requireSelfOrAssignedOfficer` |
| Free-text exclusion | Notes are stored but never reach the model | `ml/engine.ts` feature contract |
| Append-only consent | Withdrawal halts processing; the historical grant is retained for lawful-basis audit | `consent_ledger` table |
| Tamper-evident access log | SHA-256 hash chain, verifiable on demand | `core/audit.ts` |
| Non-punitive use | Disciplinary and promotion boards barred (SOP-WEL-04); no system pathway exists | Policy + architecture |
| Protected attributes excluded | Not model inputs; retained only for the fairness audit | `ml/generate_dataset.py` |

**DPDP Act 2023 alignment:** consent is explicit, purpose-limited and
withdrawable; data minimisation is enforced by the five-item check-in and the
exclusion of free text from processing; the consent ledger provides the record
of lawful basis; the audit chain provides accountability.

---

## 9. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Personnel do not trust the privacy claims and answer dishonestly | **Critical** — poisons every downstream number | Privacy position stated on the check-in form; command refusal is enforced and logged; the individual can read their own full record and audit trail |
| The system is repurposed for performance management | **Critical** | No pathway exists in the data model; SOP-WEL-04 prohibition; every access logged and verifiable |
| Officers over-trust the score | High | Prediction intervals shown, not hidden; coverage stated; precision published in-product; dismiss is a first-class action |
| Model drifts as force conditions change | Medium | PSI against training deciles stored in the artifact; drift is gated on sample size rather than reported from noise |
| Wearable coverage is partial | Medium | Imputation is explicit and reduces the stated coverage of that assessment |
| Synthetic training data does not transfer | Medium | Pipeline is dataset-agnostic; a pilot retrains on real data with one command; the simulator's effect directions are literature-grounded and stated |

---

## 10. What a pilot would need next

1. **Retrain on real data.** One command, same schema. The evaluation harness,
   fairness audit and calibration plots carry over unchanged.
2. **Federated identity.** Replace the local password store with the force's
   existing identity provider.
3. **HRMS connector.** Replace the synthetic context generator with a scheduled
   pull from the roster system.
4. **Clinical governance.** A named medical officer signs off on the band
   thresholds and the intervention playbook before any live use.
5. **Offline-first mobile client.** Border postings have intermittent
   connectivity; the check-in must queue locally.
6. **Regional languages.** Hindi first, then the force's operational languages.
