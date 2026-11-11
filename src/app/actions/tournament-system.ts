'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';
import { getMoscowDateString } from '@/app/lib/time-utils';
import { hash32 } from '@/app/lib/hash-utils';
import { buildMatchTeamSnapshot, createDeterministicBotSquad } from '@/app/lib/match-simulation';
import { runMatchEngine } from '@/app/lib/match-engine';
import { MATCH_COLLECTIONS } from '@/app/lib/match-storage';

const TOURNAMENTS = [
  { id: 'iron-kettle', name: 'Чугунный чайник', type: 'Тов', maxParticipants: 16, start: '10:00' },
  { id: 'bronze-cup', name: 'Бронзовая чаша', type: 'Тов', maxParticipants: 32, start: '12:00' },
  { id: 'bronze-bull', name: 'Бронзовый бык', type: 'Тов', maxParticipants: 32, start: '14:00' },
  { id: 'iron-salad', name: 'Чугунная салатница', type: 'Тов', maxParticipants: 32, start: '16:00' },
  { id: 'iron-brick', name: 'Чугунный кирпич', type: 'Тов', maxParticipants: 32, start: '18:00' },
  { id: 'gold-kettle', name: 'Золотой чайник', type: 'Тов', maxParticipants: 32, start: '20:00' },
  { id: 'iron-globe', name: 'Чугунный глобус', type: 'Тов', maxParticipants: 32, start: '21:00' },
  { id: 'gold-globe', name: 'Золотой глобус', type: 'Тов', maxParticipants: 32, start: '22:00' },
] as const;

const GROUP_ROUND_MINUTES = 10;
const PLAYOFF_ROUND_MINUTES = 10;
const REGISTRATION_CLOSE_MINUTES = 5;
const POINTS_WIN = 3;
const POINTS_DRAW = 1;

type Stage = 'registration' | 'groups' | 'round_of_16' | 'quarterfinal' | 'semifinal' | 'final' | 'completed';

type Team = {
  id: string;
  name: string;
  isBot: boolean;
  players?: any[];
  lineup?: any;
  clubName?: string;
};

function moscowDateAt(dateString: string, hhmm: string) {
  const [y, m, d] = dateString.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  return Date.UTC(y, m - 1, d, hh - 3, mm, 0, 0);
}

function addMinutes(ms: number, minutes: number) { return ms + minutes * 60_000; }

function toSerializable<T>(value: T): any {
  if (value == null) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.getTime();
  if (Array.isArray(value)) return value.map(toSerializable);
  if (typeof value === 'object') {
    const candidate = value as any;
    if (typeof candidate.toMillis === 'function') return candidate.toMillis();
    if (typeof candidate.toDate === 'function') return candidate.toDate().getTime();
    const out: Record<string, any> = {};
    for (const [key, child] of Object.entries(candidate)) {
      out[key] = toSerializable(child);
    }
    return out;
  }
  return value;
}

function shuffle<T>(items: T[], seed: string): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = hash32(`${seed}:${i}`) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function stageForParticipants(maxParticipants: number): Exclude<Stage, 'registration' | 'groups' | 'completed'> {
  return maxParticipants === 16 ? 'quarterfinal' : 'round_of_16';
}

function stageStartOffset(maxParticipants: number, stage: Stage) {
  if (maxParticipants === 16) {
    return stage === 'quarterfinal' ? 30 : stage === 'semifinal' ? 40 : 50;
  }
  return stage === 'round_of_16' ? 30 : stage === 'quarterfinal' ? 40 : stage === 'semifinal' ? 50 : 60;
}

function groupCount(maxParticipants: number) { return maxParticipants / 4; }

function groupRoundPairs(groupTeams: string[], round: number) {
  const rounds = [
    [[0, 1], [2, 3]],
    [[0, 2], [1, 3]],
    [[0, 3], [1, 2]],
  ] as const;
  return rounds[round]!.map(([a, b]) => [groupTeams[a], groupTeams[b]] as const);
}

