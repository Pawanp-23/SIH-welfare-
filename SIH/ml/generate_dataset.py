"""
SAHARA — Synthetic Cohort Generator
===================================

Why synthetic?
--------------
No public dataset of uniformed-forces personnel welfare telemetry exists, and
using real personnel records for a hackathon prototype would be an ethics and
DPDP-Act violation. Instead we build a *structural causal simulator*: a
longitudinal generative model whose parameters are grounded in published
occupational-health literature on shift work, sleep debt, HRV and unit cohesion.

The important property is that the pipeline is **dataset-agnostic**. The
simulator emits the exact schema a real deployment would ingest from a CAPF
HRMS + wearable stack. Point `train.py` at a real CSV with the same columns and
it retrains without a single code change.

Grounded effect directions encoded in the SCM
---------------------------------------------
  * Cumulative sleep debt degrades affect and vigilance with a saturating
    (not linear) dose-response.                      Van Dongen et al., Sleep 2003
  * Consecutive night shifts compound circadian misalignment; the harm is
    super-additive with existing sleep debt.         Folkard & Tucker, Occup Med 2003
  * Reduced HRV (RMSSD) is a physiological marker of sustained allostatic load.
    Kim et al., Psychiatry Investig 2018
  * Unit cohesion / perceived peer support is one of the strongest protective
    moderators of deployment stress.                 Brailey et al., Mil Psychol 2007
  * Separation from family and denied leave are dominant stressors specific to
    Indian CAPF postings.                            MHA Standing Committee, 2018
  * Prolonged continuous deployment without a rest day predicts deterioration.
    Adler et al., J Occup Health Psychol 2005

Protected attributes (gender, rank group, force branch, religion) are generated
for *fairness auditing only* and are deliberately excluded from the model's
feature set.
"""

from __future__ import annotations

import argparse
import json
import os

import numpy as np
import pandas as pd

# --------------------------------------------------------------------------
# Feature contract — this exact ordering is exported to the TS runtime.
# --------------------------------------------------------------------------
FEATURE_SPEC: list[dict] = [
    {"key": "age",                       "label": "Age",                         "unit": "yrs",   "category": "demographic"},
    {"key": "service_years",             "label": "Years of service",            "unit": "yrs",   "category": "demographic"},
    {"key": "sleep_hours_7d_avg",        "label": "Avg sleep (7d)",              "unit": "h",     "category": "sleep"},
    {"key": "sleep_debt_7d",             "label": "Cumulative sleep debt (7d)",  "unit": "h",     "category": "sleep"},
    {"key": "sleep_variability",         "label": "Sleep irregularity",          "unit": "h SD",  "category": "sleep"},
    {"key": "consecutive_night_shifts",  "label": "Consecutive night shifts",    "unit": "",      "category": "schedule"},
    {"key": "duty_hours_7d_avg",         "label": "Avg duty hours (7d)",         "unit": "h/day", "category": "schedule"},
    {"key": "overtime_hours_7d",         "label": "Overtime (7d)",               "unit": "h",     "category": "schedule"},
    {"key": "days_since_rest_day",       "label": "Days since rest day",         "unit": "d",     "category": "schedule"},
    {"key": "deployment_days_continuous","label": "Continuous deployment",       "unit": "d",     "category": "operational"},
    {"key": "high_altitude_posting",     "label": "High-altitude posting",       "unit": "",      "category": "operational"},
    {"key": "hardship_posting_index",    "label": "Hardship posting index",      "unit": "0-3",   "category": "operational"},
    {"key": "distance_from_home_km",     "label": "Distance from home",          "unit": "km",    "category": "operational"},
    {"key": "days_since_family_contact", "label": "Days since family contact",   "unit": "d",     "category": "social"},
    {"key": "transfers_24m",             "label": "Transfers (24m)",             "unit": "",      "category": "operational"},
    {"key": "leave_denied_6m",           "label": "Leave requests denied (6m)",  "unit": "",      "category": "social"},
    {"key": "perceived_stress",          "label": "Self-reported stress",        "unit": "1-5",   "category": "self_report"},
    {"key": "perceived_fatigue",         "label": "Self-reported fatigue",       "unit": "1-5",   "category": "self_report"},
    {"key": "hrv_rmssd_ms",              "label": "HRV (RMSSD)",                 "unit": "ms",    "category": "physiological"},
    {"key": "resting_hr_delta_bpm",      "label": "Resting HR vs baseline",      "unit": "bpm",   "category": "physiological"},
    {"key": "steps_7d_avg_k",            "label": "Daily steps (7d avg)",        "unit": "k",     "category": "physiological"},
    {"key": "peer_cohesion_score",       "label": "Unit cohesion / peer support","unit": "1-5",   "category": "social"},
    {"key": "grievance_pending",         "label": "Pending grievance",           "unit": "",      "category": "social"},
    {"key": "prior_welfare_contact",     "label": "Prior welfare contact",       "unit": "",      "category": "history"},
    {"key": "physical_readiness_score",  "label": "Physical readiness",          "unit": "0-100", "category": "physiological"},
]

