# SAHARA — Technical Architecture & Full-Stack Workflow

_AI-based predictive personnel stress and welfare monitoring for uniformed forces._
_Smart India Hackathon · Ministry of Home Affairs problem statement._

This document describes how SAHARA is built, from the browser to the SQLite
file, and how a single daily check-in travels through every layer. It is the
reference for anyone extending the system or evaluating it.

---

## 1. System at a glance

```
┌──────────────────────────────────────────────────────────────────────────┐
│  BROWSER  (React 19 · Vite 6 · Tailwind 4 · Motion · Recharts)          │
│  Landing → Login → Role-gated shell → 9 screens (hash-routed)           │
│  api/client.ts (fetch + Bearer token)      hooks.ts (useAsync, SSE)     │
└───────────────┬───────────────────────────────────────┬──────────────────┘
                │ HTTPS JSON  /api/*                    │ Server-Sent Events
┌───────────────▼───────────────────────────────────────▼──────────────────┐
│  NODE 22 · EXPRESS 4  (server/server.ts)                                 │
│  middleware: json → securityHeaders → identify → actor → route → errors │
│  core/      crypto (scrypt, HMAC-JWT) · audit (SHA-256 chain) · events  │
│  engines/   scoreLedger · suppression (k=10) · ragService (SOP + Gemini)│
│  ml/        engine (WRI, forecast, SHAP, what-if) · gbm (trees, TreeSHAP)│
│  cruds/     repository — every read/write, escalation rule, seeding     │
└───────────────┬──────────────────────────────┬───────────────────────────┘
                │ SQL (node:sqlite, WAL)       │ JSON artifact (read-once)
┌───────────────▼───────────────┐   ┌──────────▼────────────────────────────┐
│  .data/sahara.db  (11 tables) │   │  server/models/sahara-model-v2.json   │
│  users · checkins · assessments│   │  5 GBM ensembles · 780 trees · 25 feat │
│  cases · case_events · recs    │   │  produced offline by ml/train.py      │
│  audit_log · consent_ledger …  │   │  (scikit-learn) — no Python at runtime│
└───────────────────────────────┘   └───────────────────────────────────────┘
```

**One process serves everything.** In development Express mounts Vite as
middleware (HMR included); in production it serves the `dist/` bundle. There
is no separate frontend host, no reverse proxy, and no native module —
`npm install && npm run dev` is the entire setup.

---

## 2. Technology stack

| Layer | Choice | Why this and not the obvious alternative |
|---|---|---|
| UI framework | React 19 + TypeScript 5.8 | Function components, `useId`, concurrent rendering; strict types shared with the server via `src/types.ts`. |
| Build / dev server | Vite 6 (`@vitejs/plugin-react`, `@tailwindcss/vite`) | Sub-second HMR; mounted inside Express so one port serves API + UI. |
| Styling | Tailwind CSS 4 over a hand-written token layer (`src/index.css`) | Semantic tokens (`--paper`, `--ink`, `--signal-*`) drive both themes; utilities never carry raw hex. |
| Motion | `motion` (Framer Motion 12) | One shared vocabulary in `design/motion.ts`; every animation honours `prefers-reduced-motion`. |
| Charts | Recharts 3 | Composable SVG; all charts share one tooltip, axis and palette in `components/charts/Charts.tsx`. |
| Icons | lucide-react (+ a few inline SVGs) | Consistent 1.5px stroke family; no emoji as icons. |
| API server | Express 4 on Node 22 | Boring and reliable; the interesting work is in middleware and engines, not the framework. |
| Database | `node:sqlite` (built into Node 22.5+), WAL mode | Zero-compile; falls back to an in-memory shim that reports itself as degraded in `/api/health`. |
| Auth | scrypt password hashes; HMAC-SHA256 signed JWT (8 h) | Standard library only. A restart rotates the secret unless `SAHARA_SECRET` is set — safe default for welfare data. |
| Audit | SHA-256 hash chain in `audit_log` | Deleting or editing any row breaks verification for every later row (`/api/audit/verify`). |
| Realtime | Server-Sent Events (`/api/events`) | One-directional, proxy-friendly, auto-reconnecting; role-filtered per connection. |
| ML training | Python · scikit-learn · pandas · numpy (`ml/`) | Offline only. Exports learned tree structures to JSON. |
| ML runtime | TypeScript (`server/ml/gbm.ts`, `engine.ts`) | Real inference and exact TreeSHAP in ~320 µs; verified against the Python reference by `npm run ml:verify`. |
| LLM (optional) | `@google/genai` Gemini 2.0 Flash | Only for synthesising SOP retrieval into prose. Never on the critical path; the system is fully functional without a key. |
| Bundling (prod) | `vite build` + `esbuild` for the server | `npm run build` → `dist/`; `npm start` runs `node dist/server.js --production`. |

