import {
  ForceWelfareOverview,
  UnitHeatmapItem,
  PersonnelRiskProfile,
  InterventionItem,
  AuditLogEntry
} from '../../src/types.js';

export const initialForceOverview: ForceWelfareOverview = {
  totalMonitored: 1842,
  lowRisk: 1432,
  moderateRisk: 318,
  highRisk: 92,
  criticalTrendAlerts: 17,
  readinessScore: 88.4,
  riskDistribution: [
    { name: 'Routine (Low)', count: 1432, color: '#10b981', percent: 77.7 },
    { name: 'Watch (Moderate)', count: 318, color: '#f59e0b', percent: 17.3 },
    { name: 'Review (High)', count: 92, color: '#f43f5e', percent: 5.0 }
  ],
  alertVelocity: [
    { date: 'Sep 06', newAlerts: 3, resolved: 4, activeTotal: 15 },
    { date: 'Sep 07', newAlerts: 4, resolved: 3, activeTotal: 16 },
    { date: 'Sep 08', newAlerts: 6, resolved: 5, activeTotal: 17 },
    { date: 'Sep 09', newAlerts: 5, resolved: 4, activeTotal: 18 },
    { date: 'Sep 10', newAlerts: 7, resolved: 6, activeTotal: 19 },
    { date: 'Sep 11', newAlerts: 5, resolved: 7, activeTotal: 17 },
    { date: 'Sep 12', newAlerts: 4, resolved: 4, activeTotal: 17 }
  ],
  systemicHotspots: [
    { unitName: '7th Reconnaissance Troop', riskScore: 64, primaryFactor: 'Continuous 13.2h average shifts + high night patrol ratio', trend: 'rising' },
    { unitName: '204th Strike Regiment', riskScore: 58, primaryFactor: 'Cumulative deployment duration (52 days) + 42% night watch', trend: 'rising' },
    { unitName: '102nd Mountain Battalion', riskScore: 42, primaryFactor: 'Post-deployment rotation backlog in Bravo Company', trend: 'stable' }
  ]
};

export const initialUnitHeatmap: UnitHeatmapItem[] = [
  {
    id: 'unit-102',
    unitName: '102nd Mountain Battalion',
    sector: 'Northern Sector / High Altitude',
    personnelCount: 150,
    riskScore: 42,
    band: 'watch',
    isSuppressed: false,
    avgShiftHours: 10.4,
    nightShiftRatio: 34,
    deploymentDurationDays: 44,
    trendDirection: 'stable',
    weeklyTrend: [38, 39, 41, 40, 42, 43, 42]
  },
  {
    id: 'unit-204',
    unitName: '204th Strike Regiment',
    sector: 'Forward Operational Zone',
    personnelCount: 210,
    riskScore: 58,
    band: 'watch',
    isSuppressed: false,
    avgShiftHours: 12.1,
    nightShiftRatio: 42,
    deploymentDurationDays: 52,
    trendDirection: 'rising',
    weeklyTrend: [44, 47, 50, 52, 55, 56, 58]
  },
  {
    id: 'unit-501',
    unitName: '501st Air Defense Brigade',
    sector: 'Base Perimeter Command',
    personnelCount: 180,
    riskScore: 31,
    band: 'routine',
    isSuppressed: false,
    avgShiftHours: 8.5,
    nightShiftRatio: 18,
    deploymentDurationDays: 28,
    trendDirection: 'declining',
    weeklyTrend: [35, 34, 33, 32, 32, 31, 31]
  },
  {
    id: 'unit-007',
    unitName: '7th Reconnaissance Troop',
    sector: 'Remote Border Surveillance',
    personnelCount: 95,
    riskScore: 67,
    band: 'review',
    isSuppressed: false,
    avgShiftHours: 13.2,
    nightShiftRatio: 48,
    deploymentDurationDays: 61,
    trendDirection: 'rising',
    weeklyTrend: [49, 52, 56, 60, 62, 65, 67]
  },
  {
    id: 'unit-033',
    unitName: '33rd Logistics Support Wing',
    sector: 'Rear Supply Depot',
    personnelCount: 240,
    riskScore: 26,
    band: 'routine',
    isSuppressed: false,
    avgShiftHours: 8.0,
    nightShiftRatio: 12,
    deploymentDurationDays: 14,
    trendDirection: 'stable',
    weeklyTrend: [28, 27, 26, 27, 26, 25, 26]
  },
  {
    id: 'unit-099',
    unitName: 'Detachment Alpha (Small Outpost)',
    sector: 'Classified Mountain Observation Post',
    personnelCount: 4,
    riskScore: 0, // Suppressed by k-anonymity (k < 10)
    band: 'routine',
    isSuppressed: true,
    avgShiftHours: 0,
    nightShiftRatio: 0,
    deploymentDurationDays: 0,
    trendDirection: 'stable',
    weeklyTrend: [0, 0, 0, 0, 0, 0, 0]
  }
];

