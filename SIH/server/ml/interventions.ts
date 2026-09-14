/**
 * Evidence-linked intervention recommender.
 *
 * The recommendation is *derived from the prediction's own SHAP attribution*,
 * not chosen by a rule on the band. That matters: two people with an identical
 * WRI of 71 can need opposite things, and a system that gives them the same
 * advice will be ignored by the officers who have to act on it.
 *
 * Every recommendation quantifies its projected effect by actually running the
 * counterfactual back through the model, so the number shown to a commander is
 * a model output, never a guess.
 */

import { FEATURE_INDEX, buildFeatures, simulate, type Attribution, type FeatureInput, type Lever } from './engine.js';

export interface PlaybookEntry {
  id: string;
  /** the model feature this intervention acts on */
  driver: string;
  title: string;
  category: 'rest' | 'schedule' | 'clinical' | 'command' | 'social';
  urgency: 'high' | 'medium' | 'routine';
  /** the counterfactual this intervention represents, in feature space */
  levers: Lever[];
  action: string;
  evidence: string;
  citation: string;
  owner: 'Unit Commander' | 'Welfare Officer' | 'Medical Officer' | 'Adjutant';
  effortDays: number;
}

/**
 * Each entry pairs a *mechanism* (what changes in feature space) with a
 * *policy hook* (who can authorise it and under what standing instruction).
 * Without the second half a recommendation is unactionable inside a chain of
 * command, which is the usual reason welfare tooling gets abandoned.
 */
