# ---------------------------------------------------------------- SLIDE 3
import math
s = S[2]
set_title(s, "TECHNICAL APPROACH"); set_oval(s, TEAM_NAME); drop_shape(s, "TextBox 8")
text(s, 2.0, 1.1, 9.33, 0.3, [dict(t="System architecture & technology stack", size=13, italic=True, color=MUTED, align=PP_ALIGN.CENTER)])

SPOKE = ["2E6FD9", "E8772E", "0E7C7B", "3DA35D", "7B4FBF", "D9463E"]
HX, HY, RD = 4.9, 4.05, 3.0
spokes = [
    ("sp_ui",     "Frontend & Role-gated UI",   "React 19 + Vite dashboard — 9 screens: daily check-in, my welfare, casework, force view, what-if simulator, model card"),
    ("sp_api",    "Secure API & Identity",       "Express 4 on Node 22; scrypt + HMAC-JWT; RBAC for personnel / welfare officer / command / admin; per-route rate limits"),
    ("sp_ml",     "ML Risk Engine",              "5 gradient-boosted ensembles on 25 features → Welfare Risk Index 0–100, 7-day forecast, P(escalation in 14 d)"),
    ("sp_db",     "Data & Consent Layer",        "node:sqlite, 11 tables; append-only consent ledger (DPDP); HRMS import + 5-question daily check-in + opt-in wearables"),
    ("sp_shap",   "Explainability & Escalation", "Exact TreeSHAP on every score (~320 µs); 80 % prediction interval; 4 documented rules open a case — not a black box"),
    ("sp_shield", "Privacy, Audit & Alerts",     "HMAC pseudonyms; k = 10 suppression; SHA-256 hash-chained audit; live SSE alerts to the assigned welfare officer"),
]
angles = [330, 270, 210, 30, 90, 150]      # clockwise from 12 o'clock
rows_y = [1.5, 3.1, 4.7]
row_h = 1.35
# connectors first (behind everything)
for i, a in enumerate(angles):
    r = RD/2 - 0.3
    ix, iy = HX + r*math.sin(math.radians(a)), HY - r*math.cos(math.radians(a))
    ry = rows_y[i % 3] + 0.55
    if i < 3:
        line(s, 3.2, ry, ix, iy, SPOKE[i], 1.25)
        oval(s, 3.2 - 0.05, ry - 0.05, 0.1, SPOKE[i])
    else:
        line(s, 6.6, ry, ix, iy, SPOKE[i], 1.25)
        oval(s, 6.6 - 0.05, ry - 0.05, 0.1, SPOKE[i])
# ring + hub
icon(s, "ring", HX - RD/2, HY - RD/2, RD)
text(s, HX - 0.85, HY - 0.4, 1.7, 0.8, [dict(t="SYSTEM\nARCHITECTURE", size=11.5, bold=True, color=NAVY, align=PP_ALIGN.CENTER, line=1.0)], anchor=MSO_ANCHOR.MIDDLE)
for i, a in enumerate(angles):
    r = RD/2 - 0.3
    ix, iy = HX + r*math.sin(math.radians(a)), HY - r*math.cos(math.radians(a))
    oval(s, ix - 0.33, iy - 0.33, 0.66, WHITE)
    icon_circle(s, spokes[i][0], ix, iy, 0.54, SPOKE[i], 0.5)
# numbered items
for i, (ic, t1, t2) in enumerate(spokes):
    y = rows_y[i % 3]
    if i < 3:
        x, w, al = 0.4, 2.75, PP_ALIGN.RIGHT
    else:
        x, w, al = 6.6, 2.85, PP_ALIGN.LEFT
    text(s, x, y, w, row_h, [
        dict(t=str(i+1), size=24, bold=True, color=SPOKE[i], align=al, line=0.9, after=0),
        dict(t=t1, size=11.5, bold=True, color=NAVY, align=al, after=2),
        dict(t=t2, size=8.5, color=TEXT, align=al, line=1.0),
    ])