export const initialPersonnelProfiles: Record<string, PersonnelRiskProfile> = {
  'p-014': {
    id: 'p-014',
    pseudonymToken: 'TOKEN-E9F2A8',
    realNameMasked: 'Rajesh Verma (Constable)',
    unitId: 'unit-102',
    unitName: '102nd Mountain Battalion (Bravo Coy)',
    rank: 'Constable',
    welfareRiskIndex: 78,
    band: 'review',
    confidenceInterval: [74, 82],
    temporalTrajectory: [
      {
        step: 1,
        date: '2026-09-06',
        label: 'Normal welfare profile',
        riskScore: 34,
        description: 'Baseline equilibrium. 7.5h sleep, 8h day shift, low physiological strain.',
        dutyHours: 8,
        sleepHours: 7.5,
        nightShift: false
      },
      {
        step: 2,
        date: '2026-09-08',
        label: 'Deployment extends',
        riskScore: 46,
        description: 'Continuous mountain deployment extended past 40 days. Duty load elevated to 10h.',
        dutyHours: 10,
        sleepHours: 6.5,
        nightShift: false
      },
      {
        step: 3,
        date: '2026-09-10',
        label: 'Night duties increase',
        riskScore: 61,
        description: 'Consecutive night patrols assigned. Circadian rhythm disruption and sleep drops to 4.5h.',
        dutyHours: 14,
        sleepHours: 4.5,
        nightShift: true
      },
      {
        step: 4,
        date: '2026-09-12',
        label: 'Rest decreases — Critical alert',
        riskScore: 78,
        description: '3rd consecutive night shift without recovery. Acute fatigue compounding with sleep deficit.',
        dutyHours: 13,
        sleepHours: 4.0,
        nightShift: true
      }
    ],
    shapBaseValue: 32.0,
    shapFactors: [
      {
        feature: 'sleep_deficit_hours',
        name: 'Acute Sleep Deficit',
        value: '4.0h vs 7.5h baseline (-3.5h)',
        impact: 18.5,
        direction: 'increases_risk',
        category: 'sleep'
      },
      {
        feature: 'consecutive_night_shifts',
        name: 'Consecutive Night Shifts',
        value: '3 consecutive night watch rotations',
        impact: 14.2,
        direction: 'increases_risk',
        category: 'schedule'
      },
      {
        feature: 'duty_hours_rolling_7d',
        name: 'Cumulative Duty Overtime',
        value: '79 hours in past 7 days (avg 11.3h/day)',
        impact: 9.4,
        direction: 'increases_risk',
        category: 'schedule'
      },
      {
        feature: 'days_deployed_continuous',
        name: 'Continuous Deployment Duration',
        value: '48 continuous operational field days',
        impact: 7.1,
        direction: 'increases_risk',
        category: 'operational'
      },
      {
        feature: 'days_since_rest_day',
        name: 'Consecutive Days Without Rest',
        value: '11 days without full 24h rest window',
        impact: 5.8,
        direction: 'increases_risk',
        category: 'schedule'
      },
      {
        feature: 'physical_conditioning_index',
        name: 'Physical Conditioning Factor',
        value: 'Exemplary cardio fitness reserve',
        impact: -3.2,
        direction: 'decreases_risk',
        category: 'physiological'
      },
      {
        feature: 'unit_peer_support_network',
        name: 'Cohesive Squad Dynamics',
        value: 'High mutual cohesion in squad section',
        impact: -5.8,
        direction: 'decreases_risk',
        category: 'operational'
      }
    ],
    activeCaseId: 'case-p014'
  },
  'p-008': {
    id: 'p-008',
    pseudonymToken: 'TOKEN-A4C719',
    realNameMasked: 'Amit Sharma (Lance Naik)',
    unitId: 'unit-102',
    unitName: '102nd Mountain Battalion',
    rank: 'Lance Naik',
    welfareRiskIndex: 28,
    band: 'routine',
    confidenceInterval: [24, 32],
    temporalTrajectory: [
      {
        step: 1,
        date: '2026-09-06',
        label: 'Stable duty roster',
        riskScore: 29,
        description: 'Consistent 8h day duty, 7.5h restorative sleep.',
        dutyHours: 8,
        sleepHours: 7.5,
        nightShift: false
      },
      {
        step: 2,
        date: '2026-09-08',
        label: 'Regular rest cycle',
        riskScore: 26,
        description: 'Scheduled rest interval observed.',
        dutyHours: 6,
        sleepHours: 8.0,
        nightShift: false
      },
      {
        step: 3,
        date: '2026-09-10',
        label: 'Normal patrol assignment',
        riskScore: 30,
        description: 'Standard perimeter guard rotation.',
        dutyHours: 8,
        sleepHours: 7.2,
        nightShift: false
      },
      {
        step: 4,
        date: '2026-09-12',
        label: 'Optimal welfare baseline',
        riskScore: 28,
        description: 'No significant occupational strain detected.',
        dutyHours: 8,
        sleepHours: 7.5,
        nightShift: false
      }
    ],
    shapBaseValue: 32.0,
    shapFactors: [
      {
        feature: 'sleep_deficit_hours',
        name: 'Sleep Quantity',
        value: '7.5h (within 0.2h of optimal)',
        impact: -2.1,
        direction: 'decreases_risk',
        category: 'sleep'
      },
      {
        feature: 'consecutive_night_shifts',
        name: 'Night Shifts',
        value: '0 night shifts in last 7 days',
        impact: -1.5,
        direction: 'decreases_risk',
        category: 'schedule'
      }
    ]
  },
  'p-022': {
    id: 'p-022',
    pseudonymToken: 'TOKEN-B31F90',
    realNameMasked: 'Manoj Rao (Havildar)',
    unitId: 'unit-102',
    unitName: '102nd Mountain Battalion',
    rank: 'Havildar',
    welfareRiskIndex: 58,
    band: 'watch',
    confidenceInterval: [53, 63],
    temporalTrajectory: [
      {
        step: 1,
        date: '2026-09-06',
        label: 'Standard operational load',
        riskScore: 40,
        description: 'Section leadership duties, 9h shift.',
        dutyHours: 9,
        sleepHours: 6.8,
        nightShift: false
      },
      {
        step: 2,
        date: '2026-09-08',
        label: 'Family communication disruption',
        riskScore: 48,
        description: 'Remote sector communication blackout elevated perceived stress.',
        dutyHours: 10,
        sleepHours: 5.5,
        nightShift: false
      },
      {
        step: 3,
        date: '2026-09-10',
        label: 'Watch rotation added',
        riskScore: 54,
        description: 'Split-shift night surveillance rotation.',
        dutyHours: 11,
        sleepHours: 5.0,
        nightShift: true
      },
      {
        step: 4,
        date: '2026-09-12',
        label: 'Self-initiated support request',
        riskScore: 58,
        description: 'Personnel requested confidential conversation with welfare officer.',
        dutyHours: 10,
        sleepHours: 5.2,
        nightShift: false
      }
    ],
    shapBaseValue: 32.0,
    shapFactors: [
      {
        feature: 'self_reported_stress',
        name: 'Elevated Perceived Stress',
        value: 'Self-reported 4/5 with support request',
        impact: 14.8,
        direction: 'increases_risk',
        category: 'operational'
      },
      {
        feature: 'sleep_deficit_hours',
        name: 'Moderate Sleep Shortfall',
        value: '5.2h vs 7.0h baseline',
        impact: 8.5,
        direction: 'increases_risk',
        category: 'sleep'
      },
      {
        feature: 'consecutive_night_shifts',
        name: 'Night Watch Assignment',
        value: '1 night patrol in last 48h',
        impact: 4.2,
        direction: 'increases_risk',
        category: 'schedule'
      }
    ],
    activeCaseId: 'case-p022'
  }
};

