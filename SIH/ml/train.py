"""
SAHARA — Model training, evaluation and export
==============================================

Trains the four models that power the product, evaluates them honestly
(including against baselines and across protected groups), and exports the
*actual learned tree structures* to JSON so the Node runtime performs real
inference and real TreeSHAP — no hardcoded coefficients anywhere.

Models
------
  wri          GradientBoostingRegressor  -> Welfare Risk Index today (0-100)
  wri_7d       GradientBoostingRegressor  -> WRI seven days ahead   (the predictive core)
  escalation   GradientBoostingClassifier -> P(welfare escalation within 14 days)
  wri_q10/q90  Quantile regressors        -> genuine 80% prediction interval

Splitting is done by *personnel_id group*, never by row, so no individual
appears in both train and test. That is the difference between a real held-out
score and a leaked one.

Usage
-----
    python ml/generate_dataset.py
    python ml/train.py
    # -> server/models/sahara-model-v2.json  (consumed by the TS runtime)
    # -> ml/artifacts/metrics.json           (consumed by the Model Monitoring UI)
"""

from __future__ import annotations

import json
import os
import time

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    f1_score,
    mean_absolute_error,
    precision_score,
    r2_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import GroupShuffleSplit

from generate_dataset import FEATURE_SPEC, FEATURES, PROTECTED

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data", "cohort.csv")
ART = os.path.join(HERE, "artifacts")
MODEL_OUT = os.path.join(HERE, "..", "server", "models", "sahara-model-v2.json")

MODEL_VERSION = "sahara-gbm-v2.0.0"
SEED = 20260915

# Operating bands for the Welfare Risk Index.
BAND_WATCH = 40
BAND_REVIEW = 65


# ---------------------------------------------------------------------------
# Tree export
# ---------------------------------------------------------------------------
def export_tree(dtree) -> dict:
    """Serialise a fitted sklearn decision tree into a compact JSON structure.

    We keep `cover` (weighted_n_node_samples) because exact TreeSHAP needs it
    to weight the coalitions of a path when a feature is absent.
    """
    t = dtree.tree_
    return {
        "children_left": t.children_left.tolist(),
        "children_right": t.children_right.tolist(),
        "feature": t.feature.tolist(),
        "threshold": [float(x) for x in t.threshold],
        "value": [float(v[0][0]) for v in t.value],
        "cover": [round(float(x), 3) for x in t.weighted_n_node_samples],
    }


def export_gb(model, X_sample: np.ndarray) -> dict:
    """Serialise a gradient-boosting ensemble, deriving the raw base score
    numerically so we never depend on a private sklearn attribute."""
    trees = [export_tree(model.estimators_[i, 0]) for i in range(model.n_estimators_)]
    lr = float(model.learning_rate)

    # base = raw_prediction - lr * sum(tree outputs), evaluated on one sample.
    tree_sum = float(sum(model.estimators_[i, 0].predict(X_sample[:1])[0]
                         for i in range(model.n_estimators_)))
    if hasattr(model, "decision_function"):
        raw = float(np.ravel(model.decision_function(X_sample[:1]))[0])
        link = "logit"
    else:
        raw = float(np.ravel(model.predict(X_sample[:1]))[0])
        link = "identity"
    base = raw - lr * tree_sum

    return {
        "base_score": base,
        "learning_rate": lr,
        "link": link,
        "n_trees": len(trees),
        "max_depth": int(model.max_depth),
        "trees": trees,
    }


