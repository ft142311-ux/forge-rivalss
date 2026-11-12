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

/**
 * Deterministically apply the league pyramid's promotion/relegation rules.
 * Input standings must already be final, sorted by rank, and keyed by Dn-Gn.
 * This helper is pure so the complete 15-group movement can be regression-tested.
 */
export function buildPromotionRelegationGroups(
  standings: Record<string, any[]>,
): { ready: true; groups: Record<string, any[]> } | {
  ready: false;
  reason: string;
  group: string;
  count: number;
  groups: Record<string, any[]>;
} {
  const placements: Record<string, any[]> = {};
  const get = (level: number, group: number) => standings[`D${level}-G${group}`] || [];

  for (let level = 1; level <= MAX_LEVELS; level++) {
    for (let group = 1; group <= Math.pow(2, level - 1); group++) {
      const own = get(level, group);
      const incoming: any[] = [];
      if (level > 1) {
        const parentGroup = Math.ceil(group / 2);
        const parent = get(level - 1, parentGroup);
        incoming.push(parent[group % 2 === 1 ? 6 : 7]);
      }
      if (level < MAX_LEVELS) {
        incoming.push(get(level + 1, group * 2 - 1)[0], get(level + 1, group * 2)[0]);
      }

      let retained: any[];
      if (level === 1) retained = own.slice(0, 6);
      else if (level === MAX_LEVELS) retained = own.slice(1, 8);
      else retained = own.slice(1, 6);

      const unique = new Map<string, any>();
      for (const team of [...retained, ...incoming]) {
        if (team?.id) unique.set(String(team.id), team);
      }
      const normalized = [...unique.values()].slice(0, TEAMS_PER_GROUP).map((team, index) => ({
        ...team,
        id: String(team.id),
        rank: index + 1,
        matchesPlayed: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        points: 0,
        diff: 0,
      }));
      const key = `D${level}-G${group}`;
      if (normalized.length !== TEAMS_PER_GROUP) {
        return { ready: false, reason: 'ROLLOVER_GROUP_SIZE_INVALID', group: key, count: normalized.length, groups: placements };
      }
      placements[key] = normalized;
    }
  }

  return { ready: true, groups: placements };
}

/**
 * Build a no-promotion carry-forward plan for recovery across genuinely
 * incomplete seasons. The caller supplies the last trustworthy team placement
 * snapshot (not partial match standings). Every group must contain exactly
 * ranks 1..8, and every team ID must be globally unique.
 */
export function buildCarryForwardGroups(
  sourceGroups: Record<string, any[]>,
): { ready: true; groups: Record<string, any[]> } | {
  ready: false;
  reason: string;
  group?: string;
  id?: string;
} {
  const groups: Record<string, any[]> = {};
  const expected = expectedRolloverGroups();
  const seen = new Set<string>();

  for (const key of expected) {
    const rows = sourceGroups?.[key];
    if (!Array.isArray(rows) || rows.length !== TEAMS_PER_GROUP) {
      return { ready: false, reason: 'CARRY_FORWARD_GROUP_INCOMPLETE', group: key };
    }
    const byRank = new Map<number, any>();
    for (const row of rows) {
      const id = String(row?.id || '');
      const rank = Number(row?.rank);
      if (!id || !Number.isInteger(rank) || rank < 1 || rank > TEAMS_PER_GROUP ||
          byRank.has(rank) || seen.has(id)) {
        return { ready: false, reason: 'CARRY_FORWARD_TEAM_OR_RANK_CONFLICT', group: key, id };
      }
      byRank.set(rank, row);
      seen.add(id);
    }
    if (byRank.size !== TEAMS_PER_GROUP) {
      return { ready: false, reason: 'CARRY_FORWARD_RANKS_INCOMPLETE', group: key };
    }
    groups[key] = Array.from({ length: TEAMS_PER_GROUP }, (_, index) => {
      const row = byRank.get(index + 1)!;
      return {
        ...row,
        id: String(row.id),
        rank: index + 1,
        matchesPlayed: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        points: 0,
        diff: 0,
      };
    });
  }

  if (Object.keys(sourceGroups || {}).some(key => !expected.includes(key))) {
    return { ready: false, reason: 'CARRY_FORWARD_UNEXPECTED_GROUP' };
  }
  return { ready: true, groups };
}


/** Validate plan document identities before pruning obsolete rollover plans. */
export function resolveRolloverPlanPruneIds(
  plans: Array<{ id: string; plan: any }>,
  targetSeason: number,
) {
  if (!Number.isSafeInteger(targetSeason) || targetSeason < 2) {
    return { ready: false as const, reason: 'ROLLOVER_PLAN_PRUNE_TARGET_INVALID', pruneIds: [] as string[] };
  }
  let targetFound = false;
  const pruneIds: string[] = [];
  for (const item of plans) {
    const match = /^S([1-9]\d*)$/.exec(String(item.id || ''));
    const season = match ? Number(match[1]) : NaN;
    if (!Number.isSafeInteger(season) || season > targetSeason ||
        !validateRolloverPlan(item.plan, season - 1, season).valid) {
      return { ready: false as const, reason: 'ROLLOVER_PLAN_PRUNE_IDENTITY_CONFLICT', planId: item.id, pruneIds: [] as string[] };
    }
    if (season === targetSeason) targetFound = true;
    else pruneIds.push(item.id);
  }
  if (!targetFound) {
    return { ready: false as const, reason: 'ACTIVE_ROLLOVER_PLAN_MISSING_FROM_PRUNE_SET', pruneIds: [] as string[] };
  }
  return { ready: true as const, reason: null, pruneIds };
}
