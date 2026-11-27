import 'server-only';

/** Canonical Pyramid Cup engine. All sporting simulations use Universal Match Core. */
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { getTableId, MAX_LEVELS, TEAMS_PER_GROUP, TOTAL_GROUPS } from '@/app/lib/leagues-data';
import { resolveUniversalMatchDocument } from '@/app/actions/universal-match-resolver';
import { buildMatchTeamSnapshot, type MatchTeamSnapshot } from '@/app/lib/match-simulation';
import { MATCH_COLLECTIONS } from '@/app/lib/match-storage';
import { resolveSeasonLifecycleWindow } from './season-boundary';
import { isMatchReportFinished } from '@/app/lib/match-report-utils';
import { isCanonicalPyramidCupOpeningField, isPyramidCupRoundProgressionValid } from '@/app/lib/cup-participant-integrity';
import { resolveCupPrizeReplayAmount } from '@/app/lib/cup-prize-ledger';

const LEAGUE_ID = 'ALPHA';
const CUP_COLLECTION = 'cup_pyramid_v1';
const CUP_PARTICIPANT_SNAPSHOT_COLLECTION = 'cup_participant_snapshots_v1';
const TOTAL_TEAMS = TOTAL_GROUPS * TEAMS_PER_GROUP;
const ROUND_COUNT = 7; // 112 -> 64 (D1 joins) -> 32 -> 16 -> 8 -> 4 -> 2 -> final
const ROUND_PAIRING_COUNTS = [56, 32, 16, 8, 4, 2, 1];
const ROUND_TEAM_COUNTS = [112, 64, 32, 16, 8, 4, 2];
const ROUND_BYE_COUNTS = [0, 0, 0, 0, 0, 0, 0];
const TOTAL_CUP_MATCHES = ROUND_PAIRING_COUNTS.reduce((sum, count) => sum + count, 0);

const CUP_FORMAT_VERSION = 4;
const ROUND_DAYS = [2, 3, 4, 5, 6, 7, 8]; // preliminary round follows league Tour 1; every round is daily
const CUP_START_HOUR_UTC = 4; // 07:00 Moscow time

type Team = { id: string; name: string; level: number; group: number; rank: number; isBot: boolean; seed: number; matchSnapshot?: MatchTeamSnapshot };
type Pairing = { id: string; index: number; home: Team; away: Team; status: 'scheduled' | 'finished'; matchId?: string | null; winnerId?: string | null; scoreA?: number | null; scoreB?: number | null; technicalDecision?: boolean };

function resolveCupDate(value: any): Date {
  if (value === null || value === undefined || value === '') throw new Error('CUP_SEASON_START_INVALID');
  const date = value instanceof Date
    ? new Date(value.getTime())
    : value && typeof value.toDate === 'function'
      ? value.toDate()
      : new Date(value);
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new Error('CUP_SEASON_START_INVALID');
  }
  return date;
}

async function readActiveCupSeasonContext(
  db: any,
  nowMs = Date.now(),
  requestedSeason?: number,
  options: { allowInitialBootstrap?: boolean } = {},
) {
  const configSnap = await db.collection('system_v1').doc('season_config').get();
  if (!configSnap.exists) return { ready: false as const, reason: 'SEASON_CONFIG_MISSING' };
  const config = configSnap.data() || {};
  const activeSeason = Number(config.activeSeasonNumber);
  if (!Number.isSafeInteger(activeSeason) || activeSeason < 1) {
    return { ready: false as const, reason: 'ACTIVE_SEASON_INVALID' };
  }
  const season = Number(requestedSeason || activeSeason);
  const phase = String(config.phase || '').toUpperCase();
  if (season !== activeSeason) {
    const preparedSeason = Number(config.preparedSeasonNumber);
    const preparedPhase = ['GENERATING_NEXT', 'PREPARING_NEXT_SEASON', 'PREPARATION', 'PUBLISHED'].includes(phase);
    if (season !== preparedSeason || preparedSeason !== activeSeason + 1 || config.worldReady !== true ||
        config.preparedWorldReady !== true || !preparedPhase) {
      return { ready: false as const, reason: 'PREPARED_SEASON_NOT_READY', season, activeSeason, preparedSeason, phase };
    }
    const seasonStart = resolveCupDate(config.preparedSeasonStart);
    return { ready: true as const, season, phase, seasonStart, seasonDay: 0, prepared: true as const };
  }
  if (config.worldReady !== true || !['REGULAR_SEASON', 'ACTIVE'].includes(phase)) {
    return { ready: false as const, reason: 'ACTIVE_SEASON_NOT_READY', season, phase };
  }
  if (config.pyramidCupRequired === true &&
      Number(config.pyramidCupReadySeasonNumber) === activeSeason &&
      config.pyramidCupReady !== true &&
      options.allowInitialBootstrap !== true) {
    return { ready: false as const, reason: 'INITIAL_PYRAMID_CUP_NOT_READY', season, phase };
  }
  const seasonStart = resolveCupDate(config.seasonStart);
  const nextSeasonStart = resolveCupDate(config.nextSeasonStart);
  if (!Number.isFinite(nowMs)) throw new Error('CUP_CLOCK_INVALID');
  const lifecycle = resolveSeasonLifecycleWindow({
    seasonStart,
    nextSeasonStart,
    now: new Date(nowMs),
  });
  if (lifecycle.leagueMatchesPaused) {
    return { ready: false as const, reason: 'OFFSEASON_CUP_MATCHES_DISABLED', season, phase };
  }
  const seasonDay = Math.floor((nowMs - seasonStart.getTime()) / 86400000) + 1;
  return { ready: true as const, season, phase, seasonStart, seasonDay, prepared: false as const };
}

function cupId(season: number) { return `cup_s${season}_l${LEAGUE_ID}`; }
function matchId(season: number, round: number, index: number) { return `cup_S${season}_R${round}_M${String(index).padStart(2, '0')}`; }
function roundKey(round: number) { return `r${round}`; }
function roundDate(seasonStart: Date, seasonDay: number) {
  // League Tour 1 takes place on season day 1. The preliminary cup round starts
  // the following day, and every subsequent round is held simultaneously at
  // 07:00 Moscow time (04:00 UTC). Never schedule the cup before Tour 1.
  if (seasonDay < 1) throw new Error('CUP_SEASON_DAY_INVALID');
  const date = new Date(seasonStart.getTime() + (seasonDay - 1) * 86400000);
  date.setUTCHours(CUP_START_HOUR_UTC, 0, 0, 0);
  return date;
}
function normalizeTeam(raw: any, level: number, group: number, rank: number): Team {
  const id = String(raw?.id || `BOT_ALPHA_L${level}_G${group}_R${rank}`);
  return { id, name: String(raw?.name || raw?.displayName || id), level, group, rank, isBot: Boolean(raw?.isBot || id.startsWith('BOT_')), seed: 0 };
}

