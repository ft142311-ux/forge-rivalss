#!/usr/bin/env node
'use strict';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'studio-2788872209-f7092';

const admin = require('firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const { buildSuccessfulRebuildConfig } = require('./rebuild-config-helper.cjs');

const LEAGUE_ID = 'ALPHA';
const SEASON = 1;
const VERSION = 140;
const CALENDAR_REVISION = 3;
const TEAMS_PER_GROUP = 8;
const TOTAL_GROUPS = 15;
const FIRST_SEASON_START = '2026-09-21T15:00:00.000Z';
const BATCH_LIMIT = 400;
const BOT_ROLES = ['Carry', 'Midlaner', 'Tank', 'Jungler', 'Support'];
const STAT_KEYS = [
  'lastHitting', 'mapAwareness', 'positioning', 'reflexes', 'manaManagement',
  'objectiveControl', 'communication', 'tiltResistance', 'versatility', 'ganking',
];

function coords(index) {
  let level = 1;
  let rest = index;
  while (rest > Math.pow(2, level - 1)) {
    rest -= Math.pow(2, level - 1);
    level++;
  }
  return { level, group: rest };
}
function botId(level, group, rank) { return `BOT_${LEAGUE_ID}_L${level}_G${group}_R${rank}`; }
function botName(level, group, rank) {
  return `Bot01${level}${String(group).padStart(3, '0')}${String(rank).padStart(2, '0')}`;
}
function tableId(level, group) { return `table_v140_S${SEASON}_L${LEAGUE_ID}_V${level}_G${group}`; }
function slotId(level, group, rank) { return `S${SEASON}_L${LEAGUE_ID}_D${level}_G${group}_R${rank}`; }
function matchId(level, group, tour, homeRank, awayRank) {
  return `match_v140_S${SEASON}_L${LEAGUE_ID}_V${level}_G${group}_T${tour}_R${homeRank}_vs_R${awayRank}`;
}
function addDays(date, days) { return new Date(date.getTime() + days * 86400000); }
function startTime(seasonStart, tour) {
  const d = addDays(seasonStart, tour - 1);
  d.setUTCHours(15, 0, 0, 0);
  return d.toISOString();
}
function botOvr(level, group, rank, playerIndex) {
  return 23 + ((level * 17 + group * 7 + rank * 3 + playerIndex * 5) % 5);
}
function statValue(ovr, level, group, rank, playerIndex, statIndex) {
  const roleBias = [1, 0, 1, -1, 0][playerIndex];
  const deterministic = ((level * 13 + group * 11 + rank * 7 + playerIndex * 5 + statIndex * 3) % 5) - 2;
  return Math.max(0, Math.min(100, ovr + roleBias + deterministic));
}
function createBotClub(level, group, rank) {
  const players = BOT_ROLES.map((role, i) => {
    const ovr = botOvr(level, group, rank, i);
    const proStats = {};
    STAT_KEYS.forEach((key, statIndex) => {
      proStats[key] = statValue(ovr, level, group, rank, i, statIndex);
    });
    return {
      id: `bot_${level}_${group}_${rank}_${i + 1}`,
      name: `${botName(level, group, rank)}_${role}`,
      role,
      overallRating: ovr,
      image: '',
      country: { code: 'INT', name: 'International', flag: '🌐' },
      age: 23 + ((level + group + rank + i) % 5),
      ageDisplay: `${23 + ((level + group + rank + i) % 5)}.0`,
      hiredAt: new Date(0).toISOString(),
      salary: 1800 + ovr * 50,
      form: 100,
      fatigue: 100,
      isInjured: false,
      isPro: false,
      isYouth: false,
      isBot: true,
      proStats,
      proTalents: Object.fromEntries(STAT_KEYS.map(key => [key, 40])),
    };
  });
  return {
    id: botId(level, group, rank),
    displayName: botName(level, group, rank),
    clubName: botName(level, group, rank),
    country: 'International',
    numericId: 0,
    credits: 0,
    crystals: 0,
    experiencePoints: 0,
    managerLevel: 1,
    selectedLeagueId: LEAGUE_ID,
    leagueLevel: level,
    groupId: group,
    rank,
    ownedPlayers: players,
    lineup: {
      carry: players[0].id,
      mid: players[1].id,
      offlane: players[2].id,
      support: players[3].id,
      full_support: players[4].id,
      sub_carry: null, sub_mid: null, sub_offlane: null, sub_support: null, sub_full_support: null,
      res1: null, res2: null, res3: null, res4: null, res5: null, res6: null, res7: null, res8: null,
    },
    staff: { coach: null, analyst: null, scout: null, doctor: null, financier: null },
    strategy: 'Balanced Play',
    arena: { capacity: 5000, pressCenterLevel: 1, cafeLevel: 1, shopLevel: 1 },
    hq: { hrLevel: 1, financeLevel: 1 },
    bootcamp: { bootcampLevel: 1 },
    academy: { scoutsLevel: 1 },
    medical: { massageLevel: 1 },
    isBot: true,
    botRosterVersion: 1,
    botOverallRange: [23, 27],
    version: 140,
  };
}

function makeStats(team) {
  return {
    id: team.id,
    name: team.name,
    rank: team.rank,
    matchesPlayed: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    points: 0,
    diff: 0,
    isBot: team.isBot,
  };
}
function calendar(teams, seasonStart, level, group) {
  const pool = teams.slice();
  const out = [];
  for (let round = 0; round < 7; round++) {
    for (let i = 0; i < 4; i++) {
      const a = pool[i];
      const b = pool[7 - i];
      const pairs = [
        [round + 1, a, b],
        [round + 8, b, a],
      ];
      for (const [tour, home, away] of pairs) {
        out.push({
          id: matchId(level, group, tour, home.rank, away.rank),
          leagueId: LEAGUE_ID, level, groupId: group, season: SEASON, version: VERSION,
          tour, day: tour,
          homeId: home.id, homeName: home.name, homeRank: home.rank,
          awayId: away.id, awayName: away.name, awayRank: away.rank,
          startTime: startTime(seasonStart, tour), type: 'league',
          isFinished: false, isProcessing: false, scoreA: 0, scoreB: 0,
          bestOf: 2, matchFormat: 'BO2', calendarRevision: CALENDAR_REVISION,
        });
      }
    }
    const last = pool.pop();
    pool.splice(1, 0, last);
  }
  return out;
}

async function chunkedWrites(items, mode) {
  for (let i = 0; i < items.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    const chunk = items.slice(i, i + BATCH_LIMIT);
    for (const item of chunk) {
      if (mode === 'delete') batch.delete(item);
      else batch.set(item.ref, item.data, item.options || {});
    }
    if (chunk.length) await batch.commit();
  }
}

async function readPreservedClubs() {
  const slotsSnap = await db.collection('league_slots_v1').where('season', '==', SEASON).get();
  const slotDocs = slotsSnap.docs.filter(d => d.data()?.leagueId === LEAGUE_ID);
  const tablesSnap = await db.collection('league_tables_v2').where('season', '==', SEASON).get();
  const tableDocs = tablesSnap.docs.filter(d => d.data()?.leagueId === LEAGUE_ID);

  const placements = new Map();
  const add = (id, level, group, rank, source) => {
    if (!id || String(id).startsWith('BOT_')) return;
    const key = String(id);
    const placement = { id: key, level: Number(level), group: Number(group), rank: Number(rank), source };
    const previous = placements.get(key);
    if (previous && (previous.level !== placement.level || previous.group !== placement.group || previous.rank !== placement.rank)) {
      throw new Error(`REAL_CLUB_DUPLICATE_PLACEMENT:${key}:${JSON.stringify(previous)}:${JSON.stringify(placement)}`);
    }
    const slotKey = `${placement.level}:${placement.group}:${placement.rank}`;
    for (const other of placements.values()) {
      if (other.id !== key && `${other.level}:${other.group}:${other.rank}` === slotKey) {
        throw new Error(`REAL_CLUB_SLOT_CONFLICT:${slotKey}:${other.id}:${key}`);
      }
    }
    placements.set(key, placement);
  };

  for (const doc of slotDocs) {
    const s = doc.data() || {};
    if (s.status === 'OCCUPIED' && s.occupantId) add(s.occupantId, s.division, s.group, s.rank, `slot:${doc.id}`);
  }
  for (const doc of tableDocs) {
    const table = doc.data() || {};
    const level = Number(table.level);
    const group = Number(table.group);
    for (const entry of Object.values(table.stats || {})) {
      if (entry && entry.isBot === false) add(entry.id, level, group, entry.rank, `table:${doc.id}`);
    }
  }

  if (placements.size > TOTAL_GROUPS * TEAMS_PER_GROUP) {
    throw new Error(`TOO_MANY_REAL_CLUBS:${placements.size}`);
  }

  const playerRefs = [...placements.values()].map(p => db.collection('players_v14').doc(p.id));
  const playerSnaps = await Promise.all(playerRefs.map(ref => ref.get()));
  const clubs = [];
  for (let i = 0; i < placements.size; i++) {
    const p = [...placements.values()][i];
    const snap = playerSnaps[i];
    if (!snap.exists) throw new Error(`REAL_CLUB_PROFILE_MISSING:${p.id}`);
    clubs.push({ placement: p, data: snap.data() || {} });
  }
  return clubs;
}

async function main() {
  const configRef = db.collection('system_v1').doc('season_config');
  const configSnap = await configRef.get();
  const config = configSnap.exists ? configSnap.data() || {} : {};
  const configuredSeason = Number(config.activeSeasonNumber || SEASON);
  if (configuredSeason !== SEASON) throw new Error(`ACTIVE_SEASON_IS_${configuredSeason}_EXPECTED_1`);
  const seasonStart = config.seasonStart ? new Date(config.seasonStart) : new Date(FIRST_SEASON_START);
  if (Number.isNaN(seasonStart.getTime())) throw new Error('SEASON_START_INVALID');

  console.log('[REBUILD] Reading and validating real clubs before destructive cleanup...');
  const preserved = await readPreservedClubs();
  console.log(`[REBUILD] Preserving ${preserved.length} real clubs.`);

  await configRef.set({ worldReady: false, rebuildStatus: 'STAGE_3A8_RUNNING', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

  try {
    // Delete the entire canonical Season 1 ALPHA league state. User profiles are
    // never deleted here; they are restored into their preserved placements.
    const [slots, tables, matches] = await Promise.all([
      db.collection('league_slots_v1').where('season', '==', SEASON).get(),
      db.collection('league_tables_v2').where('season', '==', SEASON).get(),
      db.collection('matches_v2').where('season', '==', SEASON).where('leagueId', '==', LEAGUE_ID).get(),
    ]);
    const deletions = [
      ...slots.docs.filter(d => d.data()?.leagueId === LEAGUE_ID).map(d => d.ref),
      ...tables.docs.filter(d => d.data()?.leagueId === LEAGUE_ID).map(d => d.ref),
      ...matches.docs.map(d => d.ref),
    ];
    // Delete canonical bot player documents only. Real user profiles are not touched.
    const botPlayers = await db.collection('players_v14').get();
    for (const doc of botPlayers.docs) {
      if (/^BOT_ALPHA_L[1-4]_G\d+_R\d+$/.test(doc.id) && doc.data()?.isBot === true) deletions.push(doc.ref);
    }
    await chunkedWrites(deletions, 'delete');

    const preservedBySlot = new Map(preserved.map(p => [`${p.placement.level}:${p.placement.group}:${p.placement.rank}`, p]));
    const allSlotWrites = [];
    const allTableWrites = [];
    const allMatchWrites = [];
    const botWrites = [];
    const realProfileWrites = [];

    for (let index = 1; index <= TOTAL_GROUPS; index++) {
      const { level, group } = coords(index);
      const teams = [];
      const stats = {};

      for (let rank = 1; rank <= TEAMS_PER_GROUP; rank++) {
        const preservedClub = preservedBySlot.get(`${level}:${group}:${rank}`);
        if (preservedClub) {
          const name = String(preservedClub.data.clubName || preservedClub.data.displayName || preservedClub.id);
          teams.push({ id: preservedClub.id, name, rank, isBot: false });
          stats[preservedClub.id] = makeStats({ id: preservedClub.id, name, rank, isBot: false });
          realProfileWrites.push({
            ref: db.collection('players_v14').doc(preservedClub.id),
            data: { selectedLeagueId: LEAGUE_ID, leagueLevel: level, groupId: group, rank, lastProcessedSeason: SEASON, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
            options: { merge: true },
          });
        } else {
          const id = botId(level, group, rank);
          const name = botName(level, group, rank);
          teams.push({ id, name, rank, isBot: true });
          stats[id] = makeStats({ id, name, rank, isBot: true });
          botWrites.push({
            ref: db.collection('players_v14').doc(id),
            data: { ...createBotClub(level, group, rank), createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp() },
          });
        }
        allSlotWrites.push({
          ref: db.collection('league_slots_v1').doc(slotId(level, group, rank)),
          data: {
            season: SEASON, leagueId: LEAGUE_ID, division: level, group, rank,
            status: preservedClub ? 'OCCUPIED' : 'FREE',
            occupantId: preservedClub ? preservedClub.id : null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
        });
      }

      allTableWrites.push({
        ref: db.collection('league_tables_v2').doc(tableId(level, group)),
        data: {
          id: tableId(level, group), leagueId: LEAGUE_ID, level, group, season: SEASON,
          stats, version: VERSION, scheduleRevision: CALENDAR_REVISION,
          standingsEngine: 'stage3a8-canonical-slots',
          createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      });
      for (const match of calendar(teams, seasonStart, level, group)) {
        allMatchWrites.push({ ref: db.collection('matches_v2').doc(match.id), data: match });
      }
    }

    await chunkedWrites(botWrites, 'set');
    await chunkedWrites(realProfileWrites, 'set');
    await chunkedWrites(allSlotWrites, 'set');
    await chunkedWrites(allTableWrites, 'set');
    await chunkedWrites(allMatchWrites, 'set');

    console.log('[REBUILD] Running post-build validation...');
    const [finalSlotsSnap, finalTablesSnap, finalMatchesSnap] = await Promise.all([
      db.collection('league_slots_v1').where('season', '==', SEASON).get(),
      db.collection('league_tables_v2').where('season', '==', SEASON).get(),
      db.collection('matches_v2').where('season', '==', SEASON).where('leagueId', '==', LEAGUE_ID).where('version', '==', VERSION).get(),
    ]);
    const finalSlots = finalSlotsSnap.docs.filter(d => d.data()?.leagueId === LEAGUE_ID);
    const finalTables = finalTablesSnap.docs.filter(d => d.data()?.leagueId === LEAGUE_ID);
    if (finalSlots.length !== 120) throw new Error(`VALIDATION_SLOT_COUNT:${finalSlots.length}`);
    if (finalTables.length !== 15) throw new Error(`VALIDATION_TABLE_COUNT:${finalTables.length}`);
    if (finalMatchesSnap.size !== 840) throw new Error(`VALIDATION_MATCH_COUNT:${finalMatchesSnap.size}`);

    const slotKeys = new Set();
    const clubs = new Set();
    for (const doc of finalSlots) {
      const s = doc.data() || {};
      const key = `${s.division}:${s.group}:${s.rank}`;
      if (slotKeys.has(key)) throw new Error(`VALIDATION_DUPLICATE_SLOT:${key}`);
      slotKeys.add(key);
      if (s.status === 'OCCUPIED') {
        if (!s.occupantId || clubs.has(s.occupantId)) throw new Error(`VALIDATION_DUPLICATE_CLUB:${s.occupantId}`);
        clubs.add(s.occupantId);
      }
    }

    const expectedByGroup = new Map();
    for (const doc of finalTables) {
      const t = doc.data() || {};
      const entries = Object.values(t.stats || {});
      if (entries.length !== 8) throw new Error(`VALIDATION_TABLE_TEAM_COUNT:${doc.id}:${entries.length}`);
      const ranks = new Set(entries.map(e => Number(e.rank)));
      if (ranks.size !== 8 || [...ranks].some(r => r < 1 || r > 8)) throw new Error(`VALIDATION_TABLE_RANKS:${doc.id}`);
      for (const e of entries) {
        if (e.isBot === true) {
          if (!String(e.id).startsWith('BOT_ALPHA_')) throw new Error(`VALIDATION_BOT_ID:${e.id}`);
        }
      }
    }

    const matchesByGroup = new Map();
    for (const doc of finalMatchesSnap.docs) {
      const m = doc.data() || {};
      const key = `${m.level}:${m.groupId}`;
      if (!matchesByGroup.has(key)) matchesByGroup.set(key, []);
      matchesByGroup.get(key).push(m);
      if (m.homeId === m.awayId) throw new Error(`VALIDATION_SELF_MATCH:${doc.id}`);
      if (m.isFinished !== false) throw new Error(`VALIDATION_MATCH_FINISHED:${doc.id}`);
    }
    if (matchesByGroup.size !== 15) throw new Error(`VALIDATION_GROUP_MATCH_KEYS:${matchesByGroup.size}`);
    for (const [key, groupMatches] of matchesByGroup.entries()) {
      if (groupMatches.length !== 56) throw new Error(`VALIDATION_GROUP_MATCH_COUNT:${key}:${groupMatches.length}`);
      const byTour = new Map();
      for (const m of groupMatches) {
        if (!byTour.has(m.tour)) byTour.set(m.tour, []);
        byTour.get(m.tour).push(m);
      }
      if (byTour.size !== 14) throw new Error(`VALIDATION_TOURS:${key}:${byTour.size}`);
      for (const [tour, games] of byTour.entries()) {
        if (games.length !== 4) throw new Error(`VALIDATION_TOUR_MATCH_COUNT:${key}:T${tour}:${games.length}`);
        const seen = new Set();
        for (const m of games) {
          if (seen.has(m.homeId) || seen.has(m.awayId)) throw new Error(`VALIDATION_TEAM_TWICE_IN_TOUR:${key}:T${tour}`);
          seen.add(m.homeId); seen.add(m.awayId);
        }
        if (seen.size !== 8) throw new Error(`VALIDATION_TOUR_TEAM_COUNT:${key}:T${tour}:${seen.size}`);
      }
    }

    // Validate all bot rosters in players_v14.
    const botSnap = await db.collection('players_v14').get();
    const bots = botSnap.docs.filter(d => /^BOT_ALPHA_L[1-4]_G\d+_R\d+$/.test(d.id) && d.data()?.isBot === true);
    const expectedBots = 120 - preserved.length;
    if (bots.length !== expectedBots) throw new Error(`VALIDATION_BOT_CLUB_COUNT:${bots.length}:expected${expectedBots}`);
    for (const doc of bots) {
      const players = Array.isArray(doc.data()?.ownedPlayers) ? doc.data().ownedPlayers : [];
      if (players.length !== 5) throw new Error(`VALIDATION_BOT_ROSTER_SIZE:${doc.id}:${players.length}`);
      for (const p of players) {
        const ovr = Number(p.overallRating);
        if (!Number.isFinite(ovr) || ovr < 23 || ovr > 27) throw new Error(`VALIDATION_BOT_OVR:${doc.id}:${p.id}:${p.overallRating}`);
        if (!p.proStats || typeof p.proStats !== 'object') throw new Error(`VALIDATION_BOT_PROSTATS:${doc.id}:${p.id}`);
        if (!p.role || !BOT_ROLES.includes(p.role)) throw new Error(`VALIDATION_BOT_ROLE:${doc.id}:${p.id}`);
      }
    }

    await configRef.set(buildSuccessfulRebuildConfig(admin, seasonStart), { merge: true });

    console.log('');
    console.log('====================================');
    console.log('STAGE 3A.8 REBUILD SUCCESS');
    console.log('====================================');
    console.log(`Season: ${SEASON}`);
    console.log(`Groups: 15`);
    console.log(`Teams: 120`);
    console.log(`Real clubs preserved: ${preserved.length}`);
    console.log(`Bot clubs: ${expectedBots}`);
    console.log(`Bot players: ${expectedBots * 5}`);
    console.log(`Tables: 15`);
    console.log(`Matches: 840`);
    console.log('Validation:');
    console.log('✓ 8 teams per group');
    console.log('✓ unique slots');
    console.log('✓ unique clubs');
    console.log('✓ valid bot rosters');
    console.log('✓ bot OVR 23-27');
    console.log('✓ 840 valid BO2 matches');
    console.log('✓ no duplicate matches');
    console.log('✓ no team appears twice in one tour');
    console.log('✓ worldReady=true only after validation');
    console.log('STATUS: READY');
  } catch (error) {
    await configRef.set({ worldReady: false, rebuildStatus: 'STAGE_3A8_FAILED', rebuildError: String(error?.message || error), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    throw error;
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('[REBUILD FAILED]', error?.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { buildSuccessfulRebuildConfig };