export const initialInterventions: InterventionItem[] = [
  {
    id: 'int-001',
    title: 'Mandatory 48-Hour Circadian Rest & Recovery Window',
    category: 'rest',
    status: 'recommended',
    targetPersonnelId: 'p-014',
    targetPersonnelToken: 'TOKEN-E9F2A8',
    targetUnitName: '102nd Mountain Battalion (Bravo Coy)',
    urgency: 'high',
    projectedRiskReduction: 32,
    preInterventionRisk: 78,
    policyCitation: 'SOP-WEL-02: Acute Fatigue & Night Shift Governance §4.2',
    ragEvidenceQuote: 'Personnel completing three consecutive night duty watches with severe acute sleep deficit (<4.5h) must be placed on an immediate 48-hour de-escalation recovery cycle prior to resuming active surveillance.',
    officerNotes: 'Pending approval by Subedar Arjun Kumar (Welfare Officer).'
  },
  {
    id: 'int-002',
    title: 'Immediate Watch Roster Swap & Shift Cap (Max 8h)',
    category: 'schedule',
    status: 'recommended',
    targetPersonnelId: 'p-014',
    targetPersonnelToken: 'TOKEN-E9F2A8',
    targetUnitName: '102nd Mountain Battalion (Bravo Coy)',
    urgency: 'high',
    projectedRiskReduction: 18,
    preInterventionRisk: 78,
    policyCitation: 'Forces Operational Readiness & Workload Directive 2024 §7.1',
    ragEvidenceQuote: 'Company commanders must immediately rebalance operational guard rotas when cumulative 7-day duty load exceeds 70 hours for individual riflemen.',
    officerNotes: 'Coordinates replacement watch personnel from Reserve Section.'
  },
  {
    id: 'int-003',
    title: 'Confidential 1-on-1 Welfare Officer Consultation',
    category: 'clinical',
    status: 'approved',
    targetPersonnelId: 'p-022',
    targetPersonnelToken: 'TOKEN-B31F90',
    targetUnitName: '102nd Mountain Battalion',
    urgency: 'medium',
    projectedRiskReduction: 14,
    preInterventionRisk: 58,
    approvedBy: 'Subedar Arjun Kumar (Welfare Officer)',
    approvedAt: '2026-09-12T07:15:00Z',
    policyCitation: 'SOP-WEL-03: Voluntary Welfare Counseling Protocol §2',
    ragEvidenceQuote: 'Any self-initiated personnel support request triggers an immediate priority welfare case. The assigned welfare officer must conduct an initial confidential informal inquiry within 24 hours.',
    officerNotes: 'Scheduled for 14:00 today in Battalion Welfare Office.'
  },
  {
    id: 'int-004',
    title: 'Unit Workload Rebalancing — 7th Reconnaissance Troop',
    category: 'command',
    status: 'recommended',
    targetPersonnelId: 'cohort-007',
    targetPersonnelToken: 'COHORT-7TH-RECON',
    targetUnitName: '7th Reconnaissance Troop',
    urgency: 'high',
    projectedRiskReduction: 21,
    preInterventionRisk: 67,
    policyCitation: 'SOP-WEL-01: Post-Deployment Rest Cycles §1.4',
    ragEvidenceQuote: 'Surveillance units deployed in continuous high-altitude conditions exceeding 60 days must receive staggered 72-hour de-escalation windows.',
    officerNotes: 'Command level recommendation dispatched to Sector HQ.'
  }
];