export const PLAYBOOK: PlaybookEntry[] = [
  {
    id: 'iv-sleep-window',
    driver: 'sleep_debt_7d',
    title: 'Protected 8-hour sleep window for 5 nights',
    category: 'rest',
    urgency: 'high',
    levers: [
      { key: 'sleep_hours_7d_avg', label: 'Avg sleep', delta: +1.6, unit: 'h' },
      { key: 'sleep_debt_7d', label: 'Sleep debt', delta: -11, unit: 'h' },
    ],
    action:
      'Roster a guaranteed uninterrupted 8-hour rest block, insulated from callout duty, for five consecutive nights.',
    evidence:
      'Recovery sleep restores psychomotor vigilance within 3-5 nights; cumulative debt does not clear with a single long sleep.',
    citation: 'Van Dongen et al., Sleep (2003) 26(2):117-126',
    owner: 'Unit Commander',
    effortDays: 5,
  },
  {
    id: 'iv-night-rotation',
    driver: 'consecutive_night_shifts',
    title: 'Break the night-shift run; rotate forward',
    category: 'schedule',
    urgency: 'high',
    levers: [{ key: 'consecutive_night_shifts', label: 'Consecutive nights', delta: -3, unit: '' }],
    action:
      'Cap the consecutive night run at 3 and rotate the shift pattern forward (day to evening to night) rather than backward.',
    evidence:
      'Forward-rotating schedules with runs capped at 3-4 nights reduce circadian misalignment and fatigue-related error rates.',
    citation: 'Folkard & Tucker, Occupational Medicine (2003) 53(2):95-101',
    owner: 'Adjutant',
    effortDays: 3,
  },
  {
    id: 'iv-rest-day',
    driver: 'days_since_rest_day',
    title: 'Authorise an immediate 48-hour stand-down',
    category: 'rest',
    urgency: 'high',
    levers: [{ key: 'days_since_rest_day', label: 'Days since rest', delta: -14, unit: 'd' }],
    action:
      'Grant a 48-hour continuous stand-down within the next 72 hours, backfilled from the reserve section.',
    evidence:
      'Continuous duty beyond 12 days without a rest day is associated with a steep rise in reported exhaustion and disciplinary incidents.',
    citation: 'Adler et al., J Occupational Health Psychology (2005) 10(2):121-137',
    owner: 'Unit Commander',
    effortDays: 2,
  },
  {
    id: 'iv-duty-load',
    driver: 'overtime_hours_7d',
    title: 'Reduce weekly duty load by 10 hours',
    category: 'schedule',
    urgency: 'medium',
    levers: [
      { key: 'duty_hours_7d_avg', label: 'Avg duty hours', delta: -1.5, unit: 'h/day' },
      { key: 'overtime_hours_7d', label: 'Overtime', delta: -10, unit: 'h' },
    ],
    action:
      'Redistribute static-post hours across the section to bring the seven-day average under 9 hours per day.',
    evidence:
      'Sustained working weeks beyond 55 hours show a dose-response relationship with anxiety and depressive symptoms.',
    citation: 'Virtanen et al., PLoS ONE (2012) 7(1):e30719',
    owner: 'Adjutant',
    effortDays: 7,
  },
  {
    id: 'iv-family-contact',
    driver: 'days_since_family_contact',
    title: 'Priority family communication slot',
    category: 'social',
    urgency: 'medium',
    levers: [{ key: 'days_since_family_contact', label: 'Days since contact', delta: -10, unit: 'd' }],
    action:
      'Allocate a scheduled, private 30-minute video call slot twice weekly with guaranteed bandwidth priority.',
    evidence:
      'Maintained family contact during deployment is consistently protective against deployment-related distress.',
    citation: 'Greene et al., Military Medicine (2010) 175(10):745-750',
    owner: 'Welfare Officer',
    effortDays: 1,
  },
  {
    id: 'iv-cohesion',
    driver: 'peer_cohesion_score',
    title: 'Structured peer-support pairing',
    category: 'social',
    urgency: 'medium',
    levers: [{ key: 'peer_cohesion_score', label: 'Unit cohesion', delta: +0.9, unit: '1-5' }],
    action:
      'Pair with a trained buddy from the same section and schedule two facilitated section debriefs this fortnight.',
    evidence:
      'Perceived unit cohesion is among the strongest moderators of the deployment-stress to psychiatric-outcome pathway.',
    citation: 'Brailey et al., Military Psychology (2007) 19(1):1-19',
    owner: 'Welfare Officer',
    effortDays: 14,
  },
  {
    id: 'iv-leave',
    driver: 'leave_denied_6m',
    title: 'Escalate pending leave application',
    category: 'command',
    urgency: 'high',
    levers: [{ key: 'leave_denied_6m', label: 'Leave denied', delta: -2, unit: '' }],
    action:
      'Route the pending application for out-of-turn sanction with a written reason recorded either way.',
    evidence:
      'Repeated leave denial is one of the most frequently cited grievances preceding welfare incidents in Indian CAPF reviews.',
    citation: 'Parliamentary Standing Committee on Home Affairs, 205th Report (2018)',
    owner: 'Unit Commander',
    effortDays: 3,
  },
  {
    id: 'iv-medical',
    driver: 'hrv_rmssd_ms',
    title: 'Medical officer review — autonomic load',
    category: 'clinical',
    urgency: 'high',
    levers: [{ key: 'hrv_rmssd_ms', label: 'HRV (RMSSD)', delta: +8, unit: 'ms' }],
    action:
      'Book a medical officer consultation covering sleep quality, resting heart rate trend and stimulant use.',
    evidence:
      'Suppressed RMSSD alongside elevated resting heart rate indicates sustained sympathetic dominance and warrants clinical review.',
    citation: 'Kim et al., Psychiatry Investigation (2018) 15(3):235-245',
    owner: 'Medical Officer',
    effortDays: 2,
  },
  {
    id: 'iv-deployment-rotation',
    driver: 'deployment_days_continuous',
    title: 'Schedule rotation out of forward posting',
    category: 'command',
    urgency: 'medium',
    levers: [{ key: 'deployment_days_continuous', label: 'Continuous deployment', delta: -60, unit: 'd' }],
    action:
      'Place on the next relief roster for rotation to a rear posting; confirm a date rather than an intent.',
    evidence:
      'Deployment length shows a monotonic relationship with post-deployment mental health difficulty.',
    citation: 'Rona et al., BMJ (2007) 335:603',
    owner: 'Unit Commander',
    effortDays: 30,
  },
  {
    id: 'iv-grievance',
    driver: 'grievance_pending',
    title: 'Close out the open grievance within 7 days',
    category: 'command',
    urgency: 'high',
    levers: [{ key: 'grievance_pending', label: 'Pending grievance', delta: -1, unit: '' }],
    action:
      'Assign the pending grievance to a named officer with a 7-day disposal deadline and inform the applicant of the outcome.',
    evidence:
      'Unresolved procedural grievance sustains perceived organisational injustice, itself an independent predictor of distress.',
    citation: 'Ndjaboué et al., Occup Environ Med (2012) 69(10):694-700',
    owner: 'Unit Commander',
    effortDays: 7,
  },
  {
    id: 'iv-stress-followup',
    driver: 'perceived_stress',
    title: 'Welfare officer conversation within 48 hours',
    category: 'clinical',
    urgency: 'high',
    levers: [{ key: 'perceived_stress', label: 'Self-reported stress', delta: -0.8, unit: '1-5' }],
    action:
      'Hold a private, non-recorded welfare conversation; offer counselling referral without requiring it.',
    evidence:
      'Early low-threshold contact improves help-seeking; mandatory referral suppresses disclosure in uniformed populations.',
    citation: 'Sharp et al., Epidemiologic Reviews (2015) 37:144-162',
    owner: 'Welfare Officer',
    effortDays: 2,
  },
];

