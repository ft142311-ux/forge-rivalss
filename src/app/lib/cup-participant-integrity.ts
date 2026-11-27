/** Validates all 120 league slots and their unique team identities. */
export function isCanonicalCupParticipantField(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 120) return false;
  const ids = new Set<string>();
  const slots = new Set<string>();
  const divisionCounts = [0, 0, 0, 0, 0];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return false;
    const team = raw as Record<string, unknown>;
    const id = String(team.id || '').trim();
    const level = Number(team.level);
    const group = Number(team.group);
    const rank = Number(team.rank);
    if (!id || ids.has(id) || !Number.isInteger(level) || level < 1 || level > 4 ||
        !Number.isInteger(group) || group < 1 || group > Math.pow(2, level - 1) ||
        !Number.isInteger(rank) || rank < 1 || rank > 8) return false;
    const slotKey = [level, group, rank].join(':');
    if (slots.has(slotKey)) return false;
    ids.add(id);
    slots.add(slotKey);
    divisionCounts[level] += 1;
  }
  return ids.size === 120 && slots.size === 120 &&
    divisionCounts[1] === 8 && divisionCounts[2] === 16 &&
    divisionCounts[3] === 32 && divisionCounts[4] === 64;
}

/** Verifies the no-BYE opening: every D2-D4 team plays and all D1 teams rest. */
export function isCanonicalPyramidCupOpeningField(participants: unknown, openingRound: unknown, restTeams: unknown): boolean {
  if (!isCanonicalCupParticipantField(participants) || !Array.isArray(openingRound) || openingRound.length !== 56 ||
      !Array.isArray(restTeams) || restTeams.length !== 8) return false;
  const byId = new Map<string, { level: number; group: number; rank: number }>();
  for (const raw of participants as any[]) {
    byId.set(String(raw.id), { level: Number(raw.level), group: Number(raw.group), rank: Number(raw.rank) });
  }
  const d1Ids = new Set([...byId.entries()].filter(([, team]) => team.level === 1).map(([id]) => id));
  const restIds = new Set<string>();
  for (const raw of restTeams as any[]) {
    const id = String(raw?.id || '');
    const canonical = byId.get(id);
    if (!canonical || canonical.level !== 1 || restIds.has(id) ||
        Number(raw.level) !== canonical.level || Number(raw.group) !== canonical.group ||
        Number(raw.rank) !== canonical.rank) return false;
    restIds.add(id);
  }
  if (d1Ids.size !== 8 || restIds.size !== 8 || [...d1Ids].some(id => !restIds.has(id))) return false;
  const openingIds = new Set<string>();
  for (const raw of openingRound as any[]) {
    const home = raw?.home;
    const away = raw?.away;
    const homeId = String(home?.id || '');
    const awayId = String(away?.id || '');
    const canonicalHome = byId.get(homeId);
    const canonicalAway = byId.get(awayId);
    if (!canonicalHome || !canonicalAway || homeId === awayId ||
        canonicalHome.level === 1 || canonicalAway.level === 1 ||
        openingIds.has(homeId) || openingIds.has(awayId) ||
        Number(home.level) !== canonicalHome.level || Number(home.group) !== canonicalHome.group ||
        Number(home.rank) !== canonicalHome.rank || Number(away.level) !== canonicalAway.level ||
        Number(away.group) !== canonicalAway.group || Number(away.rank) !== canonicalAway.rank) return false;
    openingIds.add(homeId);
    openingIds.add(awayId);
  }
  const eligibleIds = [...byId.entries()].filter(([, team]) => team.level !== 1).map(([id]) => id);
  return openingIds.size === 112 && eligibleIds.every(id => openingIds.has(id)) &&
    [...openingIds].every(id => !restIds.has(id));
}

/** Every active round must contain previous-round winners; D1 joins in R2. */
export function isPyramidCupRoundProgressionValid(rounds: any, currentRound: number, restTeams: unknown): boolean {
  const pairingCounts = [56, 32, 16, 8, 4, 2, 1];
  const participantCounts = [112, 64, 32, 16, 8, 4, 2];
  if (!rounds || typeof rounds !== 'object' || !Number.isInteger(currentRound) ||
      currentRound < 1 || currentRound > 7 || !Array.isArray(restTeams) || restTeams.length !== 8) return false;
  const restEntries = restTeams as any[];
  const restIds = new Set(restEntries.map(team => String(team?.id || '').trim()).filter(Boolean));
  if (restIds.size !== 8 || restEntries.some(team =>
    !team || typeof team !== 'object' || Number(team.level) !== 1
  )) return false;
  for (let round = 1; round <= currentRound; round += 1) {
    const pairings = Array.isArray(rounds['r' + round]) ? rounds['r' + round] : [];
    if (pairings.length !== pairingCounts[round - 1]) return false;
    const actualIds = new Set<string>();
    for (const pairing of pairings) {
      const homeId = String(pairing?.home?.id || '');
      const awayId = String(pairing?.away?.id || '');
      if (!homeId || !awayId || homeId === awayId || actualIds.has(homeId) || actualIds.has(awayId)) return false;
      actualIds.add(homeId);
      actualIds.add(awayId);
    }
    if (actualIds.size !== participantCounts[round - 1]) return false;
    if (round === 1) {
      // The eight D1 entrants must be absent from the 112-team opening round.
      if ([...restIds].some(id => actualIds.has(id))) return false;
      continue;
    }
    const previous = Array.isArray(rounds['r' + (round - 1)]) ? rounds['r' + (round - 1)] : [];
    const expectedIds = new Set<string>(round === 2 ? [...restIds] : []);
    for (const pairing of previous) {
      const homeId = String(pairing?.home?.id || '');
      const awayId = String(pairing?.away?.id || '');
      const winnerId = String(pairing?.winnerId || '');
      if (String(pairing?.status || '').toLowerCase() !== 'finished' ||
          ![homeId, awayId].includes(winnerId) || expectedIds.has(winnerId)) return false;
      expectedIds.add(winnerId);
    }
    if (expectedIds.size !== participantCounts[round - 1] ||
        [...expectedIds].some(id => !actualIds.has(id))) return false;
  }
  return true;
}


/** A frozen Cup entrant must retain the exact five-player match snapshot. */
export function isValidCupParticipantMatchSnapshot(value: unknown, teamId: string): boolean {
  const expectedId = String(teamId || '').trim();
  if (!expectedId || !value || typeof value !== 'object' || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  return snapshot.id === expectedId &&
    Array.isArray(snapshot.players) &&
    snapshot.players.length === 5;
}

/** Existing fixtures may be reused only with the same frozen roster snapshot. */
export function isCupParticipantMatchSnapshotCompatible(
  existing: unknown,
  expected: unknown,
  teamId: string,
): boolean {
  return isValidCupParticipantMatchSnapshot(existing, teamId) &&
    isValidCupParticipantMatchSnapshot(expected, teamId) &&
    JSON.stringify(existing) === JSON.stringify(expected);
}
