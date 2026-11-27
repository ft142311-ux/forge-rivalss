/** Validates all 120 league slots and their unique team identities. */
export function isCanonicalCupParticipantField(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 120) return false;
  const ids = new Set<string>();
  const slots = new Set<string>();
  const seeds = new Set<number>();
  const divisionCounts = [0, 0, 0, 0, 0];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return false;
    const team = raw as Record<string, unknown>;
    const id = String(team.id || '').trim();
    const name = String(team.name || '').trim();
    const level = Number(team.level);
    const group = Number(team.group);
    const rank = Number(team.rank);
    const seed = Number(team.seed);
    if (!id || !name || typeof team.isBot !== 'boolean' ||
        ids.has(id) || !Number.isInteger(level) || level < 1 || level > 4 ||
        !Number.isInteger(group) || group < 1 || group > Math.pow(2, level - 1) ||
        !Number.isInteger(rank) || rank < 1 || rank > 8 ||
        !Number.isInteger(seed) || seed < 1 || seed > 120 || seeds.has(seed)) return false;
    const slotKey = [level, group, rank].join(':');
    if (slots.has(slotKey)) return false;
    ids.add(id);
    slots.add(slotKey);
    seeds.add(seed);
    divisionCounts[level] += 1;
  }
  return ids.size === 120 && slots.size === 120 && seeds.size === 120 &&
    divisionCounts[1] === 8 && divisionCounts[2] === 16 &&
    divisionCounts[3] === 32 && divisionCounts[4] === 64;
}

/** Compare every immutable public identity field against the canonical participant record. */
function matchesCanonicalCupTeam(value: unknown, canonical: Record<string, unknown> | undefined): boolean {
  if (!value || typeof value !== 'object' || !canonical) return false;
  const team = value as Record<string, unknown>;
  return String(team.id || '').trim() === String(canonical.id || '').trim() &&
    String(team.name || '').trim() === String(canonical.name || '').trim() &&
    Number(team.level) === Number(canonical.level) &&
    Number(team.group) === Number(canonical.group) &&
    Number(team.rank) === Number(canonical.rank) &&
    Number(team.seed) === Number(canonical.seed) &&
    typeof team.isBot === 'boolean' && team.isBot === canonical.isBot;
}

/** A completed Cup match must name exactly one of its two participants as winner. */
export function isValidPyramidCupWinner(match: unknown, homeId: string, awayId: string): boolean {
  if (!match || typeof match !== 'object') return false;
  const home = String(homeId || '').trim();
  const away = String(awayId || '').trim();
  const winner = String((match as Record<string, unknown>).winnerId || '').trim();
  return Boolean(home && away && home !== away && winner && (winner === home || winner === away));
}

/** Verifies the no-BYE opening: every D2-D4 team plays and all D1 teams rest. */
export function isCanonicalPyramidCupOpeningField(participants: unknown, openingRound: unknown, restTeams: unknown): boolean {
  if (!isCanonicalCupParticipantField(participants) || !Array.isArray(openingRound) || openingRound.length !== 56 ||
      !Array.isArray(restTeams) || restTeams.length !== 8) return false;
  const byId = new Map<string, Record<string, unknown>>();
  for (const raw of participants as any[]) {
    byId.set(String(raw.id).trim(), raw as Record<string, unknown>);
  }
  const d1Ids = new Set([...byId.entries()].filter(([, team]) => Number(team.level) === 1).map(([id]) => id));
  const restIds = new Set<string>();
  for (const raw of restTeams as any[]) {
    const id = String(raw?.id || '');
    const canonical = byId.get(id);
    if (!canonical || Number(canonical.level) !== 1 || restIds.has(id) ||
        !matchesCanonicalCupTeam(raw, canonical)) return false;
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
        Number(canonicalHome.level) === 1 || Number(canonicalAway.level) === 1 ||
        openingIds.has(homeId) || openingIds.has(awayId) ||
        !matchesCanonicalCupTeam(home, canonicalHome) ||
        !matchesCanonicalCupTeam(away, canonicalAway)) return false;
    openingIds.add(homeId);
    openingIds.add(awayId);
  }
  const eligibleIds = [...byId.entries()].filter(([, team]) => team.level !== 1).map(([id]) => id);
  return openingIds.size === 112 && eligibleIds.every(id => openingIds.has(id)) &&
    [...openingIds].every(id => !restIds.has(id));
}

