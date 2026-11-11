import 'server-only';

/** Canonical Pyramid Cup engine. All sporting simulations use Universal Match Core. */
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { getTableId, MAX_LEVELS, TEAMS_PER_GROUP, TOTAL_GROUPS } from '@/app/lib/leagues-data';
import { resolveUniversalMatchDocument } from '@/app/actions/universal-match-resolver';
import { MATCH_COLLECTIONS } from '@/app/lib/match-storage';
import { getGlobalSeasonInfo } from '@/app/lib/time-utils';

const LEAGUE_ID = 'ALPHA';
const CUP_COLLECTION = 'cup_pyramid_v1';
const TOTAL_TEAMS = TOTAL_GROUPS * TEAMS_PER_GROUP;
const ROUND_COUNT = 7; // preliminary + 64-team round + 32 + 16 + 8 + 4 + final
const ROUND_DAYS = [2, 3, 4, 5, 6, 7, 8]; // day after league tour 1, then daily
const CUP_START_HOUR_UTC = 4; // 07:00 Moscow time

type Team = { id: string; name: string; level: number; group: number; rank: number; isBot: boolean; seed: number };
type Pairing = { id: string; index: number; home: Team | null; away: Team | null; status: 'scheduled' | 'bye' | 'finished'; matchId?: string | null; winnerId?: string | null; scoreA?: number | null; scoreB?: number | null; technicalDecision?: boolean };

