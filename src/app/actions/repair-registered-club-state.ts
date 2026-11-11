'use server';

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';
import { getTableId, TEAMS_PER_GROUP, getBotName } from '@/app/lib/leagues-data';

function asNumber(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function makeHistory(match: any, userId: string, profile: any) {
  const home = String(match.homeId) === userId || Number(match.homeRank) === Number(profile.rank);
  const scoreFor = home ? asNumber(match.scoreA) : asNumber(match.scoreB);
  const scoreAgainst = home ? asNumber(match.scoreB) : asNumber(match.scoreA);
  const opponentName = home ? String(match.awayName || `BOT${match.awayRank}`) : String(match.homeName || `BOT${match.homeRank}`);
  const opponentId = home ? (match.awayId || null) : (match.homeId || null);
  const result = scoreFor > scoreAgainst ? 'win' : scoreFor < scoreAgainst ? 'loss' : 'draw';
  return {
    id: match.id,
    matchId: match.id,
    season: asNumber(match.season),
    tour: asNumber(match.tour),
    day: asNumber(match.day || match.tour),
    type: match.type || 'league',
    opponentId,
    opponentName,
    scoreFor,
    scoreAgainst,
    score: `${scoreFor}:${scoreAgainst}`,
    result,
    winner: result === 'win' ? userId : result === 'loss' ? opponentId : null,
    reward: 0,
    playedAt: match.finishedAt || match.startTime,
    startTime: match.startTime,
    seen: false,
  };
}

/**
 * Repairs the registered club against the prebuilt league world.
 * The calendar is never regenerated here. The user's rank is simply bound
 * to the existing 56 matches, and the table/history are rebuilt from facts.
 */
export async function repairRegisteredClubState(userId: string) {
  const db = getAdminDb();
  const playerRef = db.collection('players_v14').doc(userId);
  const playerSnap = await playerRef.get();
  if (!playerSnap.exists) return { success: false, repaired: false, reason: 'PLAYER_NOT_FOUND' };

  const profile = playerSnap.data() || {};
  const season = asNumber(profile.lastProcessedSeason || 1);
  const leagueId = String(profile.selectedLeagueId || 'ALPHA');
  const level = asNumber(profile.leagueLevel);
  const group = asNumber(profile.groupId);
  const rank = asNumber(profile.rank);
  if (!level || !group || !rank) return { success: false, repaired: false, reason: 'LEAGUE_CONTEXT_MISSING' };

  const matchesSnap = await db.collection('matches_v2')
    .where('season', '==', season)
    .where('leagueId', '==', leagueId)
    .where('level', '==', level)
    .where('groupId', '==', group)
    .where('version', '==', 140)
    .limit(100)
    .get();

  let rebound = 0;
  const batch = db.batch();
  for (const doc of matchesSnap.docs) {
    const m = doc.data() || {};
    const patch: any = {};
    if (asNumber(m.homeRank) === rank && String(m.homeId || '') !== userId) {
      patch.homeId = userId;
      patch.homeName = profile.clubName || profile.displayName || userId;
    }
    if (asNumber(m.awayRank) === rank && String(m.awayId || '') !== userId) {
      patch.awayId = userId;
      patch.awayName = profile.clubName || profile.displayName || userId;
    }
    if (Object.keys(patch).length) {
      patch.updatedAt = FieldValue.serverTimestamp();
      batch.update(doc.ref, patch);
      rebound++;
    }
  }
  if (rebound) await batch.commit();

  // Rebuild this group's standings from finished match documents.
  const tableRef = db.collection('league_tables_v2').doc(getTableId(season, leagueId, level, group));
  const tableSnap = await tableRef.get();
  const oldStats = tableSnap.exists ? (tableSnap.data()?.stats || {}) : {};
  const byRank = new Map<number, any>();
  for (const value of Object.values(oldStats)) {
    const team: any = value;
    const r = asNumber(team?.rank);
    if (r >= 1 && r <= TEAMS_PER_GROUP && !byRank.has(r)) byRank.set(r, team);
  }

  const stats: Record<string, any> = {};
  for (let r = 1; r <= TEAMS_PER_GROUP; r++) {
    const existing = byRank.get(r) || {};
    const id = r === rank ? userId : String(existing.id || `BOT_${leagueId}_L${level}_G${group}_R${r}`);
    stats[id] = {
      id,
      name: r === rank ? String(profile.clubName || profile.displayName || id) : String(existing.name || getBotName(level, group, r)),
      rank: r,
      matchesPlayed: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      points: 0,
      diff: 0,
      isBot: r === rank ? false : existing.isBot !== false,
      ...(r === rank && profile.clubLogo ? { clubLogo: profile.clubLogo } : {}),
    };
  }

  const finished: any[] = matchesSnap.docs
    .map(d => ({ id: d.id, ...(d.data() || {}) } as any))
    .filter((m: any) => m.isFinished === true);

  for (const m of finished) {
    const hr = asNumber(m.homeRank), ar = asNumber(m.awayRank);
    const hs = asNumber(m.scoreA), as = asNumber(m.scoreB);
    const home = Object.values(stats).find((x: any) => Number(x.rank) === hr) as any;
    const away = Object.values(stats).find((x: any) => Number(x.rank) === ar) as any;
    if (!home || !away) continue;
    home.matchesPlayed++; away.matchesPlayed++;
    home.diff += hs - as; away.diff += as - hs;
    if (hs > as) { home.wins++; home.points += 3; away.losses++; }
    else if (hs < as) { away.wins++; away.points += 3; home.losses++; }
    else { home.draws++; away.draws++; home.points++; away.points++; }
  }

  await db.runTransaction(async (t: any) => {
    t.set(tableRef, { stats, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const userFinished = finished
      .filter(m => asNumber(m.homeRank) === rank || asNumber(m.awayRank) === rank)
      .sort((a, b) => asNumber(new Date(a.finishedAt || a.startTime).getTime()) - asNumber(new Date(b.finishedAt || b.startTime).getTime()));
    if (userFinished.length) {
      const entries = userFinished.map(m => makeHistory(m, userId, profile));
      const last = entries[entries.length - 1];
      t.set(playerRef, {
        matchHistory: FieldValue.arrayUnion(...entries),
        lastMatchResult: {
          matchId: last.matchId,
          result: last.result,
          score: last.score,
          opponentName: last.opponentName,
          playedAt: last.playedAt,
        },
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  });

  return {
    success: true,
    repaired: rebound > 0 || finished.some(m => asNumber(m.homeRank) === rank || asNumber(m.awayRank) === rank),
    rebound,
    finishedMatches: finished.length,
    userFinishedMatches: finished.filter(m => asNumber(m.homeRank) === rank || asNumber(m.awayRank) === rank).length,
    season,
    leagueId,
    division: level,
    group,
    rank,
  };
}

export async function repairRegisteredClubStateAction(idToken: string) {
  const actor = await requireServerActor(idToken);
  return repairRegisteredClubState(actor.uid);
}