def verify_export(bundle: dict, model, X: np.ndarray, name: str) -> float:
    """Re-implement inference from the exported JSON in numpy and confirm it
    reproduces sklearn to floating-point tolerance. If this fails, the JSON the
    TypeScript runtime loads would be wrong — so we fail the build.

    Note the float32 cast: sklearn's tree code demotes X to float32 before
    comparing against thresholds, so a value sitting within a float32 ULP of a
    split point routes differently in float64. The TypeScript runtime applies
    the same demotion via Math.fround, which is why this check is byte-faithful
    rather than merely close.
    """

    def predict_tree(tree, x):
        node = 0
        while tree["children_left"][node] != -1:
            f = tree["feature"][node]
            node = (tree["children_left"][node] if x[f] <= tree["threshold"][node]
                    else tree["children_right"][node])
        return tree["value"][node]

    X32 = X.astype(np.float32).astype(np.float64)
    got = []
    for x in X32[:400]:
        s = bundle["base_score"] + bundle["learning_rate"] * sum(
            predict_tree(t, x) for t in bundle["trees"])
        got.append(s)
    got = np.array(got)

    if bundle["link"] == "logit":
        expect = np.ravel(model.decision_function(X[:400]))
    else:
        expect = np.ravel(model.predict(X[:400]))

    err = float(np.max(np.abs(got - expect)))
    status = "OK " if err < 1e-6 else "FAIL"
    print(f"  [{status}] export round-trip {name}: max abs err = {err:.3e}")
    if err >= 1e-6:
        raise SystemExit(f"Export verification failed for {name}")
    return err


# ---------------------------------------------------------------------------
# Evaluation helpers
# ---------------------------------------------------------------------------
def band_of(v: float) -> str:
    return "review" if v >= BAND_REVIEW else ("watch" if v >= BAND_WATCH else "routine")


def calibration_bins(y_true, y_prob, n_bins=10):
    edges = np.linspace(0, 1, n_bins + 1)
    out = []
    for i in range(n_bins):
        m = (y_prob >= edges[i]) & (y_prob < edges[i + 1] if i < n_bins - 1 else y_prob <= 1.0)
        if m.sum() < 5:
            continue
        out.append({
            "bin": f"{edges[i]:.1f}-{edges[i+1]:.1f}",
            "predicted": round(float(y_prob[m].mean()), 4),
            "observed": round(float(y_true[m].mean()), 4),
            "count": int(m.sum()),
        })
    return out


def fairness_slices(df_test, y_true, y_pred_bin, y_score):
    """Report selection rate, TPR and FPR per protected group.

    Protected attributes are *not model inputs*. This audit exists to detect
    disparate impact that leaks in through correlated operational features.
    """
    out = {}
    for attr in PROTECTED:
        rows = []
        for g in sorted(df_test[attr].unique()):
            m = (df_test[attr] == g).to_numpy()
            if m.sum() < 60:
                continue
            yt, yp = y_true[m], y_pred_bin[m]
            tp = int(((yt == 1) & (yp == 1)).sum()); fn = int(((yt == 1) & (yp == 0)).sum())
            fp = int(((yt == 0) & (yp == 1)).sum()); tn = int(((yt == 0) & (yp == 0)).sum())
            rows.append({
                "group": str(g),
                "n": int(m.sum()),
                "selection_rate": round(float(yp.mean()), 4),
                "tpr": round(tp / (tp + fn), 4) if (tp + fn) else None,
                "fpr": round(fp / (fp + tn), 4) if (fp + tn) else None,
                "auc": round(float(roc_auc_score(yt, y_score[m])), 4) if len(set(yt)) > 1 else None,
            })
        if rows:
            sel = [r["selection_rate"] for r in rows if r["selection_rate"] > 0]
            # Four-fifths rule: min/max selection rate ratio.
            out[attr] = {
                "groups": rows,
                "disparate_impact_ratio": round(min(sel) / max(sel), 4) if len(sel) > 1 else None,
            }
    return out