/** Lower division number is stronger; within division, better rank then lower group wins. */
function compareStrength(a: Team, b: Team) {
  return a.level - b.level || a.rank - b.rank || a.group - b.group || a.id.localeCompare(b.id);
}
async function loadAllLeagueTeams(db: any, season: number): Promise<Team[]> {
  const teams: Team[] = [];
  for (let level = 1; level <= MAX_LEVELS; level++) {
    for (let group = 1; group <= Math.pow(2, level - 1); group++) {
      const snap = await db.collection('league_tables_v2').doc(getTableId(season, LEAGUE_ID, level, group)).get();
      if (!snap.exists) throw new Error(`CUP_LEAGUE_TABLE_MISSING:D${level}-G${group}`);
      const stats = snap.data()?.stats || {};
      const byRank = new Map<number, { id: string; value: any }>();
      for (const [key, value] of Object.entries(stats) as Array<[string, any]>) {
        const rank = Number(value?.rank);
        if (!Number.isInteger(rank) || rank < 1 || rank > TEAMS_PER_GROUP) continue;
        if (byRank.has(rank)) {
          throw new Error(`CUP_DUPLICATE_LEAGUE_STANDING:D${level}-G${group}-R${rank}`);
        }
        const rowId = String(value?.id || key);
        if (rowId !== key) {
          throw new Error(`CUP_LEAGUE_STANDING_IDENTITY_INVALID:D${level}-G${group}-R${rank}`);
        }
        byRank.set(rank, { id: key, value });
      }
      for (let rank = 1; rank <= TEAMS_PER_GROUP; rank++) {
        const entry = byRank.get(rank);
        if (!entry) {
          throw new Error(`CUP_LEAGUE_STANDING_MISSING:D${level}-G${group}-R${rank}`);
        }
        teams.push(normalizeTeam({ ...entry.value, id: entry.id }, level, group, rank));
      }
    }
  }
  if (teams.length !== TOTAL_TEAMS) throw new Error(`CUP_PARTICIPANT_COUNT_INVALID:${teams.length}`);
  if (new Set(teams.map(t => t.id)).size !== TOTAL_TEAMS) throw new Error('CUP_DUPLICATE_PARTICIPANTS');
  teams.sort(compareStrength);

  // Freeze each participant's active five-player roster and tactics at cup
  // generation. A later league-slot registration may retire the replaced bot
  // profile, but it must not erase that club's already-published cup entry.
  const profileSnapshots = await Promise.all(teams.map(team =>
    db.collection('players_v14').doc(team.id).get()
  ));
  return teams.map((team, index) => {
    const profile = profileSnapshots[index];
    if (!profile.exists) throw new Error(`CUP_PARTICIPANT_PROFILE_MISSING:${team.id}`);
    const data = profile.data() || {};
    const matchSnapshot = buildMatchTeamSnapshot({
      ...data,
      clubName: team.name,
      displayName: team.name,
    }, team.name, team.id, 'cup');
    if (!Array.isArray(matchSnapshot.players) || matchSnapshot.players.length !== 5) {
      throw new Error(`CUP_PARTICIPANT_ROSTER_INVALID:${team.id}`);
    }
    // Firestore rejects undefined nested values (for example legacy tactics
    // without lineSettings). Snapshot data is JSON-shaped and deliberately
    // stripped of undefined optional fields before persistence.
    const persistedMatchSnapshot = JSON.parse(JSON.stringify(matchSnapshot)) as MatchTeamSnapshot;
    return { ...team, seed: index + 1, matchSnapshot: persistedMatchSnapshot };
  });
}
function publicTeam(team: Team | null) {
  return team ? { id: team.id, name: team.name, level: team.level, group: team.group, rank: team.rank, seed: team.seed, isBot: team.isBot } : null;
}
function publicPairing(pairing: Pairing) {
  return { ...pairing, home: publicTeam(pairing.home), away: publicTeam(pairing.away) };
}
function participantSnapshotRef(db: any, season: number, teamId: string) {
  return db.collection(CUP_PARTICIPANT_SNAPSHOT_COLLECTION).doc(cupId(season)).collection('teams').doc(teamId);
}
function makePair(id: string, index: number, firstStrong: Team, secondWeak: Team): Pairing {
  // The stronger team is always AWAY; weaker team is HOME.
  return { id, index, home: secondWeak, away: firstStrong, status: 'scheduled', matchId: null, winnerId: null, scoreA: null, scoreB: null };
}
function createPreliminary(teams: Team[]): Pairing[] {
  // D1 rests in the opening round by competition format. D2-D4 are paired
  // from the bottom upward so teams of adjacent strength meet: weakest vs
  // next-weakest, then the next two, with the stronger side always AWAY.
  const eligible = teams.filter(team => team.level !== 1).sort(compareStrength);
  if (teams.length !== TOTAL_TEAMS || eligible.length !== TOTAL_TEAMS - TEAMS_PER_GROUP) {
    throw new Error('CUP_OPENING_ROUND_FIELD_INVALID');
  }
  const pairs: Pairing[] = [];
  for (let i = 0; i < eligible.length / 2; i++) {
    const stronger = eligible[eligible.length - 2 - i * 2];
    const weaker = eligible[eligible.length - 1 - i * 2];
    pairs.push(makePair(`r1_m${i + 1}`, i + 1, stronger, weaker));
  }
  return pairs;
}
function teamFromPublic(value: any): Team | null {
  if (!value?.id) return null;
  return { id: String(value.id), name: String(value.name || value.id), level: Number(value.level || 4), group: Number(value.group || 1), rank: Number(value.rank || 8), isBot: Boolean(value.isBot), seed: Number(value.seed || 0), matchSnapshot: Array.isArray(value.matchSnapshot?.players) ? value.matchSnapshot : undefined };
}
function buildRoundPairings(round: number, input: Team[]): Pairing[] {
  const teams = [...input].sort(compareStrength);
  if (teams.length % 2 !== 0) throw new Error(`CUP_ODD_PARTICIPANT_COUNT:R${round}:${teams.length}`);
  const pairs: Pairing[] = [];
  for (let i = 0; i < teams.length / 2; i++) {
    // Strongest remaining vs weakest remaining, next strongest vs next weakest, etc.
    pairs.push(makePair(`r${round}_m${i + 1}`, i + 1, teams[i], teams[teams.length - 1 - i]));
  }
  return pairs;
}
function buildCupRoundMatchData(season: number, round: number, pairing: Pairing, scheduledAt: any) {
  const isFinal = round === ROUND_COUNT;
  return {
    id: pairing.matchId, type: 'cup', matchType: 'cup', source: 'pyramid-cup', cupId: cupId(season), cupRound: round,
    cupRoundLabel: isFinal ? 'final' : round === 1 ? 'preliminary' : `round_${round}`,
    season, leagueId: LEAGUE_ID, homeId: pairing.home!.id, awayId: pairing.away!.id,
    homeName: pairing.home!.name, awayName: pairing.away!.name,
    homeTeamSnapshot: pairing.home!.matchSnapshot || null,
    awayTeamSnapshot: pairing.away!.matchSnapshot || null,
    homeRank: pairing.home!.rank, awayRank: pairing.away!.rank,
    homeLevel: pairing.home!.level, awayLevel: pairing.away!.level,
    homeGroup: pairing.home!.group, awayGroup: pairing.away!.group,
    homeSeed: pairing.home!.seed, awaySeed: pairing.away!.seed,
    bestOf: isFinal ? 3 : 1, scheduledAt, startTime: scheduledAt, scheduledStartAt: scheduledAt,
    status: 'scheduled', isFinished: false, isProcessing: false, reportStatus: 'pending', seen: false,
    affectsLeagueStandings: false, version: 141,
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  };
}

function cupFixtureTimestampMillis(value: any): number {
  if (value && typeof value.toMillis === 'function') return Number(value.toMillis());
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) return Date.parse(value);
  return Number.NaN;
}

/** Existing deterministic fixtures are reusable only when their immutable match contract is exact. */
function isCupRoundFixtureCompatible(existing: any, expected: any) {
  const stringFields = ['id', 'type', 'cupId', 'homeId', 'awayId'];
  for (const field of stringFields) {
    if (String(existing?.[field] ?? '') !== String(expected?.[field] ?? '')) return false;
  }
  const numericFields = ['season', 'cupRound', 'bestOf'];
  for (const field of numericFields) {
    const actual = Number(existing?.[field]);
    const wanted = Number(expected?.[field]);
    if (!Number.isFinite(actual) || !Number.isFinite(wanted) || actual !== wanted) return false;
  }
  const expectedStart = cupFixtureTimestampMillis(expected?.scheduledAt);
  if (!Number.isFinite(expectedStart)) return false;
  for (const field of ['scheduledAt', 'startTime', 'scheduledStartAt']) {
    const actual = cupFixtureTimestampMillis(existing?.[field]);
    if (!Number.isFinite(actual) || actual !== expectedStart) return false;
  }
  return ['scheduled', 'processing', 'finished', 'completed', 'resolved'].includes(String(existing?.status || '').toLowerCase());
}