# verified-model strip
rrect(s, 0.4, 6.08, 9.0, 0.72, LIGHT, radius=0.1)
text(s, 0.5, 6.1, 2.2, 0.68, [dict(t="VERIFIED MODEL", size=9.5, bold=True, color=NAVY, after=1),
                              dict(t="held-out, split by individual · npm run ml:verify", size=7.5, color=MUTED)], anchor=MSO_ANCHOR.MIDDLE)
metrics = [("3.87", "WRI MAE"), ("90.3 %", "band accuracy"), ("0.812", "escalation ROC-AUC"), ("0.78", "recall (F2-tuned)"), ("79.5 %", "80 % PI coverage"), ("≤ 1e-13", "TS ↔ Python parity")]
mx = 2.7; mw = 1.1
for j, (v, l) in enumerate(metrics):
    text(s, mx + j*mw, 6.1, mw, 0.68, [dict(t=v, size=12, bold=True, color=TEAL, align=PP_ALIGN.CENTER, after=0),
                                       dict(t=l, size=7.5, color=MUTED, align=PP_ALIGN.CENTER)], anchor=MSO_ANCHOR.MIDDLE)
# right panel — core technology flow
PX, PY, PW, PH = 9.65, 1.3, 3.3, 5.5
rrect(s, PX, PY, PW, PH, LIGHT, radius=0.05)
text(s, PX, PY + 0.08, PW, 0.3, [dict(t="SAHARA – Core Technology Flow", size=11, bold=True, color=NAVY, align=PP_ALIGN.CENTER)])
techrows = [
    ("ly_front",   "Frontend",       [("b_react", "React 19 + TypeScript 5.8"), ("b_vite", "Vite 6 · Tailwind CSS 4")]),
    ("ly_chart",   "UI & Charts",    [("b_framer", "Motion 12 (reduced-motion aware)"), ("b_chart", "Recharts 3 · CVD-safe palette")]),
    ("ly_back",    "Backend",        [("b_node", "Node 22 · Express 4"), ("b_sse", "SSE live events · rate limits")]),
    ("ly_train",   "ML Training",    [("b_python", "Python · scikit-learn"), ("b_pandas", "pandas · numpy (offline only)")]),
    ("ly_runtime", "ML Runtime",     [("b_ts", "TypeScript GBM inference"), ("b_shap", "Exact TreeSHAP ≈ 320 µs")]),
    ("ly_db",      "Database",       [("b_sqlite", "node:sqlite (WAL) · 11 tables"), ("b_hash", "SHA-256 hash-chained audit")]),
    ("ly_sec",     "Security",       [("b_jwt", "scrypt · HMAC-JWT · RBAC"), ("b_key", "HMAC pseudonyms · k = 10")]),
    ("ly_llm",     "LLM (optional)", [("b_gemini", "Gemini 2.0 Flash over SOP RAG")]),
    ("ly_deploy",  "Build & Deploy", [("b_esbuild", "Vite + esbuild → one Node process"), ("b_docker", "Docker · on-prem / NIC MeghRaj")]),
]
ry = PY + 0.45; rh = 0.55
for k, (lic, lab, techs) in enumerate(techrows):
    if k > 0:
        line(s, PX + 0.12, ry - 0.02, PX + PW - 0.12, ry - 0.02, LINE, 0.5)
    icon(s, lic, PX + 0.12, ry + 0.15, 0.22)
    text(s, PX + 0.38, ry, 1.05, rh, [dict(t=lab, size=8.5, bold=True, color=NAVY, line=1.0)], anchor=MSO_ANCHOR.MIDDLE)
    n = len(techs)
    for j, (bic, t) in enumerate(techs):
        ty = ry + (rh/2 - 0.12) if n == 1 else ry + 0.05 + j*0.25
        icon(s, bic, PX + 1.45, ty + 0.02, 0.18)
        text(s, PX + 1.68, ty - 0.02, PW - 1.75, 0.26, [dict(t=t, size=7.5, color=TEXT)], anchor=MSO_ANCHOR.MIDDLE)
    ry += rh

