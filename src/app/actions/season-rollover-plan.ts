// Kept local so this pure validator can be exercised without the Next.js path alias.
const MAX_LEVELS = 4;
const TEAMS_PER_GROUP = 8;
const TOTAL_GROUPS = 15;

export function expectedRolloverGroups() {
  const groups: string[] = [];
  for (let level = 1; level <= MAX_LEVELS; level++) {
    for (let group = 1; group <= Math.pow(2, level - 1); group++) groups.push(`D${level}-G${group}`);
  }
  return groups;
}

export function validateRolloverPlan(plan: any, sourceSeason: number, targetSeason: number) {
  if (!plan || plan.ready !== true || Number(plan.sourceSeason) !== sourceSeason || Number(plan.targetSeason) !== targetSeason) {
    return { valid: false, reason: 'ROLLOVER_PLAN_METADATA_INVALID' };
  }
  const groups = plan.groups && typeof plan.groups === 'object' ? plan.groups : null;
  const expected = expectedRolloverGroups();
  if (!groups || Object.keys(groups).length !== TOTAL_GROUPS || expected.some(key => !Array.isArray(groups[key]))) {
    return { valid: false, reason: 'ROLLOVER_PLAN_GROUPS_INCOMPLETE' };
  }
  const seen = new Set<string>();
  for (const key of expected) {
    const rows = groups[key];
    if (rows.length !== TEAMS_PER_GROUP) return { valid: false, reason: 'ROLLOVER_PLAN_GROUP_SIZE_INVALID', group: key };
    const ranks = new Set<number>();
    for (const row of rows) {
      const id = String(row?.id || '');
      const rank = Number(row?.rank);
      if (!id || !Number.isInteger(rank) || rank < 1 || rank > TEAMS_PER_GROUP || ranks.has(rank) || seen.has(id)) {
        return { valid: false, reason: 'ROLLOVER_PLAN_SLOT_CONFLICT', group: key, id, rank };
      }
      ranks.add(rank);
      seen.add(id);
    }
    if (ranks.size !== TEAMS_PER_GROUP) return { valid: false, reason: 'ROLLOVER_PLAN_RANKS_INVALID', group: key };
  }
  return { valid: true };
}