async function commitCupRoundTransition(
  db: any,
  cupRef: any,
  season: number,
  seasonStart: Date,
  expectedRound: number,
  pairings: Pairing[],
  nextRound: number,
  nextPairings: Pairing[],
) {
  return db.runTransaction(async (tx: any) => {
    const resetConfigSnap = await tx.get(db.collection('system_v1').doc('season_config'));
    const resetState = resetConfigSnap.exists ? resetConfigSnap.data() || {} : {};
    if (resetState.stagingSeasonOneResetInProgress === true || resetState.stagingFreshSeasonOneReset === true) {
      throw new Error('STAGING_SEASON_ONE_RESET_IN_PROGRESS');
    }
    const cupSnap = await tx.get(cupRef);
    if (!cupSnap.exists) throw new Error('CUP_NOT_FOUND_DURING_ROUND_TRANSITION');
    const current = cupSnap.data() || {};
    if (current.status === 'completed' || Number(current.currentRound || 1) !== expectedRound) {
      return false;
    }

    const scheduledAt = Timestamp.fromDate(roundDate(seasonStart, ROUND_DAYS[nextRound - 1]));
    const advancingTeamIds = [...new Set(nextPairings.flatMap(pairing =>
      [pairing.home?.id, pairing.away?.id].filter((id): id is string => Boolean(id))
    ))];
    const participantSnapshots = await Promise.all(advancingTeamIds.map(async teamId => ({
      teamId,
      snap: await tx.get(participantSnapshotRef(db, season, teamId)),
    })));
    const participantSnapshotById = new Map<string, MatchTeamSnapshot | null>(participantSnapshots.map(({ teamId, snap }) => [
      teamId,
      snap.exists ? (snap.data() || {}).matchSnapshot as MatchTeamSnapshot : null,
    ] as const));
    for (const pairing of nextPairings) {
      if (pairing.home) pairing.home.matchSnapshot = participantSnapshotById.get(pairing.home.id) || undefined;
      if (pairing.away) pairing.away.matchSnapshot = participantSnapshotById.get(pairing.away.id) || undefined;
      if ((pairing.home && !pairing.home.matchSnapshot) || (pairing.away && !pairing.away.matchSnapshot)) {
        throw new Error('CUP_PARTICIPANT_SNAPSHOT_MISSING_DURING_ADVANCEMENT');
      }
    }
    const entries = nextPairings
      .filter(pairing => pairing.home && pairing.away)
      .map(pairing => {
        const expectedId = matchId(season, nextRound, Number(pairing.index));
        if (pairing.matchId && pairing.matchId !== expectedId) {
          throw new Error('CUP_STAGE_FIXTURE_ID_CONFLICT');
        }
        pairing.matchId = expectedId;
        const expectedFixture = buildCupRoundMatchData(season, nextRound, pairing, scheduledAt);
        return {
          pairing,
          expectedFixture,
          dedicatedRef: db.collection(MATCH_COLLECTIONS.cup).doc(expectedId),
          legacyRef: db.collection('matches_v2').doc(expectedId),
        };
      });

    // All reads precede every write. Fixture creation and the bracket pointer
    // advance share this transaction, so a stale worker cannot seed a future
    // round after another worker has already advanced the cup.
    const snapshots = await Promise.all(entries.map(async entry => ({
      dedicated: await tx.get(entry.dedicatedRef),
      legacy: await tx.get(entry.legacyRef),
    })));

    entries.forEach((entry, index) => {
      const existing = snapshots[index].dedicated.exists
        ? snapshots[index].dedicated.data() || {}
        : snapshots[index].legacy.exists ? snapshots[index].legacy.data() || {} : null;
      if (existing) {
        if (!isCupRoundFixtureCompatible(existing, entry.expectedFixture)) {
          throw new Error('CUP_STAGE_FIXTURE_CONFLICT');
        }
        return;
      }
      tx.create(entry.dedicatedRef, entry.expectedFixture);
    });

    const rounds: Record<string, any[]> = { ...(current.rounds || {}) };
    rounds[roundKey(expectedRound)] = pairings.map(publicPairing);
    rounds[roundKey(nextRound)] = nextPairings.map(publicPairing);
    tx.update(cupRef, {
      rounds,
      currentRound: nextRound,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
}

async function commitCupRoundState(
  db: any,
  cupRef: any,
  expectedRound: number,
  pairings: Pairing[],
  options: { nextRound?: number; nextPairings?: Pairing[]; completion?: Record<string, any> } = {},
) {
  return db.runTransaction(async (tx: any) => {
    const resetConfigSnap = await tx.get(db.collection('system_v1').doc('season_config'));
    const resetState = resetConfigSnap.exists ? resetConfigSnap.data() || {} : {};
    if (resetState.stagingSeasonOneResetInProgress === true || resetState.stagingFreshSeasonOneReset === true) {
      throw new Error('STAGING_SEASON_ONE_RESET_IN_PROGRESS');
    }
    const snap = await tx.get(cupRef);
    if (!snap.exists) throw new Error('CUP_NOT_FOUND_DURING_ROUND_COMMIT');
    const current = snap.data() || {};
    if (current.status === 'completed' || Number(current.currentRound || 1) !== expectedRound) {
      return false;
    }
    const rounds: Record<string, any[]> = { ...(current.rounds || {}) };
    rounds[roundKey(expectedRound)] = pairings.map(publicPairing);
    if (options.nextRound && options.nextPairings) {
      rounds[roundKey(options.nextRound)] = options.nextPairings.map(publicPairing);
    }
    const patch: Record<string, any> = {
      rounds,
      updatedAt: FieldValue.serverTimestamp(),
      ...(options.completion || {}),
    };
    if (options.nextRound) patch.currentRound = options.nextRound;
    tx.update(cupRef, patch);
    return true;
  });
}

export async function commitPyramidCupCreation(
  db: any,
  configRef: any,
  cupRef: any,
  snapshotWrites: Array<{ ref: any; data: any }>,
  fixtureWrites: Array<{ ref: any; data: any }>,
  cupData: any,
  options: { allowStagingResetBootstrap?: boolean } = {},
) {
  return db.runTransaction(async (tx: any) => {
    const [configSnap, cupSnap] = await Promise.all([
      tx.get(configRef),
      tx.get(cupRef),
    ]);
    if (!configSnap.exists) return { status: 'SEASON_CONFIG_MISSING' };
    const config = configSnap.data() || {};
    const stagingResetBootstrapAllowed =
      options.allowStagingResetBootstrap === true &&
      config.stagingSeasonOneResetInProgress === true &&
      config.stagingFreshSeasonOneReset === true &&
      Number(config.activeSeasonNumber) === 1 &&
      String(config.phase || '').toUpperCase() === 'REGULAR_SEASON' &&
      config.worldReady === true &&
      config.pyramidCupRequired === true &&
      config.pyramidCupReady === false &&
      Number(config.pyramidCupReadySeasonNumber) === 1;
    const resetInProgress = config.stagingSeasonOneResetInProgress === true ||
      config.stagingFreshSeasonOneReset === true;
    if (resetInProgress && !stagingResetBootstrapAllowed) {
      return { status: 'RESET_IN_PROGRESS' };
    }
    if (cupSnap.exists) return { status: 'ALREADY_EXISTS' };

    // One transaction commits all 120 participant snapshots, 56 opening
    // fixtures and the Cup root (177 writes total). Reading the reset config
    // here makes this write set conflict with a concurrent reset-marker claim.
    for (const snapshot of snapshotWrites) tx.create(snapshot.ref, snapshot.data);
    for (const fixture of fixtureWrites) tx.create(fixture.ref, fixture.data);
    tx.create(cupRef, cupData);
    return { status: 'CREATED' };
  });
}

export async function generatePyramidCup(
  targetSeasonNumber?: number,
  options: { allowInitialBootstrap?: boolean } = {},
) {
  const db = getAdminDb();
  const context = await readActiveCupSeasonContext(db, Date.now(), targetSeasonNumber, options);
  if (!context.ready) throw new Error(context.reason);
  const season = Number(targetSeasonNumber || context.season);
  if (season !== context.season) throw new Error('CUP_TARGET_SEASON_NOT_ACTIVE');
  const id = cupId(season);
  const ref = db.collection(CUP_COLLECTION).doc(id);
  if ((await ref.get()).exists) return { success: true, alreadyExists: true, cupId: id };
  const teams = await loadAllLeagueTeams(db, season);
  const seasonStart = context.seasonStart;
  const first = createPreliminary(teams);
  const scheduledAt = Timestamp.fromDate(roundDate(seasonStart, ROUND_DAYS[0]));
  const snapshotWrites = teams.map(team => ({
    ref: participantSnapshotRef(db, season, team.id),
    data: {
      cupId: id,
      season,
      teamId: team.id,
      matchSnapshot: team.matchSnapshot,
      createdAt: FieldValue.serverTimestamp(),
    },
  }));
  const fixtureWrites = first.flatMap(pairing => {
    if (!pairing.home || !pairing.away) return [];
    pairing.matchId = matchId(season, 1, pairing.index);
    return [{
      ref: db.collection(MATCH_COLLECTIONS.cup).doc(pairing.matchId),
      data: buildCupRoundMatchData(season, 1, pairing, scheduledAt),
    }];
  });
  const openingRoundRestTeams = teams.filter(team => team.level === 1);
  if (openingRoundRestTeams.length !== TEAMS_PER_GROUP) throw new Error('CUP_D1_OPENING_ROUND_REST_COUNT_INVALID');
  const rounds: Record<string, any[]> = { [roundKey(1)]: first.map(publicPairing) };
  for (let round = 2; round <= ROUND_COUNT; round++) rounds[roundKey(round)] = [];
  // D1's eight teams are explicitly recorded as round-two entrants, not BYEs.
  const cupData = {
    id, season, leagueId: LEAGUE_ID, name: 'Кубок Пирамиды', status: 'active', currentRound: 1,
    formatVersion: CUP_FORMAT_VERSION, format: 'D1_REST_OPENING_ROUND',
    totalRounds: ROUND_COUNT, totalParticipants: TOTAL_TEAMS, totalMatches: TOTAL_CUP_MATCHES, preliminaryMatches: 56,
    openingRoundRestCount: openingRoundRestTeams.length,
    openingRoundRestTeams: openingRoundRestTeams.map(publicTeam),
    byeCount: 0, participants: teams.map(publicTeam), rounds, winnerId: null, winnerName: null,
    seasonStart: seasonStart.toISOString(), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), version: 4,
  };

  try {
    const committed = await commitPyramidCupCreation(
      db,
      db.collection('system_v1').doc('season_config'),
      ref,
      snapshotWrites,
      fixtureWrites,
      cupData,
      { allowStagingResetBootstrap: options.allowInitialBootstrap === true },
    );
    if (committed.status === 'RESET_IN_PROGRESS') {
      throw new Error('STAGING_SEASON_ONE_RESET_IN_PROGRESS');
    }
    if (committed.status === 'SEASON_CONFIG_MISSING') {
      throw new Error('SEASON_CONFIG_MISSING');
    }
    if (committed.status === 'ALREADY_EXISTS') {
      return { success: true, alreadyExists: true, cupId: id };
    }
  } catch (error: any) {
    if (error?.message === 'STAGING_SEASON_ONE_RESET_IN_PROGRESS' ||
        error?.message === 'SEASON_CONFIG_MISSING') throw error;
    const code = String(error?.code ?? '').toLowerCase().replace(/_/g, '-');
    if (code !== '6' && code !== 'already-exists') throw error;

    // A concurrent transaction may have committed the root first. A child
    // collision without that root remains an orphaned-data integrity failure.
    let competingCup: any;
    try {
      competingCup = await ref.get();
    } catch {
      throw error;
    }
    if (!competingCup.exists) throw error;
    return { success: true, alreadyExists: true, cupId: id };
  }
  return { success: true, created: true, cupId: id, participants: TOTAL_TEAMS, totalMatches: TOTAL_CUP_MATCHES, preliminaryMatches: 56, openingRoundRestCount: openingRoundRestTeams.length };
}
/**
 * Build and verify the next season's cup before that season is published.
 * The prepared calendar is already canonical, but its league is not active yet.
 * This is deliberately idempotent so every orchestrator retry can re-check it.
 */
export async function preparePyramidCupForSeason(targetSeasonNumber: number) {
  const db = getAdminDb();
  const context = await readActiveCupSeasonContext(db, Date.now(), targetSeasonNumber);
  if (!context.ready || context.prepared !== true) {
    return { success: false, reason: context.ready ? 'CUP_TARGET_IS_NOT_PREPARED' : context.reason, writesStarted: false };
  }
  const generated = await generatePyramidCup(targetSeasonNumber);
  const ref = db.collection(CUP_COLLECTION).doc(cupId(targetSeasonNumber));
  const snap = await ref.get();
  if (!snap.exists) return { success: false, reason: 'CUP_DOCUMENT_MISSING_AFTER_GENERATION' };
  const cup = snap.data() || {};
  const participants = Array.isArray(cup.participants) ? cup.participants : [];
  const rounds = cup.rounds && typeof cup.rounds === 'object' ? cup.rounds : {};
  const firstRound = Array.isArray(rounds.r1) ? rounds.r1 : [];
  if (Number(cup.season) !== targetSeasonNumber || cup.name !== 'Кубок Пирамиды' ||
      cup.status !== 'active' || Number(cup.formatVersion) !== CUP_FORMAT_VERSION ||
      cup.format !== 'D1_REST_OPENING_ROUND' || Number(cup.totalMatches) !== TOTAL_CUP_MATCHES || participants.length !== TOTAL_TEAMS ||
      new Set(participants.map((team: any) => String(team?.id || ''))).size !== TOTAL_TEAMS ||
      firstRound.length !== 56 || firstRound.some((pairing: any) => pairing?.status === 'bye')) {
    return { success: false, reason: 'CUP_PREPARED_BRACKET_INVALID', cupId: ref.id };
  }

  // All 120 clubs are registered. Only D2-D4 play in round one; all eight
  // D1 teams are stored as explicit round-two entrants and never as BYEs.
  const participantIds = new Set<string>(participants.map((team: any) => String(team?.id || '')));
  const orderedParticipants = [...participants].sort(compareStrength);
  const orderedEligible = orderedParticipants.filter((team: any) => Number(team.level) !== 1);
  const restTeams = Array.isArray(cup.openingRoundRestTeams) ? cup.openingRoundRestTeams : [];
  const restIds = new Set<string>(restTeams.map((team: any) => String(team?.id || '')));
  const d1Ids = new Set<string>(participants.filter((team: any) => Number(team?.level) === 1).map((team: any) => String(team?.id || '')));
  const bracketTeamIds = new Set<string>(firstRound.flatMap((pairing: any) =>
    [pairing?.home?.id, pairing?.away?.id].filter((id: any) => typeof id === 'string' && id.length > 0)
  ));
  if (participantIds.size !== TOTAL_TEAMS || orderedEligible.length !== TOTAL_TEAMS - TEAMS_PER_GROUP ||
      bracketTeamIds.size !== TOTAL_TEAMS - TEAMS_PER_GROUP ||
      [...bracketTeamIds].some(id => !participantIds.has(id)) ||
      participants.some((team: any) => !Number.isSafeInteger(Number(team?.seed)) || Number(team.seed) < 1 || Number(team.seed) > TOTAL_TEAMS) ||
      new Set(participants.map((team: any) => Number(team?.seed))).size !== TOTAL_TEAMS ||
      restTeams.length !== TEAMS_PER_GROUP || restIds.size !== TEAMS_PER_GROUP ||
      Number(cup.openingRoundRestCount) !== TEAMS_PER_GROUP ||
      d1Ids.size !== TEAMS_PER_GROUP || [...d1Ids].some(id => !restIds.has(id)) ||
      [...restIds].some(id => !d1Ids.has(id)) ||
      restTeams.some((team: any) => Number(team.level) !== 1 || !participantIds.has(String(team.id || ''))) ||
      [...restIds].some(id => bracketTeamIds.has(id)) ||
      [...participantIds].some(id => !bracketTeamIds.has(id) && !restIds.has(id)) ||
      [...restIds].some(id => !participantIds.has(id)) ||
      firstRound.some((pairing: any, index: number) => {
        const stronger = orderedEligible[orderedEligible.length - 2 - index * 2];
        const weaker = orderedEligible[orderedEligible.length - 1 - index * 2];
        return pairing?.away?.id !== stronger?.id || pairing?.home?.id !== weaker?.id;
      })) {
    return { success: false, reason: 'CUP_PREPARED_BRACKET_MEMBERSHIP_INVALID', cupId: ref.id };
  }

  // Verify every frozen participant snapshot, including D1 teams that enter
  // in round two. Fixture-only checks would miss deleted snapshots.
  const participantSnapshots = await Promise.all(participants.map((team: any) =>
    participantSnapshotRef(db, targetSeasonNumber, String(team?.id || '')).get()
  ));
  const invalidParticipantSnapshot = participantSnapshots.find((snapshot: any, index: number) => {
    if (!snapshot.exists) return true;
    const data = snapshot.data() || {};
    const frozen = data.matchSnapshot;
    return data.cupId !== ref.id ||
      Number(data.season) !== targetSeasonNumber ||
      data.teamId !== String(participants[index]?.id || '') ||
      frozen?.id !== String(participants[index]?.id || '') ||
      !Array.isArray(frozen?.players) ||
      frozen.players.length !== 5;
  });
  if (invalidParticipantSnapshot) {
    return { success: false, reason: 'CUP_PREPARED_PARTICIPANT_SNAPSHOT_INVALID', cupId: ref.id };
  }

  try {
    assertValidCupRoundPairings(firstRound as Pairing[], 1);
  } catch {
    return { success: false, reason: 'CUP_PREPARED_BRACKET_PAIRINGS_INVALID', cupId: ref.id };
  }
  const orderedPairings = [...firstRound].sort((a: any, b: any) => Number(a.index) - Number(b.index));
  if (orderedPairings.some((pairing: any, index: number) => {
    const expectedIndex = index + 1;
    const expectedPairingId = `r1_m${expectedIndex}`;
    return Number(pairing.index) !== expectedIndex || pairing.id !== expectedPairingId;
  })) {
    return { success: false, reason: 'CUP_PREPARED_BRACKET_PAIRINGS_INVALID', cupId: ref.id };
  }

  const fixtures = firstRound.filter((pairing: any) => pairing?.home && pairing?.away);
  if (fixtures.length !== 56 || fixtures.some((pairing: any) =>
    pairing.matchId !== matchId(targetSeasonNumber, 1, Number(pairing.index))
  )) return { success: false, reason: 'CUP_PREPARED_FIXTURE_COUNT_INVALID', cupId: ref.id };
  const fixtureSnapshots = await Promise.all(fixtures.map((pairing: any) =>
    db.collection(MATCH_COLLECTIONS.cup).doc(matchId(targetSeasonNumber, 1, Number(pairing.index))).get()
  ));
  const missing = fixtureSnapshots.filter((fixture: any) => !fixture.exists);
  if (missing.length) return { success: false, reason: 'CUP_PREPARED_FIXTURES_MISSING', missing: missing.length, cupId: ref.id };
  for (let index = 0; index < fixtures.length; index++) {
    const pairing = fixtures[index];
    const fixture = fixtureSnapshots[index].data() || {};
    const scheduledAtMs = fixture.scheduledAt?.toMillis?.() ?? Date.parse(String(fixture.scheduledAt || ''));
    if (fixture.cupId !== ref.id || Number(fixture.season) !== targetSeasonNumber ||
        Number(fixture.cupRound) !== 1 || fixture.homeId !== pairing.home.id ||
        fixture.awayId !== pairing.away.id || fixture.type !== 'cup' ||
        scheduledAtMs !== roundDate(context.seasonStart, ROUND_DAYS[0]).getTime()) {
      return { success: false, reason: 'CUP_PREPARED_FIXTURE_IDENTITY_INVALID', matchId: fixture.id || null, cupId: ref.id };
    }
    const homeSnapshot = fixture.homeTeamSnapshot;
    const awaySnapshot = fixture.awayTeamSnapshot;
    const homeParticipant = participantSnapshots[participants.findIndex((team: any) => team.id === pairing.home.id)]?.data()?.matchSnapshot;
    const awayParticipant = participantSnapshots[participants.findIndex((team: any) => team.id === pairing.away.id)]?.data()?.matchSnapshot;
    if (fixture.id !== pairing.matchId ||
        homeSnapshot?.id !== pairing.home.id || awaySnapshot?.id !== pairing.away.id ||
        !Array.isArray(homeSnapshot?.players) || homeSnapshot.players.length !== 5 ||
        !Array.isArray(awaySnapshot?.players) || awaySnapshot.players.length !== 5 ||
        JSON.stringify(homeSnapshot) !== JSON.stringify(homeParticipant) ||
        JSON.stringify(awaySnapshot) !== JSON.stringify(awayParticipant)) {
      return { success: false, reason: 'CUP_PREPARED_FIXTURE_SNAPSHOT_INVALID', matchId: fixture.id || null, cupId: ref.id };
    }
  }
  return {
    success: true,
    generated: generated.created === true,
    alreadyExists: generated.alreadyExists === true,
    cupId: ref.id,
    season: targetSeasonNumber,
    participants: participants.length,
    totalMatches: TOTAL_CUP_MATCHES,
    preliminaryMatches: fixtures.length,
    openingRoundRestCount: TEAMS_PER_GROUP,
    byes: 0,
    scheduledAt: roundDate(context.seasonStart, ROUND_DAYS[0]).toISOString(),
  };
}

async function loadCup(db: any, season: number) {
  const ref = db.collection(CUP_COLLECTION).doc(cupId(season));
  const snap = await ref.get();
  return snap.exists ? { ref, data: snap.data() || {} } : null;
}
function isMatchDue(value: any, now: number) {
  const ms = value?.toMillis?.() ?? Date.parse(String(value || ''));
  return Number.isFinite(ms) && ms <= now;
}
// Cup prize money is tied to the participant's division and the existing season-economy scale.
const DIVISION_CHAMPION_PRIZES: Record<number, number> = { 1: 4_000_000, 2: 1_800_000, 3: 900_000, 4: 350_000 };
async function payCupPrize(db: any, season: number, team: Team | null, place: 'champion' | 'finalist') {
  if (!team || !team.id || team.id.startsWith('BOT_')) return 0;
  const base = DIVISION_CHAMPION_PRIZES[team.level] || 0;
  const amount = Math.floor(base * (place === 'champion' ? 0.10 : 0.05));
  if (amount <= 0) return 0;
  const playerRef = db.collection('players_v14').doc(team.id);
  const ledgerRef = db.collection('economy_transactions').doc(`pyramid_cup_S${season}_${place}_${team.id}`);
  return db.runTransaction(async (tx: any) => {
    const resetConfigSnap = await tx.get(db.collection('system_v1').doc('season_config'));
    const resetState = resetConfigSnap.exists ? resetConfigSnap.data() || {} : {};
    if (resetState.stagingSeasonOneResetInProgress === true || resetState.stagingFreshSeasonOneReset === true) {
      throw new Error('STAGING_SEASON_ONE_RESET_IN_PROGRESS');
    }
    const [ledgerSnap, playerSnap] = await Promise.all([tx.get(ledgerRef), tx.get(playerRef)]);
    const rewardType = place === 'champion' ? 'PYRAMID_CUP_CHAMPION_REWARD' : 'PYRAMID_CUP_FINALIST_REWARD';
    const referenceId = `cup_s${season}_l${LEAGUE_ID}`;
    if (ledgerSnap.exists) {
      const receipt = ledgerSnap.data() || {};
      const replayAmount = resolveCupPrizeReplayAmount(receipt, {
        userId: team.id,
        amount,
        currency: 'credits',
        type: rewardType,
        referenceId,
        division: Number(team.level),
      });
      if (replayAmount === null) throw new Error('CUP_PRIZE_RECEIPT_CONFLICT');
      // A previous attempt may have credited this prize before the Cup root
      // completion transaction failed. Return the original amount on replay
      // so the completed Cup summary does not incorrectly record zero.
      return replayAmount;
    }
    if (!playerSnap.exists) return 0;
    const player = playerSnap.data() || {};
    const before = Math.max(0, Math.floor(Number(player.credits) || 0));
    const existingTrophies = Array.isArray(player.trophies) ? player.trophies : [];
    const trophyId = `pyramid-cup-season-${season}`;
    const hasPyramidCupTrophy = existingTrophies.some((item: any) => item?.id === trophyId);
    const shouldAddTrophy = place === 'champion' && !hasPyramidCupTrophy;
    tx.update(playerRef, {
      credits: before + amount,
      ...(shouldAddTrophy ? {
        trophies: [...existingTrophies, {
          id: trophyId,
          name: `Кубок Пирамиды — сезон ${season}`,
          type: 'pyramid_cup_champion',
          date: new Date().toISOString(),
          season,
        }],
      } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.create(ledgerRef, {
      userId: team.id, amount, currency: 'credits', type: rewardType,
      referenceId, description: `Pyramid Cup season ${season}: ${place}`,
      division: team.level, balanceBefore: before, balanceAfter: before + amount, timestamp: FieldValue.serverTimestamp(),
    });
    return amount;
  });
}

async function finishTechnically(db: any, season: number, round: number, pairing: Pairing, collectionName: 'cup_matches' | 'matches_v2' = 'cup_matches') {
  if (!pairing.home || !pairing.away || !pairing.matchId) return false;
  const ref = db.collection(collectionName).doc(String(pairing.matchId));
  // The fallback races the Universal Match Core worker. Read and write in one
  // transaction so whichever result commits first becomes authoritative.
  return db.runTransaction(async (tx: any) => {
    const resetConfigSnap = await tx.get(db.collection('system_v1').doc('season_config'));
    const resetState = resetConfigSnap.exists ? resetConfigSnap.data() || {} : {};
    if (resetState.stagingSeasonOneResetInProgress === true || resetState.stagingFreshSeasonOneReset === true) {
      throw new Error('STAGING_SEASON_ONE_RESET_IN_PROGRESS');
    }
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const existing: any = snap.data() || {};
    const terminal = isMatchReportFinished(existing);
    if (terminal && existing.winnerId) {
      // Repair report/processing metadata without touching the authoritative result.
      tx.set(ref, {
        isFinished: true,
        status: 'finished',
        isProcessing: false,
        processingToken: FieldValue.delete(),
        processingAt: FieldValue.delete(),
        reportStatus: existing.reportStatus === 'viewed' ? 'viewed' : 'new',
        seen: existing.seen === true,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return true;
    }

    // A completed knockout draw still needs a bracket winner. Preserve its real
    // score/report and apply only the deterministic seed tie-break when no winner exists.
    if (terminal) {
      const stronger = pairing.home!.seed < pairing.away!.seed ? pairing.home! : pairing.away!;
      tx.set(ref, {
        winnerId: stronger.id,
        winner: stronger.id === pairing.home!.id ? pairing.home!.name : pairing.away!.name,
        isFinished: true,
        status: 'finished',
        technicalDecision: true,
        technicalDecisionReason: 'Completed cup knockout draw resolved by deterministic seed tie-break',
        isProcessing: false,
        processingToken: FieldValue.delete(),
        processingAt: FieldValue.delete(),
        reportStatus: existing.reportStatus === 'viewed' ? 'viewed' : 'new',
        seen: existing.seen === true,
        finishedAt: existing.finishedAt || FieldValue.serverTimestamp(),
        resolvedAt: existing.resolvedAt || FieldValue.serverTimestamp(),
        playedAt: existing.playedAt || FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return true;
    }

    // Deadline fallback only: the stronger seeded team advances if Match Core could not finish in time.
    const stronger = pairing.home!.seed < pairing.away!.seed ? pairing.home! : pairing.away!;
    const winnerId = stronger.id;
    const homeWon = winnerId === pairing.home!.id;
    const bestOf = round === ROUND_COUNT ? 3 : 1;
    const scoreA = bestOf === 3 ? (homeWon ? 2 : 0) : (homeWon ? 1 : 0);
    const scoreB = bestOf === 3 ? (homeWon ? 0 : 2) : (homeWon ? 0 : 1);
    tx.set(ref, {
      id: String(pairing.matchId), type: 'cup', matchType: 'cup', source: 'pyramid-cup', cupId: cupId(season), cupRound: round,
      homeId: pairing.home!.id, awayId: pairing.away!.id, homeName: pairing.home!.name, awayName: pairing.away!.name,
      bestOf, matchFormat: `BO${bestOf}`, scoreA, scoreB, homeScore: scoreA, awayScore: scoreB,
      seriesScore: `${scoreA}-${scoreB}`, score: `${scoreA}-${scoreB}`, winner: homeWon ? pairing.home!.name : pairing.away!.name,
      winnerId, isFinished: true, status: 'finished', isProcessing: false,
      processingToken: FieldValue.delete(), processingAt: FieldValue.delete(),
      reportStatus: 'new', seen: false, technicalDecision: true,
      technicalDecisionReason: 'Cup round deadline reached before match core completed',
      resolvedAt: Timestamp.now(), playedAt: Timestamp.now(), updatedAt: FieldValue.serverTimestamp(), affectsLeagueStandings: false,
    }, { merge: true });
    return true;
  });
}

/**
 * Recover a legacy/interrupted round whose bracket was persisted before every
 * fixture document. The transaction creates only missing deterministic IDs;
 * existing results are never overwritten by a retry.
 */
async function repairCurrentRoundFixtures(db: any, cup: { ref: any; data: any }, activeSeasonStart: Date) {
  return db.runTransaction(async (tx: any) => {
    const resetConfigSnap = await tx.get(db.collection('system_v1').doc('season_config'));
    const resetState = resetConfigSnap.exists ? resetConfigSnap.data() || {} : {};
    if (resetState.stagingSeasonOneResetInProgress === true || resetState.stagingFreshSeasonOneReset === true) {
      throw new Error('STAGING_SEASON_ONE_RESET_IN_PROGRESS');
    }
    const cupSnap = await tx.get(cup.ref);
    if (!cupSnap.exists) return { repaired: 0, changed: false };
    const data = cupSnap.data() || {};
    if (data.status === 'completed') return { repaired: 0, changed: false };
    const season = Number(data.season);
    const round = Number(data.currentRound || 1);
    if (!Number.isSafeInteger(season) || season < 1 || !Number.isSafeInteger(round) || round < 1 || round > ROUND_COUNT) {
      throw new Error('CUP_ROUND_IDENTITY_INVALID');
    }
    const rounds: Record<string, any[]> = { ...(data.rounds || {}) };
    const rawPairings = rounds[roundKey(round)];
    if (!Array.isArray(rawPairings)) return { repaired: 0, changed: false };
    const pairings: Pairing[] = rawPairings.map((pairing: any) => ({ ...pairing }));
    let changed = false;
    const participantIds = [...new Set(pairings.flatMap(pairing =>
      [pairing.home?.id, pairing.away?.id].filter((id): id is string => Boolean(id))
    ))];
    const participantSnapshots = await Promise.all(participantIds.map(async teamId => ({
      teamId,
      snap: await tx.get(participantSnapshotRef(db, season, teamId)),
    })));
    const participantSnapshotById = new Map<string, MatchTeamSnapshot | null>(participantSnapshots.map(({ teamId, snap }) => [
      teamId,
      snap.exists ? (snap.data() || {}).matchSnapshot as MatchTeamSnapshot : null,
    ] as const));
    for (const pairing of pairings) {
      if (pairing.home) pairing.home.matchSnapshot = participantSnapshotById.get(pairing.home.id) || pairing.home.matchSnapshot;
      if (pairing.away) pairing.away.matchSnapshot = participantSnapshotById.get(pairing.away.id) || pairing.away.matchSnapshot;
    }
    const scheduledAt = Timestamp.fromDate(roundDate(
      resolveCupDate(data.seasonStart || activeSeasonStart),
      ROUND_DAYS[round - 1],
    ));
    const entries = pairings
      .filter(pairing => pairing.home && pairing.away)
      .map(pairing => {
        const expectedId = matchId(season, round, Number(pairing.index));
        if (pairing.matchId && pairing.matchId !== expectedId) {
          throw new Error('CUP_FIXTURE_ID_CONFLICT');
        }
        if (pairing.matchId !== expectedId) {
          pairing.matchId = expectedId;
          changed = true;
        }
        const expectedFixture = buildCupRoundMatchData(season, round, pairing, scheduledAt);
        return {
          pairing,
          expectedFixture,
          dedicatedRef: db.collection(MATCH_COLLECTIONS.cup).doc(expectedId),
          legacyRef: db.collection('matches_v2').doc(expectedId),
        };
      });
    const snapshots = await Promise.all(entries.map(async entry => ({
      dedicated: await tx.get(entry.dedicatedRef),
      legacy: await tx.get(entry.legacyRef),
    })));
    let repaired = 0;
    entries.forEach((entry, index) => {
      const existing = snapshots[index].dedicated.exists
        ? snapshots[index].dedicated.data() || {}
        : snapshots[index].legacy.exists ? snapshots[index].legacy.data() || {} : null;
      if (existing) {
        // Preserve historical results, but never trust a malformed fixture.
        if (!isCupRoundFixtureCompatible(existing, entry.expectedFixture)) {
          throw new Error('CUP_FIXTURE_RECOVERY_CONFLICT');
        }
        return;
      }
      tx.create(entry.dedicatedRef, entry.expectedFixture);
      repaired++;
    });
    if (changed || repaired > 0) {
      rounds[roundKey(round)] = pairings.map(publicPairing);
      tx.update(cup.ref, { rounds, updatedAt: FieldValue.serverTimestamp() });
    }
    return { repaired, changed };
  });
}

function assertValidCupRoundPairings(pairings: Pairing[], round: number) {
  const expectedCount = ROUND_PAIRING_COUNTS[round - 1];
  if (!Array.isArray(pairings) || pairings.length !== expectedCount) {
    throw new Error('CUP_ROUND_PAIRING_COUNT_INVALID');
  }
  const pairingIds = new Set<string>();
  const indexes = new Set<number>();
  const teamIds = new Set<string>();
  for (const pairing of pairings) {
    const index = Number(pairing?.index);
    if (!pairing || typeof pairing.id !== 'string' || !pairing.id ||
        !Number.isSafeInteger(index) || index < 1 || index > expectedCount ||
        pairing.id !== `r${round}_m${index}` ||
        pairingIds.has(pairing.id) || indexes.has(index)) {
      throw new Error('CUP_ROUND_PAIRING_IDENTITY_INVALID');
    }
    pairingIds.add(pairing.id);
    indexes.add(index);
    if (!['scheduled', 'finished'].includes(String(pairing.status)) ||
        !pairing.home?.id || !pairing.away?.id || pairing.home.id === pairing.away.id ||
        teamIds.has(pairing.home.id) || teamIds.has(pairing.away.id) ||
        (pairing.status === 'finished' && ![pairing.home.id, pairing.away.id].includes(String(pairing.winnerId || '')))) {
      throw new Error('CUP_ROUND_PARTICIPANTS_INVALID');
    }
    teamIds.add(pairing.home.id);
    teamIds.add(pairing.away.id);
  }
  if (ROUND_BYE_COUNTS[round - 1] !== 0 || teamIds.size !== ROUND_TEAM_COUNTS[round - 1]) {
    throw new Error('CUP_ROUND_BYE_COUNT_INVALID');
  }
  return { pairings: pairings.length, byes: 0, teams: teamIds.size };
}

export async function runPyramidCupCycle() {
  const db = getAdminDb();
  const resetConfig = await db.collection('system_v1').doc('season_config').get();
  const resetState = resetConfig.exists ? resetConfig.data() || {} : {};
  if (resetState.stagingSeasonOneResetInProgress === true || resetState.stagingFreshSeasonOneReset === true) {
    return { generated: false, resolved: 0, advanced: 0, skipped: true, reason: 'STAGING_SEASON_ONE_RESET_IN_PROGRESS' };
  }
  const context = await readActiveCupSeasonContext(db);
  if (!context.ready) {
    return { generated: false, resolved: 0, advanced: 0, waitingForSeason: true, reason: context.reason };
  }
  const season = context.season;
  let cup = await loadCup(db, season);
  if (!cup) {
    if (context.seasonDay < 1 || context.seasonDay > 13) return { generated: false, resolved: 0, advanced: 0, waiting: true };
    try { await generatePyramidCup(season); return { generated: true, resolved: 0, advanced: 0 }; }
    catch (error: any) {
      if (String(error?.message || '').startsWith('CUP_LEAGUE_TABLE_MISSING')) return { generated: false, resolved: 0, advanced: 0, waitingForLeague: true };
      throw error;
    }
  }
  if (cup.data.status === 'completed') return { generated: false, resolved: 0, advanced: 0, completed: true };
  if (Number(cup.data.formatVersion) !== CUP_FORMAT_VERSION || cup.data.format !== 'D1_REST_OPENING_ROUND' ||
      Number(cup.data.totalMatches) !== TOTAL_CUP_MATCHES) {
    return { generated: false, resolved: 0, advanced: 0, incompatibleFormat: true, reason: 'CUP_FORMAT_VERSION_MISMATCH' };
  }

  const currentRoundBeforeRepair = Number(cup.data.currentRound || 1);
  const storedRounds = cup.data.rounds && typeof cup.data.rounds === 'object' ? cup.data.rounds : {};
  const openingRound = Array.isArray(storedRounds.r1) ? storedRounds.r1 : [];
  if (!Number.isSafeInteger(currentRoundBeforeRepair) ||
      currentRoundBeforeRepair < 1 ||
      currentRoundBeforeRepair > ROUND_COUNT ||
      !isCanonicalPyramidCupOpeningField(
        cup.data.participants,
        openingRound,
        cup.data.openingRoundRestTeams,
      ) ||
      !isPyramidCupRoundProgressionValid(
        storedRounds,
        currentRoundBeforeRepair,
        cup.data.openingRoundRestTeams,
      )) {
    console.error('[PYRAMID CUP] Bracket integrity check failed', {
      cupId: cup.data.id,
      currentRound: currentRoundBeforeRepair,
    });
    return {
      generated: false,
      resolved: 0,
      advanced: 0,
      integrityFailed: true,
      reason: 'CUP_BRACKET_INTEGRITY_FAILED',
      currentRound: currentRoundBeforeRepair,
    };
  }

  const activeSeasonStart = resolveCupDate(cup.data.seasonStart || context.seasonStart);
  const fixtureRepair = await repairCurrentRoundFixtures(db, cup, activeSeasonStart);
  if (fixtureRepair.repaired > 0 || fixtureRepair.changed) {
    console.warn('[PYRAMID CUP] Recovered interrupted round fixtures', { cupId: cup.data.id, ...fixtureRepair });
    cup = await loadCup(db, season);
    if (!cup) throw new Error('CUP_DISAPPEARED_DURING_FIXTURE_RECOVERY');
  }

  const round = Number(cup.data.currentRound || 1);
  if (!Number.isSafeInteger(round) || round < 1 || round > ROUND_COUNT) {
    throw new Error('CUP_CURRENT_ROUND_INVALID');
  }
  const rounds: Record<string, any[]> = { ...(cup.data.rounds || {}) };
  const pairings: Pairing[] = Array.isArray(rounds[roundKey(round)]) ? rounds[roundKey(round)] : [];
  assertValidCupRoundPairings(pairings, round);
  const now = Date.now();
  const seasonStart = resolveCupDate(cup.data.seasonStart || activeSeasonStart);
  const deadlineDay = ROUND_DAYS[round] ?? (ROUND_DAYS[ROUND_COUNT - 1] + 1);
  const nextRoundDeadline = roundDate(seasonStart, deadlineDay).getTime();
  let resolved = 0;

  for (const pairing of pairings) {
    if (!pairing?.matchId || pairing.status !== 'scheduled') continue;
    const dedicatedRef = db.collection(MATCH_COLLECTIONS.cup).doc(String(pairing.matchId));
    const dedicatedSnap = await dedicatedRef.get();
    const legacyRef = dedicatedSnap.exists ? null : db.collection('matches_v2').doc(String(pairing.matchId));
    const legacySnap = legacyRef ? await legacyRef.get() : null;
    const matchRef = dedicatedSnap.exists ? dedicatedRef : legacyRef;
    const matchSnap = dedicatedSnap.exists ? dedicatedSnap : legacySnap;
    if (!matchRef || !matchSnap?.exists) continue;
    let match: any = matchSnap.data() || {};
    const startMs = match.startTime?.toMillis?.() ?? Date.parse(String(match.startTime || match.scheduledAt || ''));
    if (Number.isFinite(startMs) && startMs > now) continue;
    if (!isMatchReportFinished(match)) {
      try { await resolveUniversalMatchDocument(String(pairing.matchId), { requireDue: true, collectionName: dedicatedSnap.exists ? 'cup_matches' : 'matches_v2' }); resolved++; }
      catch (error) { console.error('[PYRAMID CUP] Match Core resolution failed', pairing.matchId, error); }
    }
    const fresh = await matchRef.get();
    match = fresh.data() || {};
    if ((!isMatchReportFinished(match) || !match.winnerId) && now >= nextRoundDeadline) {
      await finishTechnically(db, season, round, pairing, dedicatedSnap.exists ? 'cup_matches' : 'matches_v2');
      const technical = await matchRef.get();
      match = technical.data() || {};
    }
    if (isMatchReportFinished(match) && match.winnerId) {
      pairing.status = 'finished'; pairing.winnerId = String(match.winnerId);
      pairing.scoreA = Number(match.scoreA ?? match.homeScore ?? 0); pairing.scoreB = Number(match.scoreB ?? match.awayScore ?? 0);
      pairing.technicalDecision = Boolean(match.technicalDecision);
    }
  }

  if (pairings.some(p => p?.home && p?.away && p.status === 'scheduled')) {
    const committed = await commitCupRoundState(db, cup.ref, round, pairings);
    return { generated: false, resolved, advanced: 0, waitingForMatches: true, stale: !committed };
  }
  if (round >= ROUND_COUNT) {
    const finalPair = pairings.find(p => p?.home && p?.away && p.winnerId);
    const winnerId = finalPair?.winnerId || null;
    const winner = finalPair?.home?.id === winnerId ? finalPair.home : finalPair?.away?.id === winnerId ? finalPair.away : null;
    const finalist = finalPair?.home?.id === winnerId ? finalPair?.away : finalPair?.away?.id === winnerId ? finalPair?.home : null;
    const [championPrize, finalistPrize] = await Promise.all([
      payCupPrize(db, season, winner ? teamFromPublic(winner) : null, 'champion'),
      payCupPrize(db, season, finalist ? teamFromPublic(finalist) : null, 'finalist'),
    ]);
    const committed = await commitCupRoundState(db, cup.ref, round, pairings, {
      completion: {
        status: 'completed',
        winnerId,
        winnerName: winner?.name || null,
        finalistId: finalist?.id || null,
        finalistName: finalist?.name || null,
        championPrize,
        finalistPrize,
        finishedAt: FieldValue.serverTimestamp(),
      },
    });
    return { generated: false, resolved, advanced: committed ? 1 : 0, completed: committed, stale: !committed, winnerId, championPrize, finalistPrize };
  }

  const winners: Team[] = [];
  for (const pairing of pairings) {
    if (pairing.winnerId) {
      const source = pairing.home?.id === pairing.winnerId ? pairing.home : pairing.away?.id === pairing.winnerId ? pairing.away : null;
      const team = teamFromPublic(source); if (team) winners.push(team);
    }
  }
  // D1's eight teams were explicitly rested in round one. They join the 56
  // opening-round winners now, creating a complete 64-team round-two field.
  if (round === 1) {
    const restTeams = Array.isArray(cup.data.openingRoundRestTeams) ? cup.data.openingRoundRestTeams : [];
    if (restTeams.length !== TEAMS_PER_GROUP) throw new Error('CUP_D1_OPENING_ROUND_REST_COUNT_INVALID');
    for (const value of restTeams) {
      const team = teamFromPublic(value);
      if (!team || team.level !== 1 || winners.some(existing => existing.id === team.id)) {
        throw new Error('CUP_D1_OPENING_ROUND_REST_TEAM_INVALID');
      }
      winners.push(team);
    }
  }
  const expectedWinners = ROUND_TEAM_COUNTS[round];
  if (winners.length !== expectedWinners) throw new Error(`CUP_WINNER_COUNT_INVALID:R${round}:${winners.length}:EXPECTED:${expectedWinners}`);
  const nextRound = round + 1;
  const nextPairs = buildRoundPairings(nextRound, winners);
  const committed = await commitCupRoundTransition(
    db, cup.ref, season, seasonStart, round, pairings, nextRound, nextPairs,
  );
  return { generated: false, resolved, advanced: committed ? 1 : 0, currentRound: committed ? nextRound : round, stale: !committed, advancingTeams: winners.length };
}
