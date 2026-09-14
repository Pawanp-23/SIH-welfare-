# SAHARA — Demo run sheet and judge Q&A

**Before you start:** `npm run dev`, open `http://localhost:3000`, sign in and
out once to warm the caches, then press the demo **Reset** (sign in as
`adm-001`) so the data is in its known state. Total run: **7 minutes**, leaving
time for questions.

Every account's password is `sahara`.

---

## The one-sentence pitch

> Stress in the forces is already written into duty rosters, leave registers and
> wearables months before anyone raises it — SAHARA reads those signals,
> predicts who is deteriorating a week out, explains exactly why with exact
> SHAP values, and puts an evidenced action in front of the officer who can
> authorise it, without ever letting command see an individual.

---

## The run

### 0 · Landing page — 30 seconds

Point at the live panel on the right.

> "Those four numbers are fetched from the running instance, not typed into the
> page. 33 personnel, 2 currently in the review band, 90.3 % band accuracy,
> 78 % escalation recall. If we reset the demo, they change."

Read the headline. Then click **Open the system**.

---

### 1 · The jawan — 90 seconds

Sign in as **`p-014`** (Rahul Verma, Constable).

> "This is the whole ask of the person being monitored. Five questions, thirty
> seconds."

Point at the right-hand panel *Who sees this* before touching the form.

> "Note where this is. Not in a consent modal, not in a policy PDF — on the form
> itself, above the questions. The biggest barrier to honest self-report in a
> uniformed force is the fear that the answer reaches the CO. If they don't
> believe the privacy claim, they lie, and every number downstream is noise."

Set sleep to **4.5 h**, duty to **13 h**, night duty **on**, stress **4**,
fatigue **4**. Submit.

> "Scored in under a millisecond. Index 68, review band, with an 80 % prediction
> interval — not a single confident number. And here is why:"

Scroll to the factor list.

> "These are not generic advice. They are this prediction's own exact SHAP
> contributions. Sleep debt, days since rest, cohesion — each with the person's
> actual value and where it sits in the training population. 89th percentile for
> sleep debt means something; '16 hours' alone doesn't."

---

### 2 · The command view — 60 seconds

Sign out. Sign in as **`cmd-001`** (Col. Vikram Rawat).

> "Same data, completely different system."

Point at the live feed in the right column.

> "That check-in we just submitted arrived here over a server-sent event stream,
> with no refresh. But look at what arrived: a pseudonym. `PSN-LLG4-VYLN`. The
> CO can see his force is under strain. He cannot see who."

Point at *What command cannot see*.

> "That's not a UI decision. If he requests an individual record, the server
> returns 403 and logs the refusal. Detachment Alpha over here reports no
> numbers at all — it is below our k-anonymity threshold of ten people, so the
> aggregate is suppressed in the query layer, not hidden in the interface."

---

### 3 · The officer — 2 minutes *(the core of the demo)*

Sign in as **`wo-001`** (Capt. Ananya Sen).

Three cases. Click the **P-302** case — the watch-band one.

> "This is the case I want you to look at. This person is at 46. He is not in
> the review band. A reactive system would not have flagged him at all."

Read the reason line.

> "Ten consecutive check-ins in the watch band, still climbing. That's one of
> four documented rules — and note the separation: **the model decides how
> worried to be, a rule a human can read decides when a human gets involved.**
> You can audit an escalation rule. You cannot audit a neural network's
> judgement about when to wake somebody up."

Switch to the **What to do** tab.

> "Ranked by measured effect — we literally re-ran his feature vector through
> the same ensemble with each intervention applied, and that number is what came
> back. Each one carries the evidence and, importantly, the rank that can
> authorise it. An intervention nobody has the authority to action is a nice
> paragraph, not a product."

Point at the combined plan. **Read the two figures off the screen** — they
differ per person.

> "All of them together comes to less than the individual effects sum to. The
> interventions act on overlapping pathways and the model captures that rather
> than double-counting it. We show both numbers."

Scroll to the attribution walk.

> "And this is local accuracy made visible — you can watch the bars carry you
> from the population baseline of 41.6 up to this person's index."

---

### 4 · The simulator — 60 seconds

Navigate to **What-if simulator**, target **p-014**.

Set duty **−3**, nights **−3**, rest days **7**, peer support **on**. Run.

> "68 to 52.6. Out of review, into watch. But the number isn't the interesting
> part — this is:"

Point at the attribution shift panel. **Read the top three off the screen** —
they will be night shifts, days since rest and cohesion.

> "The model is telling the commander *which lever did the work*, which is the
> difference between a prediction and a decision."

---

### 5 · The model card — 90 seconds *(where you win it)*

Sign in as **`cmd-001`** or **`adm-001`** → **Model card**.

> "Everything the evaluation found, published in the product — including the
> parts that don't flatter us."

Point at *Does the model earn its complexity*.

> "Three baselines. Self-report alone: 10.8 error. Linear on all features: 4.2.
> Our model: 3.87. And the honest reading is right there on the screen — against
> a linear model the gain is modest. The large gain is over asking people how
> they feel, which is exactly the argument for ingesting rosters and wearables
> instead of lengthening the questionnaire."

Point at the classifier block.

> "Recall 0.78, precision 0.40. We publish that. Roughly six in ten flags won't
> need escalation. That's deliberate — the threshold is tuned on F2, recall
> weighted four times precision, because an unnecessary welfare conversation
> costs an hour and a missed one can cost a life."

Point at calibration, then fairness.

> "Calibration, because ranking well isn't the same as being right about
> magnitude. And a fairness audit on three protected attributes — which are
> deliberately *not* model inputs, because exclusion isn't sufficient; disparity
> arrives through correlated operational features. All three pass the
> four-fifths rule."