const BY_DRIVER = new Map(PLAYBOOK.map((p) => [p.driver, p]));

export interface Recommendation extends PlaybookEntry {
  /** measured by re-running the model, not asserted */
  projectedRiskReduction: number;
  preRisk: number;
  postRisk: number;
  bandBefore: string;
  bandAfter: string;
  /** the SHAP contribution of the driver that triggered this recommendation */
  triggerImpact: number;
  triggerValue: string;
  rationale: string;
}

/**
 * Rank interventions by *measured* counterfactual effect on this individual.
 *
 * Note the ordering: we consider only drivers that actually pushed this
 * person's risk up, then score each candidate intervention by simulating it.
 * An intervention that the model says will not help this person does not get
 * recommended to this person, however sensible it looks in the abstract.
 */
export function recommend(
  features: FeatureInput,
  drivers: Attribution[],
  limit = 4,
): Recommendation[] {
  const candidates: PlaybookEntry[] = [];
  const seen = new Set<string>();

  for (const d of drivers) {
    if (d.impact <= 0) continue;
    const entry = BY_DRIVER.get(d.feature);
    if (entry && !seen.has(entry.id)) {
      candidates.push(entry);
      seen.add(entry.id);
    }
  }

  // If the drivers map to nothing in the playbook (possible when the top
  // drivers are demographic), fall back to the universally safe contact.
  if (candidates.length === 0) {
    const fallback = BY_DRIVER.get('perceived_stress');
    if (fallback) candidates.push(fallback);
  }

  const driverMap = new Map(drivers.map((d) => [d.feature, d]));
  const built = buildFeatures(features);

  const scored: Recommendation[] = candidates
    .filter((c) => c.levers.every((l) => FEATURE_INDEX[l.key] !== undefined))
    .map((entry) => {
      const outcome = simulate(features, entry.levers);
      const trigger = driverMap.get(entry.driver);
      const reduction = Number((outcome.before.wri - outcome.after.wri).toFixed(1));

      const topShift = outcome.attributionShift[0];
      const rationale = trigger
        ? `${trigger.name} is contributing +${trigger.impact.toFixed(1)} WRI points for this individual ` +
          `(currently ${trigger.value}, around the ${Math.round(trigger.percentile * 100)}th percentile of the ` +
          `training cohort). Simulating this intervention moves the index from ${outcome.before.wri} to ` +
          `${outcome.after.wri}` +
          (topShift ? `, mostly by reducing the ${topShift.name.toLowerCase()} contribution.` : '.')
        : `Simulating this intervention moves the index from ${outcome.before.wri} to ${outcome.after.wri}.`;

      return {
        ...entry,
        projectedRiskReduction: reduction,
        preRisk: outcome.before.wri,
        postRisk: outcome.after.wri,
        bandBefore: outcome.before.band,
        bandAfter: outcome.after.band,
        triggerImpact: trigger?.impact ?? 0,
        triggerValue: trigger?.value ?? '—',
        rationale,
      };
    })
    .filter((r) => r.projectedRiskReduction > 0.2)
    .sort((a, b) => b.projectedRiskReduction - a.projectedRiskReduction);

  void built;
  return scored.slice(0, limit);
}

/**
 * A combined plan: the model's estimate of applying the top interventions
 * together, which is *not* the sum of their individual effects because the
 * ensemble is non-additive. Showing both numbers is the honest thing to do.
 */
export function combinedPlan(features: FeatureInput, recs: Recommendation[]) {
  const levers = recs.flatMap((r) => r.levers);
  if (levers.length === 0) return null;
  const outcome = simulate(features, levers);
  const naiveSum = recs.reduce((s, r) => s + r.projectedRiskReduction, 0);
  return {
    combinedRiskReduction: Number((outcome.before.wri - outcome.after.wri).toFixed(1)),
    naiveSumOfIndividualEffects: Number(naiveSum.toFixed(1)),
    interactionNote:
      'The combined effect is smaller than the sum of the individual effects because the interventions ' +
      'act on overlapping pathways — the model captures that interaction rather than double counting it.',
    outcome,
  };
}