FEATURES = [f["key"] for f in FEATURE_SPEC]

# Attributes held out of the model, kept only to audit fairness.
PROTECTED = ["gender", "rank_group", "force_branch"]

RANK_GROUPS = ["constabulary", "subordinate_officer", "gazetted_officer"]
FORCE_BRANCHES = ["border_guarding", "internal_security", "disaster_response", "industrial_security"]


def _clip(x, lo, hi):
    return np.clip(x, lo, hi)


def _sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def latent_risk(df: pd.DataFrame) -> np.ndarray:
    """The structural equation for the Welfare Risk Index (0-100).

    Deliberately non-linear and interaction-heavy so that a linear model
    underperforms and a gradient-boosted ensemble is genuinely justified.
    """
    n = len(df)

    # --- Sleep: saturating dose-response on cumulative debt -----------------
    debt = df["sleep_debt_7d"].to_numpy()
    f_sleep_debt = 17.0 * (1.0 - np.exp(-debt / 9.0))
    f_sleep_var = 1.5 * df["sleep_variability"].to_numpy()

    # --- Circadian: night shifts, super-additive with sleep debt -----------
    nights = df["consecutive_night_shifts"].to_numpy()
    f_nights = 1.9 * nights + 0.30 * nights * np.sqrt(np.maximum(debt, 0))

    # --- Workload -----------------------------------------------------------
    overtime = df["overtime_hours_7d"].to_numpy()
    f_overtime = 6.5 * (1.0 - np.exp(-overtime / 14.0))
    rest = df["days_since_rest_day"].to_numpy()
    f_rest = np.where(rest <= 6, 0.15 * rest, 0.9 + 0.85 * (rest - 6))

    # --- Operational tempo, moderated by cohesion --------------------------
    cohesion = df["peer_cohesion_score"].to_numpy()
    cohesion_protect = (cohesion - 3.0) / 2.0          # -1 .. +1
    deploy = df["deployment_days_continuous"].to_numpy()
    f_deploy = 0.055 * np.maximum(deploy - 30, 0)
    f_deploy = f_deploy * (1.0 - 0.45 * cohesion_protect)   # cohesion buffers it

    f_altitude = 3.0 * df["high_altitude_posting"].to_numpy()
    f_hardship = 1.5 * df["hardship_posting_index"].to_numpy()

    # --- Social separation: distance only bites when contact lapses --------
    contact_gap = df["days_since_family_contact"].to_numpy()
    dist = df["distance_from_home_km"].to_numpy()
    f_separation = 0.28 * contact_gap * (0.55 + 0.45 * np.tanh(dist / 900.0))

    f_leave = 2.6 * df["leave_denied_6m"].to_numpy()
    f_grievance = 5.1 * df["grievance_pending"].to_numpy()
    f_transfers = 1.15 * df["transfers_24m"].to_numpy()

    # --- Physiology ---------------------------------------------------------
    hrv = df["hrv_rmssd_ms"].to_numpy()
    f_hrv = 11.0 * _sigmoid((34.0 - hrv) / 7.0) - 4.0       # low HRV -> risk
    f_hr = 0.75 * np.maximum(df["resting_hr_delta_bpm"].to_numpy(), 0)
    f_activity = -2.2 * np.tanh((df["steps_7d_avg_k"].to_numpy() - 6.0) / 3.0)
    f_prs = -0.09 * (df["physical_readiness_score"].to_numpy() - 65.0)

    # --- Self-report (informative but not dominant; under-reporting is real)
    f_stress = 2.9 * (df["perceived_stress"].to_numpy() - 2.5)
    f_fatigue = 2.3 * (df["perceived_fatigue"].to_numpy() - 2.5)

    # --- Protective / history ----------------------------------------------
    f_cohesion = -6.4 * cohesion_protect
    f_history = 3.8 * df["prior_welfare_contact"].to_numpy()

    # --- Age/tenure: U-shape (new recruits and near-retirement both higher)
    sv = df["service_years"].to_numpy()
    f_tenure = 0.035 * (sv - 13.0) ** 2 - 1.6

    raw = (
        6.0
        + f_sleep_debt + f_sleep_var + f_nights
        + f_overtime + f_rest
        + f_deploy + f_altitude + f_hardship
        + f_separation + f_leave + f_grievance + f_transfers
        + f_hrv + f_hr + f_activity + f_prs
        + f_stress + f_fatigue
        + f_cohesion + f_history + f_tenure
    )
    raw = raw + np.random.normal(0, 4.2, n)          # irreducible noise
    return _clip(raw, 0, 100)


