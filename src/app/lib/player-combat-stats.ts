export type PlayerCombatStats = {
  kills: any;
  deaths: any;
  assists: any;
};

export type PlayerCombatStatsOptions = {
  /**
   * Match settlement historically coerces Firestore scoreboard values to numbers.
   * The roster history view preserves its previous JavaScript `+=` behavior.
   */
  coerceValues?: boolean;
  /** Existing totals let callers preserve their original accumulation semantics. */
  initial?: PlayerCombatStats;
};

/**
 * Sum combat counters from scoreboard rows without deciding which rows belong
 * to a player, match, map, or competition. Callers retain their own selection rules.
 */
export function aggregatePlayerCombatStats(
  rows: readonly any[],
  options: PlayerCombatStatsOptions = {},
): PlayerCombatStats {
  const coerceValues = options.coerceValues === true;
  return rows.reduce<PlayerCombatStats>((total, row) => {
    if (coerceValues) {
      total.kills += Number(row?.kills || 0);
      total.deaths += Number(row?.deaths || 0);
      total.assists += Number(row?.assists || 0);
    } else {
      total.kills += row?.kills || 0;
      total.deaths += row?.deaths || 0;
      total.assists += row?.assists || 0;
    }
    return total;
  }, options.initial ? { ...options.initial } : { kills: 0, deaths: 0, assists: 0 });
}