def permutation_importance_fast(model, X, y, feature_names, n_repeats=3, rng=None):
    rng = rng or np.random.default_rng(SEED)
    base = mean_absolute_error(y, model.predict(X))
    out = []
    for j, name in enumerate(feature_names):
        drops = []
        for _ in range(n_repeats):
            Xp = X.copy()
            rng.shuffle(Xp[:, j])
            drops.append(mean_absolute_error(y, model.predict(Xp)) - base)
        out.append((name, float(np.mean(drops))))
    tot = sum(max(v, 0) for _, v in out) or 1.0
    return [{"feature": n, "mae_increase": round(v, 4), "importance": round(max(v, 0) / tot, 5)}
            for n, v in sorted(out, key=lambda kv: -kv[1])]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    os.makedirs(ART, exist_ok=True)
    os.makedirs(os.path.dirname(MODEL_OUT), exist_ok=True)

    df = pd.read_csv(DATA).dropna(subset=["wri_next", "escalated_14d"]).reset_index(drop=True)
    X = df[FEATURES].to_numpy(dtype=np.float64)
    groups = df["personnel_id"].to_numpy()

    y_wri = df["wri"].to_numpy()
    y_next = df["wri_next"].to_numpy()
    y_esc = df["escalated_14d"].to_numpy().astype(int)

    # --- Group split: no individual appears in both sides ------------------
    gss = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=SEED)
    tr, te = next(gss.split(X, y_wri, groups))
    Xtr, Xte = X[tr], X[te]
    print(f"train rows={len(tr)}  test rows={len(te)}  "
          f"train personnel={len(set(groups[tr]))}  test personnel={len(set(groups[te]))}  "
          f"(disjoint: {set(groups[tr]).isdisjoint(set(groups[te]))})")

    common = dict(n_estimators=180, max_depth=3, learning_rate=0.08,
                  subsample=0.85, min_samples_leaf=25, random_state=SEED)

    t0 = time.time()
    m_wri = GradientBoostingRegressor(loss="squared_error", **common).fit(Xtr, y_wri[tr])
    m_next = GradientBoostingRegressor(loss="squared_error", **common).fit(Xtr, y_next[tr])
    m_esc = GradientBoostingClassifier(**common).fit(Xtr, y_esc[tr])
    q_common = dict(common); q_common["n_estimators"] = 120
    m_q10 = GradientBoostingRegressor(loss="quantile", alpha=0.10, **q_common).fit(Xtr, y_wri[tr])
    m_q90 = GradientBoostingRegressor(loss="quantile", alpha=0.90, **q_common).fit(Xtr, y_wri[tr])
    train_secs = time.time() - t0
    print(f"trained 5 models in {train_secs:.1f}s")

    # ---------------- Regression metrics --------------------------------
    p_wri = m_wri.predict(Xte)
    p_next = m_next.predict(Xte)

    lin = LinearRegression().fit(Xtr, y_wri[tr])
    p_lin = lin.predict(Xte)

    # "Self-report only" baseline: what you get from asking people how they feel.
    sr_idx = [FEATURES.index("perceived_stress"), FEATURES.index("perceived_fatigue")]
    lin_sr = LinearRegression().fit(Xtr[:, sr_idx], y_wri[tr])
    p_sr = lin_sr.predict(Xte[:, sr_idx])

    reg = {
        "wri": {
            "mae": round(float(mean_absolute_error(y_wri[te], p_wri)), 3),
            "rmse": round(float(np.sqrt(np.mean((y_wri[te] - p_wri) ** 2))), 3),
            "r2": round(float(r2_score(y_wri[te], p_wri)), 4),
        },
        "wri_7d_ahead": {
            "mae": round(float(mean_absolute_error(y_next[te], p_next)), 3),
            "rmse": round(float(np.sqrt(np.mean((y_next[te] - p_next) ** 2))), 3),
            "r2": round(float(r2_score(y_next[te], p_next)), 4),
            "persistence_baseline_mae": round(float(mean_absolute_error(y_next[te], y_wri[te])), 3),
        },
        "baselines": {
            "linear_regression_mae": round(float(mean_absolute_error(y_wri[te], p_lin)), 3),
            "linear_regression_r2": round(float(r2_score(y_wri[te], p_lin)), 4),
            "self_report_only_mae": round(float(mean_absolute_error(y_wri[te], p_sr)), 3),
            "self_report_only_r2": round(float(r2_score(y_wri[te], p_sr)), 4),
        },
    }

    # Band-level agreement — what actually drives the UI.
    bands_true = np.array([band_of(v) for v in y_wri[te]])
    bands_pred = np.array([band_of(v) for v in p_wri])
    band_acc = float((bands_true == bands_pred).mean())
    labels = ["routine", "watch", "review"]
    confusion = [[int(((bands_true == a) & (bands_pred == b)).sum()) for b in labels] for a in labels]

    # ---------------- Classification metrics ----------------------------
    s_esc = m_esc.predict_proba(Xte)[:, 1]
    logit = make_pipeline(StandardScaler(), LogisticRegression(max_iter=3000)).fit(Xtr, y_esc[tr])
    s_log = logit.predict_proba(Xte)[:, 1]

    # Choose the operating threshold on the TRAIN set, not the test set.
    s_tr = m_esc.predict_proba(Xtr)[:, 1]
    grid = np.linspace(0.05, 0.9, 86)
    # Recall-weighted objective: missing a deteriorating jawan costs more than
    # an unnecessary welfare conversation. We optimise F-beta with beta = 2.
    def fbeta(y, yhat, beta=2.0):
        p = precision_score(y, yhat, zero_division=0)
        r = recall_score(y, yhat, zero_division=0)
        return 0.0 if (p + r) == 0 else (1 + beta**2) * p * r / (beta**2 * p + r)
    thr = float(max(grid, key=lambda t: fbeta(y_esc[tr], (s_tr >= t).astype(int))))
    yhat = (s_esc >= thr).astype(int)

    clf = {
        "roc_auc": round(float(roc_auc_score(y_esc[te], s_esc)), 4),
        "pr_auc": round(float(average_precision_score(y_esc[te], s_esc)), 4),
        "f1": round(float(f1_score(y_esc[te], yhat)), 4),
        "f2": round(float(fbeta(y_esc[te], yhat)), 4),
        "precision": round(float(precision_score(y_esc[te], yhat, zero_division=0)), 4),
        "recall": round(float(recall_score(y_esc[te], yhat, zero_division=0)), 4),
        "brier": round(float(brier_score_loss(y_esc[te], s_esc)), 4),
        "threshold": round(thr, 3),
        "base_rate": round(float(y_esc[te].mean()), 4),
        "baseline_logistic_roc_auc": round(float(roc_auc_score(y_esc[te], s_log)), 4),
        "calibration": calibration_bins(y_esc[te], s_esc),
    }

    # ---------------- Prediction-interval coverage ----------------------
    lo, hi = m_q10.predict(Xte), m_q90.predict(Xte)
    coverage = float(((y_wri[te] >= lo) & (y_wri[te] <= hi)).mean())
    interval = {
        "nominal": 0.80,
        "empirical_coverage": round(coverage, 4),
        "mean_width": round(float(np.mean(hi - lo)), 3),
    }

    # ---------------- Fairness -------------------------------------------
    fair = fairness_slices(df.iloc[te], y_esc[te], yhat, s_esc)

    # ---------------- Importance ------------------------------------------
    perm = permutation_importance_fast(m_wri, Xte[:3000].copy(), y_wri[te][:3000], FEATURES)

    # ---------------- Latency ----------------------------------------------
    t0 = time.time()
    for _ in range(200):
        m_wri.predict(Xte[:1])
    py_latency_ms = (time.time() - t0) / 200 * 1000

    # ---------------- Drift reference --------------------------------------
    # PSI at runtime needs the training distribution. We store decile edges.
    drift_ref = {}
    for j, f in enumerate(FEATURES):
        edges = np.quantile(Xtr[:, j], np.linspace(0, 1, 11)).tolist()
        counts, _ = np.histogram(Xtr[:, j], bins=np.unique(edges) if len(set(edges)) > 1 else 2)
        drift_ref[f] = {
            "edges": [round(float(e), 4) for e in edges],
            "props": [round(float(c) / len(Xtr), 6) for c in counts],
            "mean": round(float(Xtr[:, j].mean()), 4),
            "std": round(float(Xtr[:, j].std()), 4),
        }

    # ---------------- Export models ----------------------------------------
    bundles = {
        "wri": export_gb(m_wri, Xtr),
        "wri_7d": export_gb(m_next, Xtr),
        "escalation": export_gb(m_esc, Xtr),
        "wri_q10": export_gb(m_q10, Xtr),
        "wri_q90": export_gb(m_q90, Xtr),
    }
    print("verifying exported artifacts reproduce sklearn:")
    for name, mdl in [("wri", m_wri), ("wri_7d", m_next), ("escalation", m_esc),
                      ("wri_q10", m_q10), ("wri_q90", m_q90)]:
        verify_export(bundles[name], mdl, Xte, name)

    artifact = {
        "model_version": MODEL_VERSION,
        "trained_at": pd.Timestamp.utcnow().isoformat(),
        "algorithm": "Gradient Boosted Regression Trees (sklearn GradientBoosting, depth 3)",
        "features": FEATURE_SPEC,
        "feature_order": FEATURES,
        "bands": {"watch": BAND_WATCH, "review": BAND_REVIEW},
        "escalation_threshold": clf["threshold"],
        "models": bundles,
        "drift_reference": drift_ref,
        "training": {
            "rows_total": int(len(df)),
            "rows_train": int(len(tr)),
            "rows_test": int(len(te)),
            "personnel_train": int(len(set(groups[tr]))),
            "personnel_test": int(len(set(groups[te]))),
            "split": "GroupShuffleSplit by personnel_id (no individual in both sets)",
            "seconds": round(train_secs, 2),
        },
        "metrics": {
            "regression": reg,
            "band_accuracy": round(band_acc, 4),
            "band_confusion": {"labels": labels, "matrix": confusion},
            "classification": clf,
            "prediction_interval": interval,
            "fairness": fair,
            "permutation_importance": perm,
            "python_inference_ms": round(py_latency_ms, 3),
        },
    }

    with open(MODEL_OUT, "w") as fh:
        json.dump(artifact, fh, separators=(",", ":"))
    with open(os.path.join(ART, "metrics.json"), "w") as fh:
        json.dump(artifact["metrics"], fh, indent=2)

    # --- Cross-runtime fixture -------------------------------------------
    # 500 held-out rows with sklearn's own answers, so `npm run ml:verify`
    # can prove the TypeScript runtime agrees with the trained model rather
    # than merely running without crashing.
    k = min(500, len(te))
    Xfix = Xte[:k]
    fixture = {
        "feature_order": FEATURES,
        "rows": [[float(v) for v in row] for row in Xfix],
        "expected": {
            "wri": [float(v) for v in m_wri.predict(Xfix)],
            "wri_7d": [float(v) for v in m_next.predict(Xfix)],
            "escalation_raw": [float(v) for v in np.ravel(m_esc.decision_function(Xfix))],
            "escalation_proba": [float(v) for v in m_esc.predict_proba(Xfix)[:, 1]],
            "wri_q10": [float(v) for v in m_q10.predict(Xfix)],
            "wri_q90": [float(v) for v in m_q90.predict(Xfix)],
        },
    }
    with open(os.path.join(ART, "reference_predictions.json"), "w") as fh:
        json.dump(fixture, fh, separators=(",", ":"))

    size_kb = os.path.getsize(MODEL_OUT) / 1024
    print("\n================ SAHARA model card ================")
    print(f"version           {MODEL_VERSION}")
    print(f"WRI  MAE {reg['wri']['mae']}   R² {reg['wri']['r2']}"
          f"   (linear baseline MAE {reg['baselines']['linear_regression_mae']},"
          f" self-report-only MAE {reg['baselines']['self_report_only_mae']})")
    print(f"7-day-ahead MAE {reg['wri_7d_ahead']['mae']}"
          f"   (persistence baseline {reg['wri_7d_ahead']['persistence_baseline_mae']})")
    print(f"band accuracy     {band_acc:.4f}")
    print(f"escalation        ROC-AUC {clf['roc_auc']}  PR-AUC {clf['pr_auc']}"
          f"  recall {clf['recall']}  precision {clf['precision']}  Brier {clf['brier']}")
    print(f"                  logistic baseline ROC-AUC {clf['baseline_logistic_roc_auc']}")
    print(f"80% interval      empirical coverage {coverage:.3f}  width {interval['mean_width']}")
    for attr, blk in fair.items():
        print(f"fairness {attr:<14} disparate-impact ratio {blk['disparate_impact_ratio']}")
    print(f"top features      {', '.join(p['feature'] for p in perm[:6])}")
    print(f"artifact          {MODEL_OUT}  ({size_kb:.0f} KB)")
    print("===================================================")


if __name__ == "__main__":
    main()