Point at the provenance panel.

> "And this is the one that matters: the trained trees are exported to JSON and
> run by a TypeScript engine. `npm run ml:verify` asserts that engine reproduces
> scikit-learn to 1e-13 and that every SHAP explanation satisfies local
> accuracy. The model you just saw evaluated is provably the model serving these
> screens."

---

### 6 · Audit — 30 seconds

**Audit & privacy** → **Verify the chain**.

> "Every access, every refusal, every model run. Each entry commits to the hash
> of the one before it, so deleting or editing a record breaks verification for
> everything after it. A welfare system inevitably accumulates the power to look
> people up. The only real check on that is a record the powerful can't quietly
> edit."

If you denied yourself something earlier, point at the `ACCESS_DENIED` row.

---

## Judge Q&A — the hard questions

**"Is this actually a model, or hardcoded thresholds?"**
> Five gradient-boosted ensembles, 780 trees, trained in scikit-learn. The
> learned trees are exported to JSON — you can open `server/models/` and read
> them. `npm run ml:verify` proves the TypeScript runtime reproduces sklearn's
> own predictions to 1e-13. I can run it now.

**"Where did your training data come from?"**
> A structural causal simulator, and I'll be direct about why: no public dataset
> of forces welfare telemetry exists, and using real personnel records for a
> hackathon would be an ethics and DPDP violation. The simulator's effect
> directions come from published occupational-health literature — Van Dongen on
> sleep-debt dose-response, Folkard on circadian misalignment, Brailey on
> cohesion as a moderator. The pipeline is dataset-agnostic: point it at a real
> CAPF CSV with the same columns and it retrains with one command.

**"Synthetic data means you're just recovering your own generator."**
> Correct, and that's the honest limitation. What it does establish is that the
> *architecture* works: the feature engineering, the group-split evaluation, the
> explainability, the calibration, the fairness harness. Our MAE of 3.87 is
> within half a point of the irreducible noise floor we built into the
> generator, so the model is near the Bayes limit of that process. On real data
> we'd expect worse absolute numbers and the same relative ordering of the
> baselines.

**"Why gradient boosting and not deep learning?"**
> Twenty-five tabular features and, realistically, tens of thousands of rows in
> a pilot. Gradient boosting is the correct tool for that shape of data, and it
> is the only family with an *exact* SHAP algorithm — polynomial rather than
> sampled. For a system that has to justify itself to a commanding officer,
> exact beats approximate.

**"Why is precision only 0.40?"**
> Deliberate. We tune on F2, weighting recall four times precision, because the
> costs are asymmetric: an unnecessary welfare conversation costs an officer an
> hour; a missed deterioration can cost a life. We publish the number on the
> model card so nobody is surprised by it, and the officer's dismiss control
> records every time the model was wrong.

**"How do you stop this becoming a surveillance tool?"**
> Four ways, all architectural rather than promised. Command cannot fetch an
> individual record — enforced in middleware, and the refusal is logged.
> Aggregates below ten people are suppressed in the query layer. Command-facing
> identifiers are keyed HMAC pseudonyms, not reversible from a roster. And free
> text is stored for the assigned officer but is never a model input — we don't
> score what people write. Plus the audit chain, which anyone can verify.

**"What if someone lies on their check-in?"**
> They will, and the design assumes it. Self-report is two of twenty-five
> features, and the model card quantifies why: self-report alone gives 10.8
> error against 3.87 with roster and wearable signals. Under-reporting degrades
> the signal; it doesn't remove it. The check-in mostly earns its place as a
> consent surface and a way to ask for help directly.

**"What happens on bad conference wifi?"**
> Everything you've seen runs locally. There is no LLM on the critical path —
> Gemini is an optional enhancement over a retrieval layer that always returns
> the SOP text and citation. Zero native modules, so `npm install` cannot fail
> to compile. The live feed reconnects itself and replays anything missed.

**"How is this different from an EAP helpline or an annual survey?"**
> A helpline requires the person to raise their hand, which is exactly the
> mechanism stigma suppresses. An annual survey is a snapshot twelve months
> stale. SAHARA is continuous, it reads signals that already exist without
> asking anyone anything, and it predicts seven days ahead — which is the window
> in which a roster change or a rest day can still make a difference.

**"What would it take to deploy?"**
> A pilot in one unit: retrain on that unit's real HRMS data — same schema, one
> command — federate authentication to the force's existing identity provider,
> and have a named medical officer sign off on the band thresholds and the
> intervention playbook. The evaluation harness, fairness audit and calibration
> plots carry over unchanged.

**"Show me the code."**
> `server/ml/gbm.ts` is the inference engine and the exact TreeSHAP
> implementation — about 180 lines of path arithmetic from the Lundberg paper.
> `ml/train.py` is the training and evaluation. `server/cruds/repository.ts`
> holds the escalation rules, deliberately separate from the model.

---

## If something breaks on stage

| Symptom | Do this |
|---|---|
| Page won't load | `npm run dev` again; it rebinds in ~10 s |
| Data looks wrong | Sign in as `adm-001` → **Demo** → **Reset**. Deterministic; comes back identical |
| Live feed shows RECONNECTING | Ignore it and keep talking; it reconnects by itself and replays |
| A screen errors | Press `1`–`9` to jump elsewhere; the model card and audit screens have no dependencies on the others |
| Someone asks for something you didn't build | "Not built — here's what it would take," then name the effort. A precise no beats a vague yes |

**Keyboard:** `1`–`9` jump between screens, `?` shows the shortcut list.