export const initialAuditLogs: AuditLogEntry[] = [
  {
    id: 'aud-001',
    timestamp: '2026-09-12T09:14:22Z',
    actorId: 'wo-kumar',
    actorName: 'Subedar Arjun Kumar',
    actorRole: 'Welfare Officer',
    action: 'VIEW_PERSONNEL_DOSSIER',
    resource: 'Personnel Record [TOKEN-E9F2A8]',
    justification: 'Automated Tier-3 Critical Strain Alert (Score 78)',
    privacyFilterEnforced: 'Pseudonymized Token Enforced & Audit Hash Generated'
  },
  {
    id: 'aud-002',
    timestamp: '2026-09-12T08:50:11Z',
    actorId: 'cmd-singh',
    actorName: 'Col. Harpreet Singh',
    actorRole: 'Command Viewer',
    action: 'VIEW_COMMAND_OVERVIEW',
    resource: 'Force Welfare Overview (1,842 personnel)',
    justification: 'Weekly Operational Readiness Review',
    privacyFilterEnforced: 'Strict k-Anonymity (k>=10) Enforced; Individual records masked'
  },
  {
    id: 'aud-003',
    timestamp: '2026-09-12T08:45:00Z',
    actorId: 'cmd-singh',
    actorName: 'Col. Harpreet Singh',
    actorRole: 'Command Viewer',
    action: 'ACCESS_ATTEMPT_SUPPRESSED',
    resource: 'Detachment Alpha (Small Outpost, 4 personnel)',
    justification: 'Unit inspection request',
    privacyFilterEnforced: 'BLOCKED: k-Anonymity Violation (k=4 < 10). Metric suppression active.'
  },
  {
    id: 'aud-004',
    timestamp: '2026-09-12T07:15:00Z',
    actorId: 'wo-kumar',
    actorName: 'Subedar Arjun Kumar',
    actorRole: 'Welfare Officer',
    action: 'AUTHORIZE_INTERVENTION',
    resource: 'Intervention int-003 for [TOKEN-B31F90]',
    justification: 'Direct Personnel Support Request Initiated',
    privacyFilterEnforced: 'Officer Authorization Logged with Non-Punitive Clause'
  },
  {
    id: 'aud-005',
    timestamp: '2026-09-12T06:30:15Z',
    actorId: 'p-014',
    actorName: 'Personnel P-014',
    actorRole: 'Personnel',
    action: 'SUBMIT_DAILY_CHECKIN',
    resource: 'Daily Health & Strain Metrics (Sep 12)',
    justification: 'Routine Morning Check-in under Section 14 Privacy Directive',
    privacyFilterEnforced: 'Encrypted at Rest; Non-Punitive Protections Applied'
  }
];