function drawKnockoutPairs(winners: Team[], runnersUp: Team[], seed: string) {
  const shuffledWinners = shuffle(winners, `${seed}:winners`);
  const shuffledRunners = shuffle(runnersUp, `${seed}:runners`);

  const result: Array<[Team, Team]> = [];
  const used = new Set<string>();

  function backtrack(index: number): boolean {
    if (index >= shuffledWinners.length) return true;
    const winner = shuffledWinners[index];
    const candidates = shuffledRunners
      .filter(r => !used.has(r.id) && r.id !== winner.id)
      .sort((a, b) => hash32(`${seed}:${winner.id}:${a.id}`) - hash32(`${seed}:${winner.id}:${b.id}`));

    for (const runner of candidates) {
      used.add(runner.id);
      result[index] = [winner, runner];
      if (backtrack(index + 1)) return true;
      used.delete(runner.id);
    }
    return false;
  }

  if (!backtrack(0)) throw new Error('KNOCKOUT_SEED_FAILED');
  return result;
}

async function readManager(db: any, id: string): Promise<Team | null> {
  const snap = await db.collection('players_v14').doc(id).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return {
    id,
    name: String(data.clubName || data.displayName || `Manager ${id.slice(0, 6)}`),
    isBot: false,
    players: Array.isArray(data.ownedPlayers) ? data.ownedPlayers : [],
    lineup: data.lineup || {},
    clubName: data.clubName || data.displayName,
  };
}

function botTeam(tournamentId: string, index: number): Team {
  const id = `bot_${tournamentId}_${index + 1}`;
  return {
    id,
    name: `bot${String(hash32(id) % 9000 + 1000)}`,
    isBot: true,
    players: createDeterministicBotSquad(id, 25),
    lineup: {},
  };
}

async function generateDailyTournamentsInternal() {
  const db = getAdminDb();
  const date = getMoscowDateString();
  const created: string[] = [];

  for (const template of TOURNAMENTS) {
    const id = `${date}_${template.id}`;
    const ref = db.collection('tournaments_v1').doc(id);
    const snap = await ref.get();
    if (snap.exists) continue;

    const startAt = moscowDateAt(date, template.start);
    const data = {
      id,
      date,
      templateId: template.id,
      name: template.name,
      type: template.type,
      prize: template.name,
      maxParticipants: template.maxParticipants,
      groupCount: groupCount(template.maxParticipants),
      groupSize: 4,
      format: 'GROUPS_BO2',
      status: 'registration',
      stage: 'registration' as Stage,
      registrationOpenAt: addMinutes(startAt, -120),
      registrationCloseAt: addMinutes(startAt, -REGISTRATION_CLOSE_MINUTES),
      startAt,
      registeredIds: [],
      participantCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      version: 1,
    };
    await ref.create(data);
    created.push(id);
  }

  return { date, created };
}

export async function generateDailyTournaments(cronToken: string) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || typeof cronToken !== 'string' || cronToken !== cronSecret) {
    return { success: false, error: 'UNAUTHORIZED' };
  }
  return generateDailyTournamentsInternal();
}
export async function ensureDailyTournamentsAction(idToken: string) {
  try {
    await requireServerActor(idToken);
    return { success: true, ...(await generateDailyTournamentsInternal()) };
  } catch (e: any) {
    return { success: false, error: e?.message || 'TOURNAMENT_GENERATION_FAILED' };
  }
}