---

## 3. Repository layout

```
SIH/
├── index.html                 Vite entry
├── src/                       ── FRONTEND ──
│   ├── main.tsx               React root
│   ├── App.tsx                view state (landing/login/app), session restore, hash routing, hotkeys
│   ├── app/
│   │   ├── AppShell.tsx       rail + header, NAV table (screen → roles), ScreenIntro, skip link
│   │   └── hooks.ts           useAsync, useLiveEvents (SSE), useTheme, useHotkey
│   ├── api/client.ts          typed fetch wrapper; one method per endpoint
│   ├── design/
│   │   ├── primitives.tsx     Panel, Stat, Tabs, Button, BandBadge, Modal, BAND semantics …
│   │   └── motion.ts          ease, durations, stagger/rise variants
│   ├── components/
│   │   ├── charts/Charts.tsx  WelfareTrend, BandDistribution, Calibration, Confusion …
│   │   ├── charts/ScoreLedger.tsx  week/month daily-score ledger
│   │   └── explain/Explainability.tsx  RiskDial, ShapWaterfall, DriverList, CategoryBreakdown
│   ├── screens/               one file per screen (Landing, Login, Checkin, MyWelfare, Casework,
│   │                          Interventions, Force, Units, Simulator, Model, Audit)
│   ├── types.ts               DTOs shared with the server
│   └── index.css              design tokens (light + dark), base layer, component classes
├── server/                    ── BACKEND ──
│   ├── server.ts              Express app, all routes, Vite/static mounting
│   ├── middleware/index.ts    identify, requireAuth, requireRole, rateLimit, errorHandler …
│   ├── core/                  crypto.ts · audit.ts · events.ts · validate.ts
│   ├── cruds/repository.ts    the data layer: SQL, seeding, scoring, escalation rule, cases
│   ├── db/database.ts         schema (11 tables), WAL pragmas, memory fallback
│   ├── engines/               scoreLedger.ts · suppressionEngine.ts · ragService.ts
│   ├── ml/                    engine.ts · gbm.ts · interventions.ts · verify.ts · types.ts
│   ├── models/sahara-model-v2.json   the trained artifact
│   └── data/                  seedData.ts · forceData.ts (synthetic roster)
├── ml/                        ── TRAINING (offline) ──
│   ├── generate_dataset.py    structural causal simulator → cohort CSV
│   ├── train.py               5 gradient-boosted ensembles → JSON export + metrics
│   └── artifacts/             metrics.json · reference_predictions.json
└── docs/                      PRD · implementation plan · demo script · this file
```

---

## 4. Frontend architecture

### 4.1 Application state (`App.tsx`)

Three top-level states, no router library:

| State | Type | Purpose |
|---|---|---|
| `view` | `'landing' \| 'login' \| 'app'` | Which shell is mounted. |
| `user` | `UserProfile \| null` | Set after `/api/auth/login` or a restored session (`sessionStorage.sahara-session` → `/api/me`). |
| `screen` | `ScreenId` | Active screen inside the app; seeded from the URL hash on first render. |

**Hash routing.** `#/<screen>` is two-way synced. On entry the hash is checked
against `navForRole(user.role)` — a hand-edited `#/force` cannot put a
constable on the command dashboard (the server would refuse the data anyway).
A reload on a deep link keeps its place; an invalid one falls back to the
role's home screen (`DEFAULT_SCREEN`).

### 4.2 Role → screen matrix (`NAV` in `AppShell.tsx`)

