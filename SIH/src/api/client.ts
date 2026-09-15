/**
 * Typed API client.
 *
 * One place owns the auth header, the error shape, and the abort behaviour, so
 * no screen ever hand-rolls a fetch. Errors arrive as `ApiError` carrying the
 * server's machine-readable code and per-field issues, which is what lets the
 * check-in form show a validation message against the right input instead of a
 * generic red banner.
 */

import type {
  AssessmentResult,
  AuditLogEntry,
  CaseStatus,
  DailyCheckinInput,
  ForceWelfareOverview,
  InterventionItem,
  ModelHealthMetrics,
  PersonnelRiskProfile,
  SyntheticHRRecord,
  UnitAggregateSummary,
  UnitHeatmapItem,
  UserProfile,
  WhatIfSimulationInput,
} from '../types.js';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string = 'error',
    public readonly issues: string[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface PeriodSummary {
  start: string;
  end: string;
  daysRecorded: number;
  meanIndex: number;
  minIndex: number;
  maxIndex: number;
  deltaVsPrior: number | null;
  bandDays: Record<'routine' | 'watch' | 'review', number>;
  meanSleepHours: number | null;
  meanDutyHours: number | null;
  meanPerceivedStress: number | null;
  peak: { date: string; index: number } | null;
}

export interface Attribution {
  feature: string;
  name: string;
  value: string;
  rawValue: number;
  impact: number;
  direction: 'increases_risk' | 'decreases_risk';
  category: string;
  percentile: number;
  imputed: boolean;
}

export interface AssessmentDetail {
  wri: number;
  band: 'routine' | 'watch' | 'review';
  interval: [number, number];
  forecast7d: number;
  forecastBand: 'routine' | 'watch' | 'review';
  trajectory: 'rising' | 'stable' | 'improving';
  escalationProbability: number;
  escalationFlag: boolean;
  escalationThreshold: number;
  baseValue: number;
  coverage: number;
  imputed: string[];
  drivers: Attribution[];
  protectiveFactors: Attribution[];
  categoryBreakdown: Array<{ category: string; impact: number }>;
  modelVersion: string;
  computedInMs: number;
}

export interface Recommendation {
  id: string;
  driver: string;
  title: string;
  category: string;
  urgency: 'high' | 'medium' | 'routine';
  action: string;
  evidence: string;
  citation: string;
  owner: string;
  effortDays: number;
  projectedRiskReduction: number;
  preRisk: number;
  postRisk: number;
  bandBefore: string;
  bandAfter: string;
  triggerImpact: number;
  triggerValue: string;
  rationale: string;
}

export interface Dossier {
  token: string;
  unitName: string;
  rank: string;
  assessment: AssessmentDetail;
  recommendations: Recommendation[];
  plan: {
    combinedRiskReduction: number;
    naiveSumOfIndividualEffects: number;
    interactionNote: string;
    projected: Array<{ day: string; baseline: number; simulated: number }>;
  } | null;
  history: Array<{ date: string; index: number; band: string; forecast?: number }>;
  notes: Array<{ date: string; text: string }>;
}

class SaharaApiClient {
  private userId = 'p-014';
  private token: string | null = null;

  setUserId(id: string) {
    this.userId = id;
  }
  getUserId() {
    return this.userId;
  }
  setToken(token: string | null) {
    this.token = token;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-User-Id': this.userId,
      ...((options.headers as Record<string, string>) ?? {}),
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    let res: Response;
    try {
      res = await fetch(endpoint, { ...options, headers });
    } catch {
      throw new ApiError('Could not reach the SAHARA server.', 0, 'network');
    }

    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new ApiError('The server returned a response we could not read.', res.status, 'bad_response');
    }

    if (!res.ok) {
      throw new ApiError(
        (data.error as string) ?? `Request failed (${res.status})`,
        res.status,
        (data.code as string) ?? 'error',
        (data.issues as string[]) ?? [],
      );
    }
    return data as T;
  }

  // --- Identity -------------------------------------------------------------

  async login(userId: string, password: string) {
    const res = await this.request<{ success: boolean; user: UserProfile; token: string }>(
      '/api/auth/login',
      { method: 'POST', body: JSON.stringify({ userId, password }) },
    );
    this.userId = res.user.id;
    this.token = res.token;
    return res;
  }

  getMe() {
    return this.request<{ success: boolean; user: UserProfile; token: string }>('/api/me');
  }

  listUsers() {
    return this.request<{ success: boolean; users: UserProfile[] }>('/api/users');
  }

  async registerUser(data: {
    name: string;
    role: 'personnel' | 'welfare_officer' | 'command_viewer' | 'demo_operator';
    unitName?: string;
    rank?: string;
    password?: string;
  }) {
    const res = await this.request<{ success: boolean; user: UserProfile; token: string }>(
      '/api/register',
      { method: 'POST', body: JSON.stringify(data) },
    );
    if (res.success) {
      this.userId = res.user.id;
      this.token = res.token;
    }
    return res;
  }

  setConsent(granted: boolean) {
    return this.request<{ success: boolean; user: UserProfile }>('/api/consent', {
      method: 'POST',
      body: JSON.stringify({ granted }),
    });
  }

  getConsentLedger() {
    return this.request<{
      success: boolean;
      ledger: Array<{ id: string; granted: boolean; scope: string; policyVersion: string; timestamp: string }>;
    }>('/api/consent/ledger');
  }

  // --- Personnel ------------------------------------------------------------

  submitCheckin(input: DailyCheckinInput) {
    return this.request<{ success: boolean; assessment: AssessmentResult; message: string }>(
      '/api/checkins',
      { method: 'POST', body: JSON.stringify(input) },
    );
  }

  getTrends() {
    return this.request<{
      success: boolean;
      history: Array<{
        date: string;
        index: number;
        band: string;
        forecast?: number;
        sleepHours: number | null;
        perceivedStress: number | null;
        perceivedFatigue: number | null;
        dutyHours: number | null;
      }>;
      latestAssessment: AssessmentResult | null;
      detail: AssessmentDetail | null;
    }>('/api/me/trends');
  }

  getScores() {
    return this.request<{
      success: boolean;
      weeks: PeriodSummary[];
      months: PeriodSummary[];
      currentStreak: number;
    }>('/api/me/scores');
  }

  getDossier(personnelId: string) {
    return this.request<{ success: boolean; dossier: Dossier }>(
      `/api/personnel/dossier/${encodeURIComponent(personnelId)}`,
    );
  }

  getPersonnelRiskProfile(personnelId: string) {
    return this.request<{ success: boolean; profile: PersonnelRiskProfile }>(
      `/api/personnel/risk-profile/${encodeURIComponent(personnelId)}`,
    );
  }

  // --- Casework -------------------------------------------------------------

  getCases() {
    return this.request<{ success: boolean; cases: import('../types.js').WelfareCase[] }>('/api/cases');
  }

  getCaseById(caseId: string) {
    return this.request<{ success: boolean; case: import('../types.js').WelfareCase }>(
      `/api/cases/${caseId}`,
    );
  }

  updateCase(caseId: string, status: CaseStatus, note: string, dueAt?: string) {
    return this.request<{ success: boolean; case: import('../types.js').WelfareCase }>(
      `/api/cases/${caseId}/events`,
      { method: 'POST', body: JSON.stringify({ status, note, dueAt }) },
    );
  }

  reviewRecommendation(caseId: string, recId: string, decision: 'accepted' | 'dismissed', note: string) {
    return this.request<{ success: boolean; case: import('../types.js').WelfareCase }>(
      `/api/cases/${caseId}/recommendations/${recId}/review`,
      { method: 'POST', body: JSON.stringify({ decision, note }) },
    );
  }

  // --- Command --------------------------------------------------------------

  getForceOverview() {
    return this.request<{ success: boolean; overview: ForceWelfareOverview }>(
      '/api/command/force-overview',
    );
  }

  getUnitIntelligence() {
    return this.request<{ success: boolean; units: UnitHeatmapItem[] }>('/api/units/intelligence');
  }

  getCommandSummary(unitId: string) {
    return this.request<{ success: boolean; summary: UnitAggregateSummary }>(
      `/api/command/summary?unitId=${encodeURIComponent(unitId)}`,
    );
  }

  // --- Interventions --------------------------------------------------------

  getInterventions() {
    return this.request<{ success: boolean; interventions: InterventionItem[] }>('/api/interventions');
  }

  updateInterventionAction(id: string, action: 'approve' | 'dismiss' | 'complete', officerNotes?: string) {
    return this.request<{ success: boolean; intervention: Partial<InterventionItem> }>(
      `/api/interventions/${id}/action`,
      { method: 'POST', body: JSON.stringify({ action, officerNotes }) },
    );
  }

  // --- Simulator ------------------------------------------------------------

  runWhatIfSimulation(input: WhatIfSimulationInput) {
    return this.request<{
      success: boolean;
      simulation: {
        baselineRisk: number;
        simulatedRisk: number;
        riskDelta: number;
        baselineBand: 'routine' | 'watch' | 'review';
        simulatedBand: 'routine' | 'watch' | 'review';
        confidenceInterval: [number, number];
        shapWaterfallBefore: Attribution[];
        shapWaterfallAfter: Attribution[];
        projectedTrajectory: Array<{ day: string; baseline: number; simulated: number }>;
        clinicalRationale: string;
        attributionShift: Array<{ feature: string; name: string; before: number; after: number; shift: number }>;
        appliedLevers: Array<{ key: string; label: string; delta: number; unit: string }>;
      };
    }>('/api/simulator/what-if', { method: 'POST', body: JSON.stringify(input) });
  }

  // --- Model ----------------------------------------------------------------

  getModelHealth() {
    return this.request<{ success: boolean; health: ModelHealthMetrics & Record<string, unknown> }>(
      '/api/model/health',
    );
  }

  getModelCard() {
    return this.request<{ success: boolean; card: Record<string, unknown>; metrics: Record<string, unknown>; playbook: unknown[] }>(
      '/api/model/card',
    );
  }

  explain(features: Record<string, number>) {
    return this.request<{ success: boolean; assessment: AssessmentDetail; recommendations: Recommendation[] }>(
      '/api/model/explain',
      { method: 'POST', body: JSON.stringify(features) },
    );
  }

  // --- Audit & ops ----------------------------------------------------------

  getAuditLogs(action?: string, limit = 120) {
    const params = new URLSearchParams();
    if (action) params.set('action', action);
    params.set('limit', String(limit));
    return this.request<{
      success: boolean;
      logs: AuditLogEntry[];
      totalCount: number;
      tamperEvidentHash: string;
      chainValid: boolean;
      chainBrokenAtSeq: number | null;
      chainReason: string | null;
      kAnonymityEnforcedCount: number;
    }>(`/api/audit/logs?${params}`);
  }

  verifyAuditChain() {
    return this.request<{
      success: boolean;
      verification: { valid: boolean; entries: number; brokenAtSeq: number | null; reason: string | null; headHash: string };
    }>('/api/audit/verify');
  }

  getHealth() {
    return this.request<{
      status: string;
      uptimeSeconds: number;
      storage: { engine: string; warning: string | null };
      model: { version: string; trainedAt: string };
      audit: { entries: number; chainValid: boolean };
      streams: number;
      gemini: boolean;
    }>('/api/health');
  }

  importHR(records: SyntheticHRRecord[]) {
    return this.request<{ success: boolean; result: { totalImported: number; flaggedCount: number } }>(
      '/api/hr-import',
      { method: 'POST', body: JSON.stringify({ records }) },
    );
  }

  resetSystem() {
    return this.request<{ success: boolean; message: string }>('/api/system/reset', { method: 'POST' });
  }

  searchSOP(query: string) {
    return this.request<{ answer: string; sources: string[]; mode: string }>('/api/rag/sop-search', {
      method: 'POST',
      body: JSON.stringify({ query }),
    });
  }
}

export const api = new SaharaApiClient();