function cupId(season: number) { return `cup_s${season}_l${LEAGUE_ID}`; }
function matchId(season: number, round: number, index: number) { return `cup_S${season}_R${round}_M${String(index).padStart(2, '0')}`; }
function roundKey(round: number) { return `r${round}`; }
function roundDate(seasonStart: Date, seasonDay: number) {
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
      const byRank = new Map<number, any>();
      for (const value of Object.values(stats) as any[]) {
        const rank = Number(value?.rank);
        if (rank >= 1 && rank <= TEAMS_PER_GROUP && !byRank.has(rank)) byRank.set(rank, value);
      }
      for (let rank = 1; rank <= TEAMS_PER_GROUP; rank++) teams.push(normalizeTeam(byRank.get(rank), level, group, rank));
    }
  }
  if (teams.length !== TOTAL_TEAMS) throw new Error(`CUP_PARTICIPANT_COUNT_INVALID:${teams.length}`);
  if (new Set(teams.map(t => t.id)).size !== TOTAL_TEAMS) throw new Error('CUP_DUPLICATE_PARTICIPANTS');
  teams.sort(compareStrength);
  return teams.map((team, i) => ({ ...team, seed: i + 1 }));
}
function publicTeam(team: Team | null) {
  return team ? { id: team.id, name: team.name, level: team.level, group: team.group, rank: team.rank, seed: team.seed, isBot: team.isBot } : null;
}
function makePair(id: string, index: number, firstStrong: Team, secondWeak: Team): Pairing {
  // The stronger team is always AWAY; weaker team is HOME.
  return { id, index, home: secondWeak, away: firstStrong, status: 'scheduled', matchId: null, winnerId: null, scoreA: null, scoreB: null };
}
function createPreliminary(teams: Team[]): Pairing[] {
  // The eight D1 teams are the strongest and wait. The other 112 teams play 56 preliminary matches.
  const eligible = teams.slice(8).sort(compareStrength);
  const pairs: Pairing[] = [];
  for (let i = 0; i < 56; i++) pairs.push(makePair(`r1_m${i + 1}`, i + 1, eligible[i], eligible[eligible.length - 1 - i]));
  for (let i = 0; i < 8; i++) {
    const team = teams[i];
    pairs.push({ id: `r1_bye_${i + 1}`, index: 56 + i + 1, home: team, away: null, status: 'bye', winnerId: team.id, scoreA: null, scoreB: null });
  }
  return pairs;
}
function teamFromPublic(value: any): Team | null {
  if (!value?.id) return null;
  return { id: String(value.id), name: String(value.name || value.id), level: Number(value.level || 4), group: Number(value.group || 1), rank: Number(value.rank || 8), isBot: Boolean(value.isBot), seed: Number(value.seed || 0) };
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
async function createRoundMatches(db: any, season: number, round: number, pairings: Pairing[], seasonStart: Date) {
  const batch = db.batch();
  const scheduledAt = Timestamp.fromDate(roundDate(seasonStart, ROUND_DAYS[round - 1]));
  for (const pairing of pairings) {
    if (!pairing.home || !pairing.away) continue;
    const id = matchId(season, round, pairing.index);
    pairing.matchId = id;
    const isFinal = round === ROUND_COUNT;
    batch.set(db.collection(MATCH_COLLECTIONS.cup).doc(id), {
      id, type: 'cup', matchType: 'cup', source: 'pyramid-cup', cupId: cupId(season), cupRound: round,
      cupRoundLabel: isFinal ? 'final' : round === 1 ? 'preliminary' : `round_${round}`,
      season, leagueId: LEAGUE_ID, homeId: pairing.home.id, awayId: pairing.away.id,
      homeName: pairing.home.name, awayName: pairing.away.name,
      homeRank: pairing.home.rank, awayRank: pairing.away.rank,
      homeLevel: pairing.home.level, awayLevel: pairing.away.level,
      homeGroup: pairing.home.group, awayGroup: pairing.away.group,
      homeSeed: pairing.home.seed, awaySeed: pairing.away.seed,
      bestOf: isFinal ? 3 : 1, scheduledAt, startTime: scheduledAt, scheduledStartAt: scheduledAt,
      status: 'scheduled', isFinished: false, isProcessing: false, reportStatus: 'pending', seen: false,
      affectsLeagueStandings: false, version: 141,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  await batch.commit();
  return pairings;
}

export async function generatePyramidCup(targetSeasonNumber?: number) {
  const db = getAdminDb();
  const info = getGlobalSeasonInfo();
  const season = Number(targetSeasonNumber || info.seasonNumber || 1);
  const id = cupId(season);
  const ref = db.collection(CUP_COLLECTION).doc(id);
  if ((await ref.get()).exists) return { success: true, alreadyExists: true, cupId: id };
  const teams = await loadAllLeagueTeams(db, season);
  const seasonStart = info.currentSeasonStart;
  const first = createPreliminary(teams);
  const rounds: Record<string, any[]> = { [roundKey(1)]: first };
  for (let round = 2; round <= ROUND_COUNT; round++) rounds[roundKey(round)] = [];
  await ref.create({
    id, season, leagueId: LEAGUE_ID, name: 'Кубок Пирамиды', status: 'active', currentRound: 1,
    totalRounds: ROUND_COUNT, totalParticipants: TOTAL_TEAMS, preliminaryMatches: 56, byeCount: 8,
    participants: teams.map(publicTeam), rounds, winnerId: null, winnerName: null,
    seasonStart: seasonStart.toISOString(), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), version: 3,
  });
  await createRoundMatches(db, season, 1, first, seasonStart);
  await ref.update({ rounds: { ...rounds, [roundKey(1)]: first }, updatedAt: FieldValue.serverTimestamp() });
  return { success: true, created: true, cupId: id, participants: TOTAL_TEAMS, preliminaryMatches: 56 };
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
    const [ledgerSnap, playerSnap] = await Promise.all([tx.get(ledgerRef), tx.get(playerRef)]);
    if (ledgerSnap.exists || !playerSnap.exists) return 0;
    const player = playerSnap.data() || {};
    const before = Math.max(0, Math.floor(Number(player.credits) || 0));
    tx.update(playerRef, { credits: before + amount, updatedAt: FieldValue.serverTimestamp() });
    tx.create(ledgerRef, {
      userId: team.id, amount, currency: 'credits', type: place === 'champion' ? 'PYRAMID_CUP_CHAMPION_REWARD' : 'PYRAMID_CUP_FINALIST_REWARD',
      referenceId: `cup_s${season}_l${LEAGUE_ID}`, description: `Pyramid Cup season ${season}: ${place}`,
      division: team.level, balanceBefore: before, balanceAfter: before + amount, timestamp: FieldValue.serverTimestamp(),
    });
    return amount;
  });
}

async function finishTechnically(db: any, season: number, round: number, pairing: Pairing, collectionName: 'cup_matches' | 'matches_v2' = 'cup_matches') {
  if (!pairing.home || !pairing.away || !pairing.matchId) return false;
  const ref = db.collection(collectionName).doc(String(pairing.matchId));
  const snap = await ref.get();
  const existing: any = snap.data() || {};
  if (existing.isFinished === true && existing.winnerId) return true;
  // Deadline fallback only: the stronger seeded team advances if Match Core could not finish in time.
  const stronger = pairing.home.seed < pairing.away.seed ? pairing.home : pairing.away;
  const winnerId = stronger.id;
  const homeWon = winnerId === pairing.home.id;
  const bestOf = round === ROUND_COUNT ? 3 : 1;
  const scoreA = bestOf === 3 ? (homeWon ? 2 : 0) : (homeWon ? 1 : 0);
  const scoreB = bestOf === 3 ? (homeWon ? 0 : 2) : (homeWon ? 0 : 1);
  await ref.set({
    id: String(pairing.matchId), type: 'cup', matchType: 'cup', source: 'pyramid-cup', cupId: cupId(season), cupRound: round,
    homeId: pairing.home.id, awayId: pairing.away.id, homeName: pairing.home.name, awayName: pairing.away.name,
    bestOf, matchFormat: `BO${bestOf}`, scoreA, scoreB, homeScore: scoreA, awayScore: scoreB,
    seriesScore: `${scoreA}-${scoreB}`, score: `${scoreA}-${scoreB}`, winner: homeWon ? pairing.home.name : pairing.away.name,
    winnerId, isFinished: true, status: 'finished', reportStatus: 'new', seen: false, technicalDecision: true,
    technicalDecisionReason: 'Cup round deadline reached before match core completed',
    resolvedAt: Timestamp.now(), playedAt: Timestamp.now(), updatedAt: FieldValue.serverTimestamp(), affectsLeagueStandings: false,
  }, { merge: true });
  return true;
}

export async function runPyramidCupCycle() {
  const db = getAdminDb();
  const info = getGlobalSeasonInfo();
  const season = Number(info.seasonNumber || 1);
  let cup = await loadCup(db, season);
  if (!cup) {
    if (info.seasonDay < 1 || info.seasonDay > 13) return { generated: false, resolved: 0, advanced: 0, waiting: true };
    try { await generatePyramidCup(season); return { generated: true, resolved: 0, advanced: 0 }; }
    catch (error: any) {
      if (String(error?.message || '').startsWith('CUP_LEAGUE_TABLE_MISSING')) return { generated: false, resolved: 0, advanced: 0, waitingForLeague: true };
      throw error;
    }
  }
  if (cup.data.status === 'completed') return { generated: false, resolved: 0, advanced: 0, completed: true };

  const round = Number(cup.data.currentRound || 1);
  const rounds: Record<string, any[]> = { ...(cup.data.rounds || {}) };
  const pairings: Pairing[] = Array.isArray(rounds[roundKey(round)]) ? rounds[roundKey(round)] : [];
  const now = Date.now();
  const seasonStart = new Date(String(cup.data.seasonStart || info.currentSeasonStart.toISOString()));
  const nextRoundDeadline = round < ROUND_COUNT ? roundDate(seasonStart, ROUND_DAYS[round]) .getTime() : Number.POSITIVE_INFINITY;
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
    if (match.isFinished !== true) {
      try { await resolveUniversalMatchDocument(String(pairing.matchId), { requireDue: true, collectionName: dedicatedSnap.exists ? 'cup_matches' : 'matches_v2' }); resolved++; }
      catch (error) { console.error('[PYRAMID CUP] Match Core resolution failed', pairing.matchId, error); }
    }
    const fresh = await matchRef.get();
    match = fresh.data() || {};
    if ((match.isFinished !== true || !match.winnerId) && now >= nextRoundDeadline) {
      await finishTechnically(db, season, round, pairing, dedicatedSnap.exists ? 'cup_matches' : 'matches_v2');
      const technical = await matchRef.get();
      match = technical.data() || {};
    }
    if (match.isFinished === true && match.winnerId) {
      pairing.status = 'finished'; pairing.winnerId = String(match.winnerId);
      pairing.scoreA = Number(match.scoreA ?? match.homeScore ?? 0); pairing.scoreB = Number(match.scoreB ?? match.awayScore ?? 0);
      pairing.technicalDecision = Boolean(match.technicalDecision);
    }
  }

  if (pairings.some(p => p?.home && p?.away && p.status === 'scheduled')) {
    await cup.ref.update({ rounds, updatedAt: FieldValue.serverTimestamp() });
    return { generated: false, resolved, advanced: 0, waitingForMatches: true };
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
    await cup.ref.update({ rounds, currentRound: ROUND_COUNT, status: 'completed', winnerId, winnerName: winner?.name || null, finalistId: finalist?.id || null, finalistName: finalist?.name || null, championPrize, finalistPrize, finishedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    return { generated: false, resolved, advanced: 1, completed: true, winnerId, championPrize, finalistPrize };
  }

  const winners: Team[] = [];
  for (const pairing of pairings) {
    if (pairing.status === 'bye' && pairing.winnerId) {
      const team = teamFromPublic(pairing.home); if (team) winners.push(team);
    } else if (pairing.winnerId) {
      const source = pairing.home?.id === pairing.winnerId ? pairing.home : pairing.away?.id === pairing.winnerId ? pairing.away : null;
      const team = teamFromPublic(source); if (team) winners.push(team);
    }
  }
  const expectedWinners = 64 / Math.pow(2, round - 1);
  if (winners.length !== expectedWinners) throw new Error(`CUP_WINNER_COUNT_INVALID:R${round}:${winners.length}:EXPECTED:${expectedWinners}`);
  const nextRound = round + 1;
  const nextPairs = buildRoundPairings(nextRound, winners);
  rounds[roundKey(round)] = pairings; rounds[roundKey(nextRound)] = nextPairs;
  await createRoundMatches(db, season, nextRound, nextPairs, seasonStart);
  await cup.ref.update({ rounds, currentRound: nextRound, updatedAt: FieldValue.serverTimestamp() });
  return { generated: false, resolved, advanced: 1, currentRound: nextRound, advancingTeams: winners.length };
}
