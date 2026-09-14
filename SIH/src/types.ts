/**
 * SAHARA Type Definitions & Data Contracts
 * Defines roles, check-in payloads, assessment metrics, case workflows, and aggregate summaries.
 */

export type UserRole = 'personnel' | 'welfare_officer' | 'command_viewer' | 'demo_operator' | 'admin';

export type ReviewBand = 'routine' | 'watch' | 'review';

export interface UserProfile {
  id: string;
  name: string;
  alias: string;
  role: UserRole;
  unitId: string;
  unitName: string;
  rank: string;
  assignedOfficerId?: string;
  hasConsented: boolean;
  consentGrantedAt?: string;
  avatarUrl?: string;
}

export interface DailyCheckinInput {
  date: string; // YYYY-MM-DD
  sleepHours: number; // 0 - 24
  perceivedStress: number; // 1 - 5
  perceivedFatigue: number; // 1 - 5
  dutyHours?: number; // 0 - 24
  nightShift?: boolean;
  supportRequested?: boolean;
  notes?: string;
}

export interface HeuristicContributors {
  stressScore: number;
  fatigueScore: number;
  sleepScore: number;
  workloadScore: number;
  sleepDeltaFromBaseline?: number;
  explanations: string[];
}

export interface AssessmentResult {
  id: string;
  checkinId: string;
  date: string;
  index: number; // 0 - 100
  band: ReviewBand;
  coverage: number; // e.g. 1.0 or 0.85 if duty missing
  contributors: HeuristicContributors;
  algorithmVersion: string;
  forecastValue?: number; // 1 - 5 predicted next-day stress
  forecastBaseline?: number; // persistence baseline (today's stress)
  modelVersion: string;
  generatedAt: string;
  dataSource: 'live_input' | 'synthetic_demo';
}

export type CaseStatus = 'new' | 'acknowledged' | 'follow_up_scheduled' | 'closed';

export interface CaseEvent {
  id: string;
  caseId: string;
  actorId: string;
  actorName: string;
  action: string;
  conciseNote: string;
  timestamp: string;
}

export interface RecommendationCard {
  id: string;
  caseId: string;
  triggerFacts: string[];
  ruleVersion: string;
  proposedAction: string;
  reviewStatus: 'pending' | 'accepted' | 'dismissed';
  reviewerNote?: string;
  reviewerId?: string;
  reviewedAt?: string;
}

export interface WelfareCase {
  id: string;
  personnelId: string;
  personnelAlias: string;
  unitId: string;
  unitName: string;
  assignedOfficerId: string;
  status: CaseStatus;
  reason: string;
  dueAt: string;
  createdAt: string;
  updatedAt: string;
  latestIndex: number;
  latestBand: ReviewBand;
  consecutiveAlertDays: number;
  supportRequested: boolean;
  events: CaseEvent[];
  recommendations: RecommendationCard[];
}

export interface UnitAggregateSummary {
  unitId: string;
  unitName: string;
  totalPersonnel: number;
  isSuppressed: boolean; // True if totalPersonnel < 10 (k-anonymity)
  activeCheckinCoverage: number; // percentage (0 - 100)
  avgDutyHours: number;
  consecutiveNightShiftPersonnel: number;
  openWelfareCases: number;
  resolvedWelfareCasesThisMonth: number;
  workloadTrend: Array<{
    date: string;
    avgDutyHours: number;
    nightShiftCount: number;
  }>;
  suppressionNotice?: string;
}

export interface SyntheticHRRecord {
  personnelId: string;
  date: string;
  dutyHours: number;
  nightShift: boolean;
  deploymentDays: number;
  daysSinceRest: number;
  transfersCount: number;
}

export type ScreenId =
  | 'command_overview'
  | 'unit_intelligence'
  | 'personnel_view'
  | 'intervention_assistant'
  | 'what_if_simulator'
  | 'model_monitoring'
  | 'audit_privacy';

