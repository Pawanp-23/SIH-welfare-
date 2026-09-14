import { UnitAggregateSummary } from '../../src/types.js';

export const MINIMUM_COHORT_SIZE = 10;

export function evaluateCohortSuppression(
  unitId: string,
  unitName: string,
  personnelCount: number,
  activeCheckinsCount: number,
  dutyHoursList: number[],
  consecutiveNightShiftCount: number,
  openCasesCount: number,
  resolvedCasesCount: number,
  rawDailyTrends: Array<{ date: string; dutyHours: number[]; nightCount: number }>
): UnitAggregateSummary {
  // If smaller than k=10 threshold, suppress all sensitive metrics!
  if (personnelCount < MINIMUM_COHORT_SIZE) {
    return {
      unitId,
      unitName,
      totalPersonnel: personnelCount,
      isSuppressed: true,
      activeCheckinCoverage: 0,
      avgDutyHours: 0,
      consecutiveNightShiftPersonnel: 0,
      openWelfareCases: 0,
      resolvedWelfareCasesThisMonth: 0,
      workloadTrend: [],
      suppressionNotice: `Protected Group Notice: Cohort has only ${personnelCount} personnel (minimum threshold is ${MINIMUM_COHORT_SIZE}). Aggregated indicators are suppressed to prevent identity disclosure.`
    };
  }

  // Calculate permissible aggregates for authorized cohorts
  const avgDuty =
    dutyHoursList.length > 0
      ? Math.round((dutyHoursList.reduce((a, b) => a + b, 0) / dutyHoursList.length) * 10) / 10
      : 8.0;

  const coverage = Math.min(100, Math.round((activeCheckinsCount / Math.max(1, personnelCount)) * 100));

  const workloadTrend = rawDailyTrends.map((day) => ({
    date: day.date,
    avgDutyHours:
      day.dutyHours.length > 0
        ? Math.round((day.dutyHours.reduce((a, b) => a + b, 0) / day.dutyHours.length) * 10) / 10
        : 8.0,
    nightShiftCount: day.nightCount
  }));

  return {
    unitId,
    unitName,
    totalPersonnel: personnelCount,
    isSuppressed: false,
    activeCheckinCoverage: coverage,
    avgDutyHours: avgDuty,
    consecutiveNightShiftPersonnel: consecutiveNightShiftCount,
    openWelfareCases: openCasesCount,
    resolvedWelfareCasesThisMonth: resolvedCasesCount,
    workloadTrend
  };
}