| Screen | personnel | welfare_officer | command_viewer | admin / demo_operator |
|---|:-:|:-:|:-:|:-:|
| Daily check-in | ● | ● | ● | ● |
| My welfare | ● | ● | ● | ● |
| Casework | | ● | | ● |
| Interventions | | ● | | ● |
| Force overview | | | ● | ● |
| Unit intelligence | | | ● | ● |
| What-if simulator | | ● | ● | ● |
| Model card | | ● | ● | ● |
| Audit & privacy | ● | ● | ● | ● |

### 4.3 Data access

`api/client.ts` is a single class: one `request<T>()` that attaches the Bearer
token (and the legacy `X-User-Id` for the demo console), parses the JSON
envelope `{ success, ... }`, and throws typed errors. Screens call it through
`useAsync(fn, deps)` which returns `{ data, loading, error, refetch }` — so
every screen has the same skeleton → content → error-note lifecycle.

`useLiveEvents(types, { enabled })` opens `EventSource('/api/events')` and
exposes the latest event and a `connected` flag; command screens refetch on
`alert.raised` instead of polling.

### 4.4 Design system

- **Tokens** in `index.css`: paper/ink neutrals, three *status* colours
  (routine `<40`, watch `40–64`, review `≥65`) that are never reused as chart
  series, five categorical `--viz-*` hues, a blue forecast slot, elevation
  (`--elev-1..3`, `--elev-surface`), radii, three type families.
- **Themes**: full light palette on `:root`, dark palette on `.dark`; every
  component reads tokens, so both themes are first-class.
- **Depth**: `Panel` uses `.surface` — a hairline of light along the top edge,
  a contact shadow and a soft ambient shadow. The `RiskDial` casts a real drop
  shadow onto a debossed track. The landing "live" card tilts ≤4° toward the
  pointer (mouse only, off under reduced motion). This is the *Soft UI
  Evolution* treatment appropriate to a health/government product — depth
  without plastic.
- **Accessibility**: 3px focus ring, skip link to `#main`, tabular numerals
  everywhere a figure can change, band communicated by label + position + colour.

### 4.5 Screens

| Screen | Data | Notable components |
|---|---|---|
| Landing | `/api/command/force-overview`, `/api/model/health` | Live figures, `TiltCard`, `BandDistribution` |
| Login | `/api/auth/login` | Persona picker fills the form; auth still enforced server-side |
| Daily check-in | `POST /api/checkins` | Five inputs → immediate assessment + explanation |
| My welfare | `/api/me/trends`, `/api/me/scores`, `/api/consent/ledger` | `RiskDial`, `WelfareTrend`, **`ScoreLedger`** (week/month), `ShapWaterfall`, consent record |
| Casework | `/api/cases`, `/api/cases/:id`, `/api/personnel/dossier/:id` | Case timeline, recommendations review |
| Interventions | `/api/interventions`, `POST …/action` | Ranked by modelled effect |
| Force overview | `/api/command/summary`, `/api/command/force-overview` | Aggregates only; pseudonyms |
| Unit intelligence | `/api/units/intelligence` | k-anonymity suppression (k=10) |
| What-if simulator | `POST /api/simulator/what-if` | Counterfactual re-scoring through the same model |
| Model card | `/api/model/health`, `/card`, `/drift` | Calibration, confusion matrix, fairness slices, PSI |
| Audit & privacy | `/api/audit/logs`, `/api/audit/verify` | Hash-chain verification |

---

## 5. Backend architecture

### 5.1 Request pipeline

```
express.json(1 MB) → securityHeaders → identify → resolve actor from DB
  → [rateLimit] → [requireAuth] → [requireRole] → handler → JSON envelope
  → notFound('/api') → errorHandler (HttpError / ValidationError → status + code)
```

- **identify** reads `Authorization: Bearer <jwt>`; verifies the HMAC, sets
  `req.actor = { id, role, unitId }`. Also honours legacy `X-User-Id` for the
  demo console. Unknown/expired tokens simply leave `req.actor` empty.