export interface ForceWelfareOverview {
  totalMonitored: number; // 1,842
  lowRisk: number; // 1,432
  moderateRisk: number; // 318
  highRisk: number; // 92
  criticalTrendAlerts: number; // 17
  readinessScore: number;
  riskDistribution: Array<{ name: string; count: number; color: string; percent: number }>;
  alertVelocity: Array<{ date: string; newAlerts: number; resolved: number; activeTotal: number }>;
  systemicHotspots: Array<{ unitName: string; riskScore: number; primaryFactor: string; trend: 'rising' | 'stable' | 'declining' }>;
}

export interface UnitHeatmapItem {
  id: string;
  unitName: string;
  sector: string;
  personnelCount: number;
  riskScore: number;
  band: ReviewBand;
  isSuppressed: boolean;
  avgShiftHours: number;
  nightShiftRatio: number; // percent
  deploymentDurationDays: number;
  trendDirection: 'rising' | 'stable' | 'declining';
  weeklyTrend: number[];
}

export interface ShapFactor {
  feature: string;
  name: string;
  value: string;
  impact: number; // e.g. +18.5
  direction: 'increases_risk' | 'decreases_risk';
  category: 'sleep' | 'schedule' | 'operational' | 'physiological';
}

export interface PersonnelRiskProfile {
  id: string;
  pseudonymToken: string;
  realNameMasked: string;
  unitId: string;
  unitName: string;
  rank: string;
  welfareRiskIndex: number; // e.g. 78
  band: ReviewBand;
  confidenceInterval: [number, number];
  temporalTrajectory: Array<{
    step: number;
    date: string;
    label: string;
    riskScore: number;
    description: string;
    dutyHours: number;
    sleepHours: number;
    nightShift: boolean;
  }>;
  shapBaseValue: number;
  shapFactors: ShapFactor[];
  activeCaseId?: string;
}

export interface WhatIfSimulationInput {
  personnelId: string;
  dutyHoursDelta: number; // e.g. -4
  nightShiftsDelta: number; // e.g. -2
  grantedRestDays: number; // e.g. 2
  leaveAuthorized: boolean;
  peerSupportSession: boolean;
}

export interface WhatIfSimulationResult {
  baselineRisk: number;
  simulatedRisk: number;
  riskDelta: number;
  baselineBand: ReviewBand;
  simulatedBand: ReviewBand;
  confidenceInterval: [number, number];
  shapWaterfallBefore: ShapFactor[];
  shapWaterfallAfter: ShapFactor[];
  projectedTrajectory: Array<{ day: string; baseline: number; simulated: number }>;
  clinicalRationale: string;
}

export interface ModelHealthMetrics {
  modelName: string;
  version: string;
  status: 'Healthy' | 'Degraded' | 'Critical';
  f1Score: number;
  recall: number;
  rocAuc: number;
  inferenceP95Ms: number;
  predictionFailuresPercent: number;
  driftLevel: 'Low' | 'Moderate' | 'High';
  psiScore: number;
  lastTrainedAt: string;
  totalInferencesLogged: number;
  latencyHistogram: Array<{ bucket: string; count: number }>;
  globalFeatureImportance: Array<{ feature: string; name: string; importance: number }>;
  architecture: {
    frontend: string;
    bff: string;
    ragService: string;
    mlEngine: string;
  };
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  action: string;
  resource: string;
  justification: string;
  privacyFilterEnforced: string;
}

export interface InterventionItem {
  id: string;
  title: string;
  category: 'rest' | 'schedule' | 'clinical' | 'command';
  status: 'recommended' | 'approved' | 'in_progress' | 'completed' | 'dismissed';
  targetPersonnelId: string;
  targetPersonnelToken: string;
  targetUnitName: string;
  urgency: 'high' | 'medium' | 'routine';
  projectedRiskReduction: number;
  preInterventionRisk: number;
  postInterventionRisk?: number;
  approvedBy?: string;
  approvedAt?: string;
  policyCitation: string;
  ragEvidenceQuote: string;
  officerNotes?: string;
}