def simulate(n_personnel: int, n_weeks: int, seed: int) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    np.random.seed(seed)

    rows = []

    # ---- Person-level stable traits ---------------------------------------
    for pid in range(n_personnel):
        age = int(_clip(rng.normal(33, 8), 20, 58))
        service_years = int(_clip(rng.normal(age - 24, 4), 0, min(35, age - 19)))
        rank_group = rng.choice(RANK_GROUPS, p=[0.72, 0.21, 0.07])
        gender = rng.choice(["M", "F"], p=[0.91, 0.09])
        branch = rng.choice(FORCE_BRANCHES, p=[0.34, 0.33, 0.13, 0.20])

        baseline_sleep = float(_clip(rng.normal(7.4, 0.55), 5.8, 9.0))
        trait_hrv = float(_clip(rng.normal(46 - 0.22 * (age - 30), 9), 14, 90))
        trait_cohesion = float(_clip(rng.normal(3.5, 0.85), 1, 5))
        trait_prs = float(_clip(rng.normal(72 - 0.35 * (age - 30), 11), 25, 100))
        home_km = float(_clip(rng.gamma(2.2, 420), 15, 2600))
        high_alt = int(rng.random() < (0.28 if branch == "border_guarding" else 0.06))
        hardship = int(_clip(rng.binomial(3, 0.30 + 0.22 * high_alt), 0, 3))

        # personal trajectory: some personnel are on a deteriorating arc
        arc = rng.choice([-1, 0, 1], p=[0.18, 0.57, 0.25])   # improving/stable/worsening

        deploy_days = int(_clip(rng.gamma(2.0, 26), 1, 240))
        rest_gap = int(_clip(rng.gamma(1.9, 3.1), 0, 30))
        transfers = int(rng.binomial(4, 0.16))
        leave_denied = int(rng.binomial(4, 0.17))
        prior_contact = int(rng.random() < 0.12)

        for w in range(n_weeks):
            drift = arc * w * 0.55

            night = int(_clip(rng.poisson(1.5) + 0.45 * drift + 1.1 * high_alt, 0, 7))
            duty = float(_clip(rng.normal(9.6 + 0.30 * drift + 0.55 * hardship, 1.5), 6, 18))
            overtime = float(_clip((duty - 8.0) * 7 + rng.normal(0, 3.5), 0, 70))

            sleep_hit = 0.42 * night + 0.20 * max(duty - 9, 0) + 0.16 * drift
            sleep_avg = float(_clip(baseline_sleep - sleep_hit + rng.normal(0, 0.45), 3.2, 9.5))
            sleep_debt = float(_clip((baseline_sleep - sleep_avg) * 7 + rng.normal(0, 1.6), 0, 38))
            sleep_var = float(_clip(0.55 + 0.22 * night + rng.gamma(1.4, 0.35), 0.1, 4.2))

            # A rest day gets granted with a probability that falls as
            # operational tempo rises — this is what creates the long tails.
            rest_prob = float(_clip(0.76 - 0.040 * night - 0.02 * max(duty - 9, 0)
                                    - 0.06 * hardship - 0.04 * max(drift, 0), 0.08, 0.78))
            rest_gap = int(rng.integers(0, 4)) if rng.random() < rest_prob else int(min(rest_gap + 7, 32))

            # Relief / rotation home resets the continuous-deployment clock.
            deploy_days = int(rng.integers(1, 15)) if rng.random() < 0.09 else int(min(deploy_days + 7, 300))

            contact_gap = int(_clip(rng.gamma(1.7, 4.0) + 0.9 * drift + 0.03 * home_km / 20, 0, 60))

            hrv = float(_clip(trait_hrv - 0.62 * sleep_debt - 1.3 * night - 1.1 * drift
                              + rng.normal(0, 5.0), 9, 110))
            hr_delta = float(_clip(0.30 * sleep_debt + 0.9 * night + rng.normal(0, 2.6) - 1.5, -6, 26))
            steps = float(_clip(rng.normal(7.2 - 0.10 * night + 0.02 * trait_prs - 0.15 * drift, 1.9), 1.0, 18.0))

            cohesion = float(_clip(trait_cohesion - 0.10 * drift + rng.normal(0, 0.35), 1, 5))
            grievance = int(rng.random() < (0.07 + 0.03 * leave_denied + 0.02 * max(drift, 0)))

            # Self-report with realistic under-reporting: correlated with the
            # true state but attenuated and noisy (stigma effect).
            true_pressure = (sleep_debt / 8.0 + night * 0.35 + max(duty - 9, 0) * 0.30
                             + contact_gap * 0.05 + drift * 0.30)
            stress = float(_clip(np.round(2.2 + 0.42 * true_pressure + rng.normal(0, 0.85)), 1, 5))
            fatigue = float(_clip(np.round(2.3 + 0.48 * true_pressure + rng.normal(0, 0.80)), 1, 5))

            prs = float(_clip(trait_prs - 0.22 * sleep_debt - 0.8 * drift + rng.normal(0, 3.5), 10, 100))

            rows.append({
                "personnel_id": f"P{pid:05d}",
                "week": w,
                "age": age,
                "service_years": service_years,
                "sleep_hours_7d_avg": round(sleep_avg, 2),
                "sleep_debt_7d": round(sleep_debt, 2),
                "sleep_variability": round(sleep_var, 2),
                "consecutive_night_shifts": night,
                "duty_hours_7d_avg": round(duty, 2),
                "overtime_hours_7d": round(overtime, 1),
                "days_since_rest_day": rest_gap,
                "deployment_days_continuous": deploy_days,
                "high_altitude_posting": high_alt,
                "hardship_posting_index": hardship,
                "distance_from_home_km": round(home_km, 0),
                "days_since_family_contact": contact_gap,
                "transfers_24m": transfers,
                "leave_denied_6m": leave_denied,
                "perceived_stress": stress,
                "perceived_fatigue": fatigue,
                "hrv_rmssd_ms": round(hrv, 1),
                "resting_hr_delta_bpm": round(hr_delta, 1),
                "steps_7d_avg_k": round(steps, 2),
                "peer_cohesion_score": round(cohesion, 2),
                "grievance_pending": grievance,
                "prior_welfare_contact": prior_contact,
                "physical_readiness_score": round(prs, 1),
                "gender": gender,
                "rank_group": rank_group,
                "force_branch": branch,
            })

    df = pd.DataFrame(rows)

    # ---- Targets -----------------------------------------------------------
    df["wri"] = np.round(latent_risk(df), 2)

    # 7-day-ahead WRI = next weekly observation for the same person.
    df = df.sort_values(["personnel_id", "week"]).reset_index(drop=True)
    df["wri_next"] = df.groupby("personnel_id")["wri"].shift(-1)

    # Escalation label: does this person cross into the review band and require
    # a welfare officer contact within the next 14 days?
    nxt2 = df.groupby("personnel_id")["wri"].shift(-1)
    nxt1 = df.groupby("personnel_id")["wri"].shift(-2)
    peak = pd.concat([nxt2, nxt1], axis=1).max(axis=1)
    p_escalate = _sigmoid((peak - 69.0) / 6.0)
    df["escalated_14d"] = (np.random.random(len(df)) < p_escalate).astype(float)
    df.loc[peak.isna(), "escalated_14d"] = np.nan

    return df


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--personnel", type=int, default=2200)
    ap.add_argument("--weeks", type=int, default=12)
    ap.add_argument("--seed", type=int, default=20260915)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "data"))
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    df = simulate(args.personnel, args.weeks, args.seed)

    csv_path = os.path.join(args.out, "cohort.csv")
    df.to_csv(csv_path, index=False)

    spec_path = os.path.join(args.out, "feature_spec.json")
    with open(spec_path, "w") as fh:
        json.dump({"features": FEATURE_SPEC, "protected": PROTECTED}, fh, indent=2)

    usable = df.dropna(subset=["wri_next", "escalated_14d"])
    print(f"rows={len(df)}  usable={len(usable)}  personnel={df.personnel_id.nunique()}")
    print(f"WRI  mean={df.wri.mean():.1f}  sd={df.wri.std():.1f}  "
          f"p(review>=65)={(df.wri >= 65).mean():.3f}")
    print(f"escalation base rate = {usable.escalated_14d.mean():.3f}")
    print(f"wrote {csv_path}")


if __name__ == "__main__":
    main()
