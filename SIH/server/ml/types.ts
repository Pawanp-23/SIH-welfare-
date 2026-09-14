/**
 * Shapes of the artifact emitted by `ml/train.py`.
 *
 * Nothing in this file is hand-authored numerics — every value comes from the
 * exported gradient-boosted ensembles. If you change the Python feature
 * contract, regenerate the artifact and these types keep the runtime honest.
 */

export interface SerializedTree {
  children_left: number[];
  children_right: number[];
  feature: number[];
  threshold: number[];
  value: number[];
  /** weighted_n_node_samples — the "cover", needed by exact TreeSHAP. */
  cover: number[];
}

export interface SerializedEnsemble {
  base_score: number;
  learning_rate: number;
  link: 'identity' | 'logit';
  n_trees: number;
  max_depth: number;
  trees: SerializedTree[];
}

export interface FeatureSpec {
  key: string;
  label: string;
  unit: string;
  category:
    | 'sleep'
    | 'schedule'
    | 'operational'
    | 'physiological'
    | 'social'
    | 'self_report'
    | 'demographic'
    | 'history';
}

export interface DriftReferenceEntry {
  edges: number[];
  props: number[];
  mean: number;
  std: number;
}

export interface ModelArtifact {
  model_version: string;
  trained_at: string;
  algorithm: string;
  features: FeatureSpec[];
  feature_order: string[];
  bands: { watch: number; review: number };
  escalation_threshold: number;
  models: {
    wri: SerializedEnsemble;
    wri_7d: SerializedEnsemble;
    escalation: SerializedEnsemble;
    wri_q10: SerializedEnsemble;
    wri_q90: SerializedEnsemble;
  };
  drift_reference: Record<string, DriftReferenceEntry>;
  training: {
    rows_total: number;
    rows_train: number;
    rows_test: number;
    personnel_train: number;
    personnel_test: number;
    split: string;
    seconds: number;
  };
  metrics: ModelMetrics;
}

export interface ModelMetrics {
  regression: {
    wri: { mae: number; rmse: number; r2: number };
    wri_7d_ahead: { mae: number; rmse: number; r2: number; persistence_baseline_mae: number };
    baselines: {
      linear_regression_mae: number;
      linear_regression_r2: number;
      self_report_only_mae: number;
      self_report_only_r2: number;
    };
  };
  band_accuracy: number;
  band_confusion: { labels: string[]; matrix: number[][] };
  classification: {
    roc_auc: number;
    pr_auc: number;
    f1: number;
    f2: number;
    precision: number;
    recall: number;
    brier: number;
    threshold: number;
    base_rate: number;
    baseline_logistic_roc_auc: number;
    calibration: Array<{ bin: string; predicted: number; observed: number; count: number }>;
  };
  prediction_interval: { nominal: number; empirical_coverage: number; mean_width: number };
  fairness: Record<
    string,
    {
      groups: Array<{
        group: string;
        n: number;
        selection_rate: number;
        tpr: number | null;
        fpr: number | null;
        auc: number | null;
      }>;
      disparate_impact_ratio: number | null;
    }
  >;
  permutation_importance: Array<{ feature: string; mae_increase: number; importance: number }>;
  python_inference_ms: number;
}