- **requireAuth / requireRole(...)** — 401 / 403 with audit entries on refusal.
- **requireSelfOrAssignedOfficer** — dossier access only for the person or
  their assigned welfare officer.
- **rateLimit** — token bucket per key (login 8/…, register 5/…, check-ins
  20/…, explain 30/s).
- **validate.parse(schema)** — declarative body validation; failures are 400
  with the offending field.

### 5.2 Identity & crypto (`core/crypto.ts`)

- Passwords: `scrypt` (N=16384, r=8, p=1), NFKC-normalised, per-user salt,
  constant-time compare.
- Tokens: header.payload.signature, HMAC-SHA256, 8 h TTL, `jti` for revocation
  hooks. Secret from `SAHARA_SECRET` or random per process.
- Pseudonyms: HMAC(userId, `SAHARA_PSEUDONYM_KEY`) — stable tokens shown to
  command roles instead of identities.

### 5.3 Audit chain (`core/audit.ts`)

Every sensitive action (`LOGIN_*`, `CHECKIN_SUBMITTED`, `CASE_VIEWED`,
`DOSSIER_ACCESSED`, `INTERVENTION_ACTIONED`, `DATABASE_SEEDED`, …) appends a row
whose `hash = SHA256(prev_hash ‖ id ‖ timestamp ‖ actor ‖ action ‖ resource ‖
justification ‖ privacy_filter)`. `GET /api/audit/verify` walks the chain and
reports the first broken sequence number.

### 5.4 Event hub (`core/events.ts`)

In-memory subscriber list keyed by connection; each client carries its role
and unit so `assessment.created` payloads reach command roles as pseudonym +
unit only. Heartbeats every 25 s keep proxies from closing the stream.

### 5.5 Engines

