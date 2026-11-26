/*
 * Read-only Season 1 D1-G1 recovery inspection for the Firebase Emulator.
 * Does not write to Firestore. Saves a local JSON snapshot for review.
 */
const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'demo-forge-rivals';
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIRESTORE_EMULATOR_HOST = emulatorHost;

if (!admin.apps.length) admin.initializeApp({ projectId });
const db = admin.firestore();
const SEASON = 1;
const LEAGUE = 'ALPHA';
const LEVEL = 1;
const GROUP = 1;
const USER_ID = 'LZJW7Nz5Gf75u6dtvIJle6arp2Ba';
const TABLE_ID = 'table_v140_S1_LALPHA_V1_G1';

function normalize(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = normalize(v);
  return out;
}

function fixtureScore(m) {
  return {
    scoreA: m.scoreA ?? null,
    scoreB: m.scoreB ?? null,
    score: m.score ?? null,
    seriesScore: m.seriesScore ?? null,
    isFinished: m.isFinished === true,
    status: m.status ?? null,
    isProcessing: m.isProcessing === true,
    tour: m.tour ?? m.day ?? null,
    homeId: m.homeId ?? null,
    homeRank: m.homeRank ?? null,
    awayId: m.awayId ?? null,
    awayRank: m.awayRank ?? null,
  };
}

async function main() {
  const [configSnap, tableSnap, slotsSnap, matchesSnap, playerSnap] = await Promise.all([
    db.collection('system_v1').doc('season_config').get(),
    db.collection('league_tables_v2').doc(TABLE_ID).get(),
    db.collection('league_slots_v1')
      .where('season', '==', SEASON).where('leagueId', '==', LEAGUE)
      .where('division', '==', LEVEL).where('group', '==', GROUP).get(),
    db.collection('matches_v2')
      .where('season', '==', SEASON).where('leagueId', '==', LEAGUE)
      .where('level', '==', LEVEL).where('groupId', '==', GROUP).get(),
    db.collection('players_v14').doc(USER_ID).get(),
  ]);

  const matches = matchesSnap.docs.map(d => ({ id: d.id, ...normalize(d.data() || {}) }));
  const slots = slotsSnap.docs.map(d => ({ documentId: d.id, ...normalize(d.data() || {}) }))
    .sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0));
  const tableData = tableSnap.exists ? normalize(tableSnap.data() || {}) : null;
  const stats = tableData && tableData.stats && typeof tableData.stats === 'object' ? tableData.stats : {};

  const participantsByRank = {};
  const rankConflicts = [];
  for (const m of matches) {
    for (const [idKey, rankKey] of [['homeId', 'homeRank'], ['awayId', 'awayRank']]) {
      const id = String(m[idKey] || '');
      const rank = Number(m[rankKey]);
      if (!id || !Number.isInteger(rank)) continue;
      if (!participantsByRank[rank]) participantsByRank[rank] = new Set();
      participantsByRank[rank].add(id);
    }
  }
  const participantsSummary = {};
  for (const [rank, ids] of Object.entries(participantsByRank)) {
    participantsSummary[rank] = [...ids].sort();
    if (ids.size !== 1) rankConflicts.push({ rank: Number(rank), participantIds: [...ids].sort() });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    projectId,
    emulatorHost,
    scope: { season: SEASON, leagueId: LEAGUE, level: LEVEL, group: GROUP, tableDocumentId: TABLE_ID },
    config: configSnap.exists ? normalize(configSnap.data() || {}) : null,
    table: tableData,
    slots,
    userPlayer: playerSnap.exists ? normalize(playerSnap.data() || {}) : null,
    matches,
    summary: {
      tableExists: tableSnap.exists,
      slotsCount: slots.length,
      matchesCount: matches.length,
      finishedMatches: matches.filter(m => m.isFinished === true || String(m.status || '').toLowerCase() === 'finished').length,
      unfinishedMatches: matches.filter(m => !(m.isFinished === true || String(m.status || '').toLowerCase() === 'finished')).length,
      matchesWithScores: matches.filter(m => m.scoreA !== undefined || m.scoreB !== undefined || m.score || m.seriesScore).length,
      participantsByRank: participantsSummary,
      fixtureRankConflicts: rankConflicts,
      standingsRows: Object.entries(stats).map(([id, row]) => ({ id, rank: row && row.rank, isBot: row && row.isBot, matchesPlayed: row && row.matchesPlayed, wins: row && row.wins, draws: row && row.draws, losses: row && row.losses, points: row && row.points, diff: row && row.diff })),
    },
    warning: 'Snapshot only. No Firestore documents were changed. Do not apply a repair until the source of truth for ranks 4 and 5 is confirmed.',
  };

  const outDir = path.resolve(process.cwd(), 'recovery-snapshots');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `season1-D1-G1-preflight-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({ success: true, readOnly: true, snapshotFile: outPath, summary: report.summary, configPhase: report.config && report.config.phase, activeSeasonNumber: report.config && report.config.activeSeasonNumber, userPlacement: report.userPlayer ? { leagueLevel: report.userPlayer.leagueLevel ?? null, groupId: report.userPlayer.groupId ?? null, lastProcessedSeason: report.userPlayer.lastProcessedSeason ?? null, clubName: report.userPlayer.clubName ?? null } : null }, null, 2));
  await admin.app().delete();
}

main().catch(async err => {
  console.error(JSON.stringify({ success: false, readOnly: true, error: String(err && err.stack || err) }, null, 2));
  try { await admin.app().delete(); } catch (_) {}
  process.exitCode = 1;
});