/** Every active round must contain previous-round winners; D1 joins in R2. */
export function isPyramidCupRoundProgressionValid(
  rounds: any,
  currentRound: number,
  restTeams: unknown,
  participants?: unknown,
): boolean {
  const pairingCounts = [56, 32, 16, 8, 4, 2, 1];
  const participantCounts = [112, 64, 32, 16, 8, 4, 2];
  if (!rounds || typeof rounds !== 'object' || !Number.isInteger(currentRound) ||
      currentRound < 1 || currentRound > 7 || !Array.isArray(restTeams) || restTeams.length !== 8) return false;
  const canonicalById = new Map<string, Record<string, unknown>>();
  if (participants !== undefined) {
    if (!isCanonicalCupParticipantField(participants)) return false;
    for (const team of participants as any[]) canonicalById.set(String(team.id).trim(), team);
  }
  const restEntries = restTeams as any[];
  const restIds = new Set(restEntries.map(team => String(team?.id || '').trim()).filter(Boolean));
  if (restIds.size !== 8 || restEntries.some(team =>
    !team || typeof team !== 'object' || Number(team.level) !== 1 ||
    (canonicalById.size > 0 && !matchesCanonicalCupTeam(team, canonicalById.get(String(team.id || '').trim())))
  )) return false;
  for (let round = 1; round <= currentRound; round += 1) {
    const pairings = Array.isArray(rounds['r' + round]) ? rounds['r' + round] : [];
    if (pairings.length !== pairingCounts[round - 1]) return false;
    const actualIds = new Set<string>();
    for (const pairing of pairings) {
      const homeId = String(pairing?.home?.id || '');
      const awayId = String(pairing?.away?.id || '');
      if (!homeId || !awayId || homeId === awayId || actualIds.has(homeId) || actualIds.has(awayId) ||
          (canonicalById.size > 0 && (
            !matchesCanonicalCupTeam(pairing?.home, canonicalById.get(homeId)) ||
            !matchesCanonicalCupTeam(pairing?.away, canonicalById.get(awayId))
          ))) return false;
      const status = String(pairing?.status || '').toLowerCase();
      const winnerId = String(pairing?.winnerId || '').trim();
      if (!['scheduled', 'finished'].includes(status) ||
          (status === 'finished' && !isValidPyramidCupWinner({ winnerId }, homeId, awayId)) ||
          (status === 'scheduled' && winnerId) ||
          (round < currentRound && status !== 'finished')) return false;
      actualIds.add(homeId);
      actualIds.add(awayId);
    }
    if (actualIds.size !== participantCounts[round - 1]) return false;
    if (round === 1) {
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
          !isValidPyramidCupWinner({ winnerId }, homeId, awayId) || expectedIds.has(winnerId)) return false;
      expectedIds.add(winnerId);
    }
    if (expectedIds.size !== participantCounts[round - 1] ||
        [...expectedIds].some(id => !actualIds.has(id))) return false;
  }
  return true;
}

/** A frozen Cup entrant must retain five distinct, addressable player identities. */
export function isValidCupParticipantMatchSnapshot(value: unknown, teamId: string): boolean {
  const expectedId = String(teamId || '').trim();
  if (!expectedId || !value || typeof value !== 'object' || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  if (snapshot.id !== expectedId || !Array.isArray(snapshot.players) || snapshot.players.length !== 5) {
    return false;
  }

  const playerIds = new Set<string>();
  for (const rawPlayer of snapshot.players) {
    if (!rawPlayer || typeof rawPlayer !== 'object' || Array.isArray(rawPlayer)) return false;
    const playerId = String((rawPlayer as Record<string, unknown>).id ?? '').trim();
    if (!playerId || playerIds.has(playerId)) return false;
    playerIds.add(playerId);
  }
  return playerIds.size === 5;
}

/** Stable JSON comparison ignores object-key order but preserves array order and values. */
function stableCupSnapshotJson(value: unknown): string | null {
  try {
    const serialized = JSON.stringify(value, (_key, current) => {
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        const ordered: Record<string, unknown> = {};
        for (const key of Object.keys(current).sort()) ordered[key] = current[key];
        return ordered;
      }
      return current;
    });
    return typeof serialized === 'string' ? serialized : null;
  } catch {
    return null;
  }
}

/** Existing fixtures may be reused only with the same frozen roster snapshot. */
export function isCupParticipantMatchSnapshotCompatible(
  existing: unknown,
  expected: unknown,
  teamId: string,
): boolean {
  if (!isValidCupParticipantMatchSnapshot(existing, teamId) ||
      !isValidCupParticipantMatchSnapshot(expected, teamId)) return false;
  const existingJson = stableCupSnapshotJson(existing);
  const expectedJson = stableCupSnapshotJson(expected);
  return existingJson !== null && existingJson === expectedJson;
}


/** Validates the immutable Pyramid Cup match-routing and competition contract. */
export function isCanonicalPyramidCupMatchContract(value: unknown, matchId: string): boolean {
  const id = String(matchId || '').trim();
  if (!id || !value || typeof value !== 'object' || Array.isArray(value)) return false;
  const match = value as Record<string, unknown>;
  const identity = /^cup_S([1-9]\d*)_R([1-7])_M(\d{2})$/.exec(id);
  if (!identity || match.id !== id) return false;

  const season = Number(identity[1]);
  const round = Number(identity[2]);
  const index = Number(identity[3]);
  const pairingCounts = [56, 32, 16, 8, 4, 2, 1];
  const homeId = String(match.homeId ?? '').trim();
  const awayId = String(match.awayId ?? '').trim();

  return Number.isSafeInteger(season) && season >= 1 &&
    Number.isInteger(index) && index >= 1 && index <= pairingCounts[round - 1] &&
    Number(match.season) === season &&
    Number(match.cupRound) === round &&
    Number(match.bestOf) === (round === 7 ? 3 : 1) &&
    match.type === 'cup' &&
    match.matchType === 'cup' &&
    match.source === 'pyramid-cup' &&
    match.cupId === `cup_s${season}_lALPHA` &&
    match.leagueId === 'ALPHA' &&
    Boolean(homeId) && Boolean(awayId) && homeId !== awayId &&
    match.affectsLeagueStandings === false;
}
