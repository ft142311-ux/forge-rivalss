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
function isCompletedMatch(match: any) {
  const status = String(match?.status || '').toLowerCase();
  return match?.isFinished === true || status === 'finished' || status === 'completed';
}

async function repairRegisteredClubState(userId: string) {
  const db = getAdminDb();
  const configRef = db.collection('system_v1').doc('season_config');
  const playerRef = db.collection('players_v14').doc(userId);

  // The reset marker and every repair write share one transaction. If a reset
  // starts after this read, Firestore retries the transaction and the marker
  // blocks the repair before it can touch matches, standings, or player history.
  return db.runTransaction(async (t: any) => {
    const configSnap = await t.get(configRef);
    const config = configSnap.exists ? configSnap.data() || {} : {};
    if (!configSnap.exists || config.worldReady !== true ||
        config.stagingSeasonOneResetInProgress === true ||
        config.stagingFreshSeasonOneReset === true) {
      return { success: false, repaired: false, reason: 'WORLD_INITIALIZING' };
    }

    const playerSnap = await t.get(playerRef);
    if (!playerSnap.exists) return { success: false, repaired: false, reason: 'PLAYER_NOT_FOUND' };

    const profile = playerSnap.data() || {};
    const season = asNumber(profile.lastProcessedSeason || 1);
    const leagueId = String(profile.selectedLeagueId || 'ALPHA');
    const level = asNumber(profile.leagueLevel);
    const group = asNumber(profile.groupId);
    const rank = asNumber(profile.rank);
    if (!level || !group || !rank) return { success: false, repaired: false, reason: 'LEAGUE_CONTEXT_MISSING' };

    const matchesQuery = db.collection('matches_v2')
      .where('season', '==', season)
      .where('leagueId', '==', leagueId)
      .where('level', '==', level)
      .where('groupId', '==', group)
      .where('version', '==', 140)
      .limit(100);
    const matchesSnap = await t.get(matchesQuery);
    const tableRef = db.collection('league_tables_v2').doc(getTableId(season, leagueId, level, group));
    const tableSnap = await t.get(tableRef);

    let rebound = 0;
    for (const doc of matchesSnap.docs) {
      const m = doc.data() || {};
      // Completed fixtures are historical evidence and must remain immutable.
      if (isCompletedMatch(m)) continue;

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
        t.update(doc.ref, { ...patch, updatedAt: FieldValue.serverTimestamp() });
        rebound++;
      }
    }

    // Rebuild this group's standings from finished match documents.
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
      const id = r === rank ? userId : String(existing.id || ('BOT_' + leagueId + '_L' + level + '_G' + group + '_R' + r));
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
      .map((d: any) => ({ id: d.id, ...(d.data() || {}) }))
      .filter((m: any) => isCompletedMatch(m));

    for (const m of finished) {
      const homeRank = asNumber(m.homeRank);
      const awayRank = asNumber(m.awayRank);
      const homeScore = asNumber(m.scoreA);
      const awayScore = asNumber(m.scoreB);
      const home = Object.values(stats).find((x: any) => Number(x.rank) === homeRank) as any;
      const away = Object.values(stats).find((x: any) => Number(x.rank) === awayRank) as any;
      if (!home || !away) continue;
      home.matchesPlayed++; away.matchesPlayed++;
      home.diff += homeScore - awayScore; away.diff += awayScore - homeScore;
      if (homeScore > awayScore) { home.wins++; home.points += 3; away.losses++; }
      else if (homeScore < awayScore) { away.wins++; away.points += 3; home.losses++; }
      else { home.draws++; away.draws++; home.points++; away.points++; }
    }

    t.set(tableRef, { stats, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const userFinished = finished
      .filter((m: any) => asNumber(m.homeRank) === rank || asNumber(m.awayRank) === rank)
      .sort((a: any, b: any) => asNumber(new Date(a.finishedAt || a.startTime).getTime()) - asNumber(new Date(b.finishedAt || b.startTime).getTime()));
    if (userFinished.length) {
      const entries = userFinished.map((m: any) => makeHistory(m, userId, profile));
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

    return {
      success: true,
      repaired: rebound > 0 || finished.some((m: any) => asNumber(m.homeRank) === rank || asNumber(m.awayRank) === rank),
      rebound,
      finishedMatches: finished.length,
      userFinishedMatches: finished.filter((m: any) => asNumber(m.homeRank) === rank || asNumber(m.awayRank) === rank).length,
      season,
      leagueId,
      division: level,
      group,
      rank,
    };
  });
}
export async function repairRegisteredClubStateAction(idToken: string) {
  const actor = await requireServerActor(idToken);
  return repairRegisteredClubState(actor.uid);
}