| Engine | Responsibility |
|---|---|
| `ml/engine.ts` | `assess(features)` → WRI, 80 % interval (q10/q90), 7-day forecast, escalation probability, exact SHAP per feature, category breakdown, coverage/imputation; `simulate(levers)` for counterfactuals; `computePSI` for drift. |
| `ml/gbm.ts` | Tree traversal for prediction; **TreeSHAP** (Lundberg's polynomial algorithm) over the exported trees. |
| `ml/interventions.ts` | Playbook of levers (rest day, break night-shift run, sanction leave, peer support…) with SOP citation; `recommend()` ranks by modelled reduction, `combinedPlan()` re-scores the combination and reports interaction (not naïve sum). |
| `engines/scoreLedger.ts` | Monday-anchored weekly and calendar-monthly roll-ups of the individual's assessments: mean/min/max, delta vs prior period, band-days, mean sleep/duty/stress, peak day, current streak. |
| `engines/suppressionEngine.ts` | Cohort k-anonymity: any unit with fewer than 10 personnel returns `isSuppressed: true` with sensitive metrics zeroed. |
| `engines/ragService.ts` | Keyword/category retrieval over the SOP knowledge base (SOP-WEL-01…); optional Gemini synthesis, always with citations, always degrading to retrieval-only. |

### 5.6 The escalation rule (documented, not learned)

`repository.escalationTrigger()` runs after every scored check-in:

1. `DIRECT_REQUEST` — the person ticked "I'd like support".
2. `CONSECUTIVE_ELEVATED` — last **2** assessments ≥ 65 (review).
3. `PREDICTED_ESCALATION` — today below review but the 7-day forecast is in review.
4. `SUSTAINED_WATCH` — **10** consecutive days ≥ 40 with a rising trajectory.

A trigger upserts a `cases` row for the assigned welfare officer, writes a
`case_events` entry, generates `recommendations`, emits `case.opened` /
`alert.raised`, and audits the whole thing.

---

## 6. API surface

All responses are JSON `{ success: boolean, ... }`; errors are
`{ success:false, code, error }`.

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /api/auth/login` | rate-limited | scrypt verify → signed token; audited either way |
| `GET /api/me` | token | Current profile |
| `GET /api/users` | — | Demo persona list |
| `POST /api/register` | rate-limited | Create personnel account |
| `POST /api/consent` · `GET /api/consent/ledger` | self | Append-only consent record (DPDP) |
| `POST /api/checkins` | self, rate-limited | Submit daily check-in → assessment (see §7) |
| `GET /api/me/trends` | self | Daily history + latest full assessment detail |
| `GET /api/me/scores` | self | **Weekly & monthly roll-ups + streak** (score ledger) |
| `GET /api/cases` · `GET /api/cases/:id` · `POST /api/cases/:id/events` | officer/admin | Casework; every view audited |
| `POST /api/cases/:id/recommendations/:rid/review` | officer/admin | Accept / decline a recommendation with note |
| `GET /api/command/summary` · `GET /api/command/force-overview` | command/admin | Aggregates & escalation velocity — pseudonyms only |
| `GET /api/units/intelligence` | command/admin | Per-unit metrics with k=10 suppression |
| `GET /api/personnel/dossier/:id` · `GET /api/personnel/:id/risk-profile` | self or assigned officer | Full explanation, history, plan |
| `GET /api/interventions` · `POST /api/interventions/:id/action` | officer/admin | Ranked levers; actioning is audited + streamed |
| `POST /api/simulator/what-if` | officer/command/admin | Counterfactual re-score through the same ensembles |
| `GET /api/model/health` · `/card` · `/drift` · `POST /api/model/explain` | — / rate-limited | Metrics, model card, PSI drift, ad-hoc SHAP |
| `GET /api/audit/logs` · `POST /api/audit/log` · `GET /api/audit/verify` | role-scoped | Read chain, add justification entry, verify integrity |
| `GET /api/events` | token (SSE) | Live stream, role-filtered |
| `POST /api/hr-import` | officer/admin | Ingest HRMS context (duty hours, leave, deployment) |
| `POST /api/system/reset` | admin | Re-seed the demo database |
| `GET /api/health` | — | Uptime, storage engine, model version, Gemini status |
| `POST /api/rag/query` · `POST /api/rag/recommend-interventions` | — | SOP retrieval (+ optional LLM synthesis) |

---

## 7. Data model (`server/db/database.ts`)

```
users ─┬─< checkins ──< assessments          consent_ledger >── users
       ├─< cases ─┬─< case_events             personnel_context ── users
       │          └─< recommendations         interventions (JSON payload)
       └─ assigned_officer_id → users         audit_log (hash-chained, append-only)
                                              meta (key/value: seed version, schema)
```

| Table | Key columns | Notes |
|---|---|---|
| `users` | id, name, alias, role, unit_id, rank, assigned_officer_id, has_consented, password_hash | Roles: personnel · welfare_officer · command_viewer · admin · demo_operator |
| `checkins` | id, user_id, date, sleep_hours, perceived_stress, perceived_fatigue, duty_hours, night_shift, support_requested, notes | `UNIQUE(user_id, date)` — resubmitting a day upserts |
| `assessments` | id, checkin_id, user_id, date, idx, band, coverage, forecast_value, model_version, payload(JSON) | `payload` holds the complete `Assessment` (SHAP, interval, drivers) |
| `cases` | id, personnel_id, personnel_alias, unit_id, assigned_officer_id, status, reason, due_at, latest_index, latest_band, consecutive_alert_days | One open case per person; `reason` is the trigger name |
| `case_events` | case_id, actor_id, action, concise_note, timestamp | Officer timeline |
| `recommendations` | case_id, trigger_facts, rule_version, proposed_action, review_status, reviewer_note | Evidence attached to each proposal |
| `audit_log` | seq, id, timestamp, actor_*, action, resource, justification, privacy_filter, prev_hash, hash | Tamper-evident |
| `consent_ledger` | user_id, granted, scope, policy_version, timestamp | Append-only by design |
| `interventions` | id, payload(JSON), updated_at | Ranked lever list with status |
| `personnel_context` | user_id, payload(JSON), source, updated_at | HRMS/wearable-derived features the daily check-in cannot ask for |
| `meta` | key, value | Seed/schema versions |

Storage: `./.data/sahara.db` (override with `SAHARA_DB`), `PRAGMA journal_mode=WAL`,
`foreign_keys=ON`. First boot seeds a synthetic roster, scores 14 days of history
through the real model, then runs the escalation rule to produce the initial casework.

---

## 8. Machine-learning pipeline

```
ml/generate_dataset.py            ml/train.py                         server/ml/
 structural causal simulator  →   5 × GradientBoosting (sklearn)  →   sahara-model-v2.json
 sleep debt · night shifts        wri, wri_7d, escalation,            feature_order (25)
 HRV · cohesion · leave denial    wri_q10, wri_q90 (80 % PI)          trees + base values
 grounded in occupational-        group split by personnel_id         training means, bins
 health literature                calibration · fairness slices  →    metrics.json (model card)
                                                                  ↓
                                              server/ml/gbm.ts  predict · TreeSHAP
                                              server/ml/engine.ts assess · simulate · drift
                                              npm run ml:verify  parity vs Python ≤ 1e-13
```

- **25 features** across sleep, duty schedule, operational tempo, physiology,
  social factors and self-report. Missing features are imputed from the training
  mean and lower the assessment's `coverage`, which the UI shows.
- **Bands**: routine `<40`, watch `40–64`, review `≥65` — identical constants in
  Python, the TypeScript engine and the design system's `bandOf()`.
- **Explanation**: exact TreeSHAP on every prediction; `E[f] + Σφ = f(x)` is
  verified to ~1e-14. Copy shown to users is generated *from the attributions*,
  never from a switch on the band.
- **Interval**: quantile regressors (α = 0.10 / 0.90) → genuine 80 % prediction
  interval, empirical coverage 79.5 %.
- **Latency**: predict ≈ 8 µs, full SHAP explain ≈ 320 µs — well inside a
  synchronous request.

---

## 9. End-to-end workflows

### 9.1 Sign-in

```
Browser                         Server                              DB
  │ POST /api/auth/login ─────────▶ rateLimit → parse → repository.authenticate
  │                                 scrypt verify ────────────────────▶ users
  │                                 audit LOGIN_SUCCESS|FAILED ───────▶ audit_log
  │ ◀── { token, user } ─────────── signToken(HMAC, 8 h)
  │ sessionStorage.sahara-session
  │ setUser → setScreen(hash ∨ DEFAULT_SCREEN[role]) → view='app'
  │ EventSource /api/events (Bearer) ─▶ events.subscribe(role, unit)
```

### 9.2 Daily check-in → assessment → case → alert

```
Checkin screen ── POST /api/checkins {date, sleepHours, perceivedStress, perceivedFatigue,
                                       dutyHours, nightShift, supportRequested, notes}
  → requireConsent (403 if not granted)
  → transaction:
      INSERT checkins (upsert on user_id+date)
      featuresFor(user, input)      ← 7-day history + personnel_context (HRMS/wearable)
      engine.assess(features)       ← WRI, interval, 7-day forecast, P(escalation), SHAP
      INSERT assessments (payload = full explanation)
      escalationTrigger()           ← DIRECT_REQUEST | CONSECUTIVE_ELEVATED |
                                      PREDICTED_ESCALATION | SUSTAINED_WATCH | null
      if trigger: upsertCase → case_events → recommendations
  → audit CHECKIN_SUBMITTED
  → emit assessment.created { pseudonym, unit, wri, band, forecast }   (SSE)
  → emit case.opened / alert.raised                                     (SSE, officer + command)
  ← { assessment, message }  → screen shows dial + drivers immediately
Welfare officer's Casework screen refetches on alert.raised; Command's Force overview
increments escalation velocity — both see a pseudonym, never a name.
```

### 9.3 "My welfare" page load

```
MyWelfareScreen mounts
  ├─ GET /api/me/trends   → history[] (index, band, forecast, sleep, duty, stress) + detail
  ├─ GET /api/me/scores   → weeks[], months[], currentStreak   (engines/scoreLedger)
  └─ GET /api/consent/ledger
RiskDial(detail) · WelfareTrend(history) · ScoreLedger(history, summaries)
  ScoreLedger: Week view (7 cells: score, Δ vs yesterday, sleep/duty/stress) or
               Month view (calendar, band-tinted, today ringed); summary strip uses the
               server roll-up for the visible period and falls back to a local mean if absent.
ShapWaterfall(baseValue, drivers, protectiveFactors) · CategoryBreakdown · DriverList
```

### 9.4 What-if simulation

```
Simulator → POST /api/simulator/what-if { personnelId, levers: [{ key, value }] }
  → requireRole(officer|command|admin) → current features → apply levers
  → engine.simulate: re-score through the same ensembles → Δ WRI, Δ forecast, new band
  → audit SIMULATION_RUN  ← { baseline, projected, perLever[], combined, interactionNote }
```

### 9.5 Command aggregates

```
Force overview → GET /api/command/force-overview
  repository.forceOverview(): latest assessment per person → counts per band, unit rows
  suppressionEngine.evaluateCohortSuppression(unit) → isSuppressed if n < 10
  pseudonymFor(userId) on anything person-shaped → never a name or id to command roles
  audit COMMAND_VIEW
```

### 9.6 Audit verification

```
Audit screen → GET /api/audit/verify
  walk audit_log by seq: recompute hash(prev_hash, fields) === stored hash
  ← { ok, length, firstBrokenSeq | null }
```

---

## 10. Developer & deployment workflow

```bash
npm install                  # no native modules; nothing to compile
npm run dev                  # tsx server/server.ts — Express + Vite middleware on :3000
npm run lint                 # tsc --noEmit (frontend + server share one tsconfig)
npm run ml:verify            # runtime parity + SHAP local accuracy + latency budget
npm run build                # vite build → dist/ ; esbuild server → dist/server.js
npm start                    # node dist/server.js --production (serves dist/ statically)
npm run ml:all               # (optional, needs Python) regenerate cohort → retrain → verify
npm run clean                # rm -rf dist .data   (fresh DB is re-seeded on next boot)
```

Environment (all optional — see `.env.example`):

| Variable | Effect |
|---|---|
| `PORT` | Listen port (default 3000) |
| `SAHARA_SECRET` | Stable token-signing secret; unset ⇒ random per process |
| `SAHARA_PSEUDONYM_KEY` | Key for command-side pseudonyms |
| `SAHARA_DB` | SQLite path (default `./.data/sahara.db`) |
| `SAHARA_MODEL` | Path to the model artifact |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Enables LLM synthesis over SOP retrieval |

Demo accounts (password `sahara`): `p-014` personnel · `wo-001` welfare officer ·
`cmd-001` command · `adm-001` administrator.

---

## 11. Security & privacy posture

- **Least visibility by role** — command roles receive aggregates and HMAC
  pseudonyms; officers see only their assigned cases; a person sees only themselves.
- **k-anonymity** — units under 10 personnel are suppressed in every aggregate.
- **Consent gate** — no check-in is scored without a granted consent scope; the
  ledger is append-only so past processing stays auditable (DPDP Act).
- **Tamper-evident audit** — hash chain, verifiable from the UI.
- **No LLM on the critical path** — scoring, explanation and escalation are
  deterministic and reproducible; Gemini only paraphrases cited SOP text.
- **Synthetic data only** — every record is generated by the causal simulator;
  the pipeline is schema-compatible with a real CAPF HRMS + wearable feed.
- **Transport & headers** — `securityHeaders` sets CSP-friendly defaults,
  `x-powered-by` disabled, 1 MB body limit, per-route token buckets.

---

## 12. Recent changes (this iteration)

- **Score ledger** on *My welfare*: week view (Mon–Sun cells with index, day-on-day
  delta, sleep/duty/stress) and month view (band-tinted calendar), with a summary
  strip (average, days by band, mean sleep, mean duty, peak day).
- **`GET /api/me/scores`** + `engines/scoreLedger.ts`: server-side weekly/monthly
  roll-ups and current streak; the UI treats it as the figure of record.
- **Depth pass**: `--elev-surface` layered shadows with top-edge sheen on every
  `Panel`; `RiskDial` drop shadow, debossed track, band-coloured glow and arc sheen;
  pointer-follow `TiltCard` on the landing live panel.
- **Accessibility**: 3 px focus ring, skip-to-content link, larger nav hit areas.
- **Routing fix**: deep links (`#/my-welfare`) survive a reload with a stored session.
