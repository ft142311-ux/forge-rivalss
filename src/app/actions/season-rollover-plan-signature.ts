import { createHash } from 'node:crypto';
import { validateRolloverPlan } from './season-rollover-plan';

/**
 * Server-side fingerprint for an immutable recovery placement decision.
 * Kept outside the shared plan validator because that validator is also
 * imported by client-facing archive readers.
 */
function stablePlanValue(value: any): any {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(stablePlanValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stablePlanValue(value[key])]));
  }
  return value;
}

export function getRecoveryRolloverPlanSignature(plan: any): string | null {
  const validation = validateRolloverPlan(plan, Number(plan?.sourceSeason), Number(plan?.targetSeason));
  if (!validation.valid || plan?.mode !== 'recovery_carry_forward') return null;
  const fields = ['leagueId', 'mode', 'sourceSeason', 'targetSeason', 'skippedSeasons',
    'lastTrustedSeason', 'placementSource', 'retainedArchiveSeason', 'promotionRule', 'groups'];
  const canonical = JSON.stringify(Object.fromEntries(fields.map(field => [field, stablePlanValue(plan[field])])));
  return createHash('sha256').update(canonical).digest('hex');
}