export async function registerForTournamentAction(idToken: string, tournamentId: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const ref = db.collection('tournaments_v1').doc(tournamentId);
    const manager = await readManager(db, uid);
    if (!manager) throw new Error('PLAYER_NOT_FOUND');

    await db.runTransaction(async (t: any) => {
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error('TOURNAMENT_NOT_FOUND');
      const data = snap.data() || {};
      const now = Date.now();
      const ids: string[] = Array.isArray(data.registeredIds) ? data.registeredIds : [];
      if (data.status !== 'registration' || now >= Number(data.registrationCloseAt)) throw new Error('REGISTRATION_CLOSED');
      if (ids.includes(uid)) throw new Error('ALREADY_REGISTERED');
      if (ids.length >= Number(data.maxParticipants)) throw new Error('TOURNAMENT_FULL');
      t.update(ref, {
        registeredIds: [...ids, uid],
        participantCount: ids.length + 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return { success: true, team: { id: manager.id, name: manager.name } };
  } catch (e: any) {
    return { success: false, error: e?.message || 'TOURNAMENT_REGISTER_FAILED' };
  }
}

export async function unregisterFromTournamentAction(idToken: string, tournamentId: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    const db = getAdminDb();
    const ref = db.collection('tournaments_v1').doc(tournamentId);
    await db.runTransaction(async (t: any) => {
      const snap = await t.get(ref);
      if (!snap.exists) throw new Error('TOURNAMENT_NOT_FOUND');
      const data = snap.data() || {};
      if (data.status !== 'registration') throw new Error('REGISTRATION_CLOSED');
      const ids: string[] = Array.isArray(data.registeredIds) ? data.registeredIds : [];
      if (!ids.includes(uid)) throw new Error('NOT_REGISTERED');
      const next = ids.filter(id => id !== uid);
      t.update(ref, { registeredIds: next, participantCount: next.length, updatedAt: FieldValue.serverTimestamp() });
    });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message || 'TOURNAMENT_UNREGISTER_FAILED' };
  }
}

async function initializeTournament(db: any, tournamentId: string, now: number) {
  const ref = db.collection('tournaments_v1').doc(tournamentId);

  // Claim initialization transactionally so two cron/API invocations cannot
  // create the same groups and fixtures at the same time.
  const tournament = await db.runTransaction(async (t: any) => {
    const snap = await t.get(ref);
    if (!snap.exists) return null;
    const data = snap.data() || {};
    if (data.status !== 'registration' || now < Number(data.startAt)) return null;
    t.update(ref, {
      status: 'initializing',
      stage: 'initializing',
      initializingAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      initializationError: FieldValue.delete(),
    });
    return { id: snap.id, ...data };
  });
  if (!tournament) return false;

  try {
    const maxParticipants = Number(tournament.maxParticipants);
    if (![16, 32].includes(maxParticipants)) throw new Error('INVALID_TOURNAMENT_CAPACITY');

    // Normalize legacy/malformed registration data and remove duplicate IDs.
    const registeredIds: string[] = Array.from(new Set<string>(
      (Array.isArray(tournament.registeredIds) ? tournament.registeredIds : [])
        .filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
        .map((id: string) => id.trim())
    )).slice(0, maxParticipants);
    const managerResults = await Promise.all(registeredIds.map(id => readManager(db, id)));
    const realTeams = managerResults.filter((team): team is Team => Boolean(team));
    const uniqueRealTeams = Array.from(new Map(realTeams.map(team => [team.id, team])).values());
    const teams: Team[] = [...uniqueRealTeams];
    for (let i = teams.length; i < maxParticipants; i++) {
      // Bot IDs are based on the actual slot, not on the original registration
      // array index, so missing/deleted managers cannot create duplicate bots.
      teams.push(botTeam(tournamentId, i));
    }
    if (teams.length !== maxParticipants || new Set(teams.map(team => team.id)).size !== maxParticipants) {
      throw new Error('TOURNAMENT_PARTICIPANT_INTEGRITY_FAILED');
    }

    const shuffled = shuffle(teams, tournamentId);
    const groups = groupCount(maxParticipants);
    const batch = db.batch();

    for (let i = 0; i < shuffled.length; i++) {
      const groupIndex = Math.floor(i / 4);
      const groupId = String.fromCharCode(65 + groupIndex);
      const team = shuffled[i];
      batch.set(ref.collection('participants').doc(team.id), {
        ...team,
        groupId,
        seed: i + 1,
        tournamentId,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    for (let g = 0; g < groups; g++) {
      const groupId = String.fromCharCode(65 + g);
      const groupTeams = shuffled.slice(g * 4, g * 4 + 4);
      const standings = groupTeams.map(team => ({ id: team.id, name: team.name, isBot: team.isBot, played: 0, wins: 0, draws: 0, losses: 0, for: 0, against: 0, diff: 0, points: 0 }));
      batch.set(ref.collection('groups').doc(groupId), { groupId, teams: standings, status: 'active', updatedAt: FieldValue.serverTimestamp() });
      for (let round = 0; round < 3; round++) {
        const pairs = groupRoundPairs(groupTeams.map(t => t.id), round);
        for (let pairIndex = 0; pairIndex < pairs.length; pairIndex++) {
          const [homeId, awayId] = pairs[pairIndex];
          const matchId = `groups_${groupId}_${round + 1}_${pairIndex + 1}`;
          batch.set(ref.collection('matches').doc(matchId), {
            id: matchId,
            tournamentId,
            stage: 'groups',
            groupId,
            round: round + 1,
            index: pairIndex + 1,
            homeId,
            awayId,
            homeName: groupTeams.find(t => t.id === homeId)?.name || homeId,
            awayName: groupTeams.find(t => t.id === awayId)?.name || awayId,
            bestOf: 2,
            scheduledAt: addMinutes(Number(tournament.startAt), round * GROUP_ROUND_MINUTES),
            status: 'scheduled',
            attemptCount: 0,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      }
    }

    batch.update(ref, {
      status: 'groups',
      stage: 'groups',
      registeredIds,
      participantCount: teams.length,
      realParticipantCount: uniqueRealTeams.length,
      botParticipantCount: teams.length - uniqueRealTeams.length,
      initializedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      initializationError: FieldValue.delete(),
    });
    await batch.commit();
    return true;
  } catch (error: any) {
    // Do not leave the tournament permanently locked if setup fails.
    await ref.update({
      status: 'registration',
      stage: 'registration',
      initializationError: String(error?.message || error || 'TOURNAMENT_INITIALIZATION_FAILED'),
      updatedAt: FieldValue.serverTimestamp(),
    }).catch(() => undefined);
    throw error;
  }
}

async function participantSnapshot(db: any, tournamentRef: any, id: string) {
  const snap = await tournamentRef.collection('participants').doc(id).get();
  return snap.exists ? snap.data() : null;
}

async function resolveTournamentMatch(db: any, tournamentId: string, matchId: string, now: number) {
  const tournamentRef = db.collection('tournaments_v1').doc(tournamentId);
  const matchRef = tournamentRef.collection('matches').doc(matchId);
  const claim = await db.runTransaction(async (t: any) => {
    const snap = await t.get(matchRef);
    if (!snap.exists) return false;
    const m = snap.data() || {};
    const attempts = Number(m.attemptCount || 0);
    if (!['scheduled', 'error'].includes(String(m.status)) || attempts >= 3 || Number(m.scheduledAt) > now) return false;
    t.update(matchRef, { status: 'processing', attemptCount: attempts + 1, processingAt: FieldValue.serverTimestamp(), lastError: FieldValue.delete() });
    return true;
  });
  if (!claim) return false;

  try {
    const matchSnap = await matchRef.get();
    const m = matchSnap.data() || {};
    const home = await participantSnapshot(db, tournamentRef, m.homeId);
    const away = await participantSnapshot(db, tournamentRef, m.awayId);
    if (!home || !away) throw new Error('TOURNAMENT_PARTICIPANT_NOT_FOUND');

    const simulation = runMatchEngine({
      mode: 'tournament',
      matchId: `${tournamentId}:${matchId}`,
      teamA: buildMatchTeamSnapshot(home, home.name, home.id),
      teamB: buildMatchTeamSnapshot(away, away.name, away.id),
      bestOf: 2,
    });

    let winnerId: string | null = simulation.winnerSide === 'home' ? home.id : simulation.winnerSide === 'away' ? away.id : null;
    if (!winnerId && m.stage !== 'groups') {
      winnerId = home.id === away.id ? home.id : (simulation.homeStrength >= simulation.awayStrength ? home.id : away.id);
    }

    const homeScore = simulation.games.reduce((s, g) => s + g.homeScore, 0);
    const awayScore = simulation.games.reduce((s, g) => s + g.awayScore, 0);

    await db.runTransaction(async (t: any) => {
      const fresh = await t.get(matchRef);
      if (!fresh.exists || fresh.data()?.status !== 'processing') return;
      const groupRef = m.stage === 'groups' ? tournamentRef.collection('groups').doc(m.groupId) : null;
      const groupSnap = groupRef ? await t.get(groupRef) : null;

      const finishedAt = FieldValue.serverTimestamp();
      const winnerName = winnerId === home.id ? home.name : winnerId === away.id ? away.name : null;
      t.update(matchRef, {
        status: 'finished',
        finishedAt,
        result: simulation,
        winnerId,
        winnerName,
        homeScore,
        awayScore,
      });

      // Tournament reports are stored separately from league and cup matches.
      // Use a stable ID so retries cannot create duplicate reports for a fixture.
      const reportId = `tournament_${tournamentId}_${matchId}`;
      t.set(db.collection(MATCH_COLLECTIONS.tournament).doc(reportId), {
        id: reportId,
          matchType: 'tournament',
        tournamentId,
        tournamentMatchId: matchId,
        tournamentName: String(m.tournamentName || tournamentId),
        stage: String(m.stage || ''),
        homeId: home.id,
        awayId: away.id,
        homeName: home.name,
        awayName: away.name,
        homeLogo: home.clubLogo || home.logo || null,
        awayLogo: away.clubLogo || away.logo || null,
        homeScore,
        awayScore,
        scoreA: homeScore,
        scoreB: awayScore,
        seriesScore: `${homeScore}-${awayScore}`,
        winnerId,
        winner: winnerName,
        simulation,
        games: simulation.games,
        isFinished: true,
        seen: false,
        reportStatus: 'new',
        playedAt: finishedAt,
        resolvedAt: finishedAt,
        finishedAt,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      if (m.stage === 'groups' && groupRef && groupSnap) {
        if (groupSnap.exists) {
          const group = groupSnap.data() || {};
          const rows = Array.isArray(group.teams) ? [...group.teams] : [];
          const homeRow = rows.find((r: any) => r.id === home.id);
          const awayRow = rows.find((r: any) => r.id === away.id);
          if (homeRow && awayRow) {
            homeRow.played += 1; awayRow.played += 1;
            homeRow.for += homeScore; homeRow.against += awayScore;
            awayRow.for += awayScore; awayRow.against += homeScore;
            homeRow.diff = homeRow.for - homeRow.against;
            awayRow.diff = awayRow.for - awayRow.against;
            if (homeScore === awayScore) {
              homeRow.draws += 1; awayRow.draws += 1;
              homeRow.points += POINTS_DRAW; awayRow.points += POINTS_DRAW;
            } else if (winnerId === home.id) {
              homeRow.wins += 1; homeRow.points += POINTS_WIN; awayRow.losses += 1;
            } else {
              awayRow.wins += 1; awayRow.points += POINTS_WIN; homeRow.losses += 1;
            }
            rows.sort((a: any, b: any) => b.points - a.points || b.diff - a.diff || b.wins - a.wins || a.name.localeCompare(b.name));
            t.update(groupRef, { teams: rows, updatedAt: FieldValue.serverTimestamp() });
          }
        }
      }
    });
    return true;
  } catch (error) {
    await matchRef.update({ status: 'error', error: String((error as any)?.message || error), lastError: String((error as any)?.message || error), failedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    return false;
  }
}

async function stageMatchesDone(tournamentRef: any, stage: string, expectedCount: number) {
  const snap = await tournamentRef.collection('matches').where('stage', '==', stage).get();
  // Этап завершён только при полном ожидаемом наборе уникальных матчей.
  // Ошибка симуляции, пропущенный матч или дубликат не должны продвигать сетку.
  if (snap.docs.length !== expectedCount) return false;
  const ids = new Set<string>();
  for (const doc of snap.docs) {
    const match = doc.data() || {};
    if (match.status !== 'finished' || !match.winnerId || !match.homeId || !match.awayId) return false;
    if (match.homeId === match.awayId) return false;
    const key = `${match.stage}:${match.index ?? doc.id}`;
    if (ids.has(key)) return false;
    ids.add(key);
  }
  return true;
}

function expectedStageMatchCount(maxParticipants: number, stage: string) {
  if (stage === 'groups') return (maxParticipants / 4) * 6;
  if (stage === 'round_of_16') return maxParticipants === 32 ? 8 : 0;
  if (stage === 'quarterfinal') return 4;
  if (stage === 'semifinal') return 2;
  if (stage === 'final') return 1;
  return 0;
}

async function advanceTournament(db: any, tournament: any, now: number) {
  const ref = db.collection('tournaments_v1').doc(tournament.id);
  const stage = tournament.stage as Stage;
  if (stage === 'groups') {
    if (!(await stageMatchesDone(ref, 'groups', expectedStageMatchCount(Number(tournament.maxParticipants), 'groups')))) return false;
    const groupsSnap = await ref.collection('groups').get();
    const expectedGroups = Number(tournament.maxParticipants) / 4;
    if (groupsSnap.docs.length !== expectedGroups) return false;
    const winners: Team[] = [];
    const runners: Team[] = [];
    const groupIds = new Set<string>();
    groupsSnap.docs.sort((a: any, b: any) => a.id.localeCompare(b.id)).forEach((d: any) => {
      if (groupIds.has(d.id)) throw new Error('DUPLICATE_TOURNAMENT_GROUP');
      groupIds.add(d.id);
      const rows = Array.isArray(d.data()?.teams) ? d.data().teams : [];
      if (rows.length !== 4 || rows.some((row: any) => !row?.id)) throw new Error(`INVALID_GROUP_STANDINGS:${d.id}`);
      if (new Set(rows.map((row: any) => row.id)).size !== 4) throw new Error(`DUPLICATE_GROUP_TEAM:${d.id}`);
      winners.push({ id: rows[0].id, name: rows[0].name, isBot: !!rows[0].isBot });
      runners.push({ id: rows[1].id, name: rows[1].name, isBot: !!rows[1].isBot });
    });
    if (winners.length !== expectedGroups || runners.length !== expectedGroups) return false;
    if (new Set([...winners, ...runners].map(team => team.id)).size !== expectedGroups * 2) {
      throw new Error('DUPLICATE_KNOCKOUT_QUALIFIER');
    }
    const pairs = drawKnockoutPairs(winners, runners, tournament.id);
    if (pairs.length !== expectedGroups || new Set(pairs.flatMap(pair => pair.map(team => team.id))).size !== expectedGroups * 2) {
      throw new Error('INVALID_KNOCKOUT_PAIRING');
    }
    const nextStage = stageForParticipants(Number(tournament.maxParticipants));
    const batch = db.batch();
    pairs.forEach(([home, away], index) => {
      const matchId = `${nextStage}_${index + 1}`;
      batch.set(ref.collection('matches').doc(matchId), {
        id: matchId, tournamentId: tournament.id, stage: nextStage, round: 1, index: index + 1,
        homeId: home.id, awayId: away.id, homeName: home.name, awayName: away.name,
        bestOf: 2, scheduledAt: addMinutes(Number(tournament.startAt), stageStartOffset(Number(tournament.maxParticipants), nextStage)), status: 'scheduled', createdAt: FieldValue.serverTimestamp(),
      });
    });
    batch.update(ref, { stage: nextStage, status: 'active', updatedAt: FieldValue.serverTimestamp() });
    await batch.commit();
    return true;
  }

  if (['round_of_16', 'quarterfinal', 'semifinal'].includes(stage)) {
    if (!(await stageMatchesDone(ref, stage, expectedStageMatchCount(Number(tournament.maxParticipants), stage)))) return false;
    const matches = await ref.collection('matches').where('stage', '==', stage).get();
    const ordered = matches.docs.sort((a: any, b: any) => Number(a.data()?.index || 0) - Number(b.data()?.index || 0));
    const stageExpected = expectedStageMatchCount(Number(tournament.maxParticipants), stage);
    if (ordered.length !== stageExpected) return false;
    const winners = ordered.map((d: any) => d.data()).map((m: any) => ({ id: m.winnerId, name: m.winnerName })).filter((x: any) => x.id);
    const nextStage: Stage = stage === 'round_of_16' ? 'quarterfinal' : stage === 'quarterfinal' ? 'semifinal' : 'final';
    if (winners.length !== stageExpected || new Set(winners.map((team: any) => team.id)).size !== winners.length || winners.length < 2 || winners.length % 2 !== 0) return false;
    const batch = db.batch();
    for (let i = 0; i < winners.length; i += 2) {
      const home = winners[i], away = winners[i + 1];
      const matchId = `${nextStage}_${i / 2 + 1}`;
      batch.set(ref.collection('matches').doc(matchId), {
        id: matchId, tournamentId: tournament.id, stage: nextStage, round: 1, index: i / 2 + 1,
        homeId: home.id, awayId: away.id, homeName: home.name, awayName: away.name,
        bestOf: 2, scheduledAt: addMinutes(Number(tournament.startAt), stageStartOffset(Number(tournament.maxParticipants), nextStage)), status: 'scheduled', createdAt: FieldValue.serverTimestamp(),
      });
    }
    batch.update(ref, { stage: nextStage, status: 'active', updatedAt: FieldValue.serverTimestamp() });
    await batch.commit();
    return true;
  }

  if (stage === 'final') {
    if (!(await stageMatchesDone(ref, 'final', 1))) return false;
    const finalSnap = await ref.collection('matches').where('stage', '==', 'final').limit(1).get();
    const finalMatch = finalSnap.docs[0]?.data();
    if (!finalMatch?.winnerId) return false;
    const finishedAt = Date.now();
    await ref.update({
      stage: 'completed', status: 'completed', winnerId: finalMatch.winnerId, winnerName: finalMatch.winnerName,
      finishedAt, updatedAt: FieldValue.serverTimestamp(),
    });

    const participantSnap = await ref.collection('participants').get();
    const updates = participantSnap.docs.map((d: any) => {
      const p = d.data();
      if (p.isBot) return null;
      return db.collection('players_v14').doc(p.id).update({
        tournamentHistory: FieldValue.arrayUnion({
          tournamentId: tournament.id, tournamentName: tournament.name, result: p.id === finalMatch.winnerId ? 'Победитель' : 'Участник',
          status: 'finished', startDate: new Date(Number(tournament.startAt)).toISOString(), endDate: new Date(finishedAt).toISOString(),
        }),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }).filter(Boolean);
    await Promise.all(updates);
    return true;
  }

  return false;
}

export async function runTournamentCycle(cronToken: string) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || typeof cronToken !== 'string' || cronToken !== cronSecret) {
    return { success: false, error: 'UNAUTHORIZED' };
  }
  const generated = await generateDailyTournamentsInternal();
  const db = getAdminDb();
  const now = Date.now();
  const snap = await db.collection('tournaments_v1').where('status', 'in', ['registration', 'groups', 'active']).get();
  let initialized = 0;
  let resolved = 0;
  let advanced = 0;

  for (const doc of snap.docs) {
    const tournament = { id: doc.id, ...doc.data() } as any;
    if (tournament.status === 'registration' && now >= Number(tournament.startAt)) {
      if (await initializeTournament(db, tournament.id, now)) initialized++;
      continue;
    }
    const matchesSnap = await doc.ref.collection('matches').where('status', 'in', ['scheduled', 'error']).get();
    for (const matchDoc of matchesSnap.docs) {
      const match = matchDoc.data() || {};
      // Повторяем сбойную симуляцию до 3 попыток. Ошибки не считаются сыгранными
      // и не позволяют турниру перейти к следующему этапу.
      if (Number(match.scheduledAt) <= now && Number(match.attemptCount || 0) < 3) {
        if (await resolveTournamentMatch(db, tournament.id, matchDoc.id, now)) resolved++;
      }
    }
    const fresh = (await doc.ref.get()).data();
    if (fresh && fresh.status !== 'completed') {
      if (await advanceTournament(db, { id: doc.id, ...fresh }, now)) advanced++;
    }
  }

  return { generated, initialized, resolved, advanced };
}

export async function getTournamentCatalogAction(idToken: string) {
  try {
    await requireServerActor(idToken);
    const db = getAdminDb();
    const date = getMoscowDateString();
    const snap = await db.collection('tournaments_v1').where('date', '==', date).get();
    return { success: true, tournaments: toSerializable(snap.docs.map(d => ({ id: d.id, ...d.data() }))) };
  } catch (e: any) {
    return { success: false, error: e?.message || 'TOURNAMENT_LIST_FAILED', tournaments: [] };
  }
}

export async function getTournamentDetailsAction(idToken: string, tournamentId: string) {
  try {
    await requireServerActor(idToken);
    const db = getAdminDb();
    const ref = db.collection('tournaments_v1').doc(tournamentId);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('TOURNAMENT_NOT_FOUND');
    const [participantsSnap, groupsSnap, matchesSnap] = await Promise.all([
      ref.collection('participants').get(),
      ref.collection('groups').get(),
      ref.collection('matches').get(),
    ]);
    return toSerializable({
      success: true,
      tournament: { id: snap.id, ...snap.data() },
      participants: participantsSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })),
      groups: groupsSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })),
      matches: matchesSnap.docs.map((d: any) => ({ id: d.id, ...d.data() })),
    });
  } catch (e: any) {
    return { success: false, error: e?.message || 'TOURNAMENT_DETAILS_FAILED' };
  }
}

export async function getTournamentHistoryAction(idToken: string) {
  try {
    await requireServerActor(idToken);
    const db = getAdminDb();
    const snap = await db.collection('tournaments_v1').where('status', '==', 'completed').get();
    return { success: true, tournaments: toSerializable(snap.docs.map((d: any) => ({ id: d.id, ...d.data() }))) };
  } catch (e: any) {
    return { success: false, error: e?.message || 'TOURNAMENT_HISTORY_FAILED', tournaments: [] };
  }
}
