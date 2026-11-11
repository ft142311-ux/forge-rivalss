#!/usr/bin/env node
/*
 * Forge-Rivals SEC-1..SEC-4 integrity audit.
 * Safe/read-only: never deletes or modifies Firestore data.
 * Default target: Firebase Emulator on 127.0.0.1:8080.
 */

const admin = require('firebase-admin');
const { validateBotPlayer } = require('./bot-audit-rules.cjs');

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'studio-2788872209-f7092';
const SEASON = Number(process.env.SEASON || 1);
const VERSION = 140;
const EXPECTED_GROUPS = 15;
const TEAMS_PER_GROUP = 8;
const MATCHES_PER_GROUP = 56;
const ROUNDS = 14;
const MATCHES_PER_ROUND = 4;

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
}

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

function ok(label, value) {
  console.log(`✓ ${label}: ${value}`);
}
function warn(label, value) {
  console.log(`⚠ ${label}: ${value}`);
}
function fail(label, value) {
  console.log(`✗ ${label}: ${value}`);
}

function groupKey(m) {
  return `${m.leagueId || '?'}:D${m.level ?? '?'}:G${m.groupId ?? '?'}`;
}

function parseStart(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'number') return value;
  return Date.parse(String(value || ''));
}

async function main() {
  let errors = 0;
  const [slotsSnap, tablesSnap, matchesSnap, playersSnap] = await Promise.all([
    db.collection('league_slots_v1').where('season', '==', SEASON).where('leagueId', '==', 'ALPHA').get(),
    db.collection('league_tables_v2').where('season', '==', SEASON).where('version', '==', VERSION).get(),
    db.collection('matches_v2').where('season', '==', SEASON).where('version', '==', VERSION).get(),
    db.collection('players_v14').get(),
  ]);

  console.log('\n=== Forge-Rivals Season Integrity Audit ===');
  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Season: ${SEASON}`);
  console.log(`Emulator: ${process.env.FIRESTORE_EMULATOR_HOST}`);
  console.log('');

  const matches = matchesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const tables = tablesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const players = new Map(playersSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));

  const groupMatches = new Map();
  const matchIds = new Set();
  const pairRoundKeys = new Set();
  const pairSeasonCounts = new Map();
  const groupTeams = new Map();
  const groupRounds = new Map();

  for (const m of matches) {
    if (matchIds.has(m.id)) { errors++; fail('duplicate match id', m.id); }
    matchIds.add(m.id);

    if (m.homeId && m.awayId && m.homeId === m.awayId) {
      errors++; fail('self-match', m.id);
    }

    if (m.isFinished === true) {
      if (typeof m.scoreA !== 'number' || typeof m.scoreB !== 'number') {
        errors++; fail('finished match without numeric score', m.id);
      }
      if (![0, 1, 2].includes(Number(m.scoreA)) || ![0, 1, 2].includes(Number(m.scoreB)) || Number(m.scoreA) === Number(m.scoreB) && Number(m.scoreA) !== 1) {
        errors++; fail('invalid BO2 series score', `${m.id}: ${m.scoreA}-${m.scoreB}`);
      }
    }

    const g = groupKey(m);
    if (!groupMatches.has(g)) groupMatches.set(g, []);
    groupMatches.get(g).push(m);

    const round = Number(m.tour ?? m.round ?? 0);
    const roundKey = `${g}:T${round}`;
    if (!groupRounds.has(roundKey)) groupRounds.set(roundKey, []);
    groupRounds.get(roundKey).push(m);

    for (const teamId of [m.homeId, m.awayId]) {
      if (!teamId) continue;
      if (!groupTeams.has(g)) groupTeams.set(g, new Set());
      groupTeams.get(g).add(teamId);
    }

    if (m.homeId && m.awayId) {
      const pair = [String(m.homeId), String(m.awayId)].sort().join('|');
      const pr = `${g}:T${round}:${pair}`;
      if (pairRoundKeys.has(pr)) {
        errors++; fail('duplicate team pair in same round', `${g} round ${round} ${pair}`);
      }
      pairRoundKeys.add(pr);
      pairSeasonCounts.set(`${g}:${pair}`, (pairSeasonCounts.get(`${g}:${pair}`) || 0) + 1);
    }
  }

  if (slotsSnap.size !== EXPECTED_GROUPS * TEAMS_PER_GROUP) {
    errors++; fail('season league slots', `${slotsSnap.size}/${EXPECTED_GROUPS * TEAMS_PER_GROUP}`);
  } else ok('season league slots', `${slotsSnap.size}/${EXPECTED_GROUPS * TEAMS_PER_GROUP}`);

  const slotsByGroup = new Map();
  for (const d of slotsSnap.docs) {
    const s = d.data() || {};
    const key = `D${s.division}:G${s.group}`;
    slotsByGroup.set(key, (slotsByGroup.get(key) || 0) + 1);
  }
  for (const [key, count] of slotsByGroup) {
    if (count !== TEAMS_PER_GROUP) { errors++; fail(`slot group ${key}`, `${count}/${TEAMS_PER_GROUP}`); }
  }

  if (tables.length !== EXPECTED_GROUPS) {
    errors++; fail('season tables', `${tables.length}/${EXPECTED_GROUPS}`);
  } else ok('season tables', `${tables.length}/${EXPECTED_GROUPS}`);

  if (groupMatches.size !== EXPECTED_GROUPS) {
    errors++; fail('groups represented in matches', `${groupMatches.size}/${EXPECTED_GROUPS}`);
  } else ok('groups represented in matches', `${groupMatches.size}/${EXPECTED_GROUPS}`);

  if (matches.length !== EXPECTED_GROUPS * MATCHES_PER_GROUP) {
    errors++; fail('season matches', `${matches.length}/${EXPECTED_GROUPS * MATCHES_PER_GROUP}`);
  } else ok('season matches', `${matches.length}/${EXPECTED_GROUPS * MATCHES_PER_GROUP}`);

  for (const [g, list] of groupMatches) {
    const teams = groupTeams.get(g) || new Set();
    if (teams.size !== TEAMS_PER_GROUP) {
      errors++; fail(`${g} teams`, `${teams.size}/${TEAMS_PER_GROUP}`);
    }
    if (list.length !== MATCHES_PER_GROUP) {
      errors++; fail(`${g} matches`, `${list.length}/${MATCHES_PER_GROUP}`);
    }

    for (let round = 1; round <= ROUNDS; round++) {
      const r = groupRounds.get(`${g}:T${round}`) || [];
      if (r.length !== MATCHES_PER_ROUND) {
        errors++; fail(`${g} round ${round}`, `${r.length}/${MATCHES_PER_ROUND}`);
        continue;
      }
      const seen = new Set();
      for (const m of r) {
        if (seen.has(m.homeId) || seen.has(m.awayId)) {
          errors++; fail(`${g} round ${round}`, 'team appears more than once');
        }
        if (m.homeId) seen.add(m.homeId);
        if (m.awayId) seen.add(m.awayId);
      }
      if (seen.size !== TEAMS_PER_GROUP) {
        errors++; fail(`${g} round ${round} unique teams`, `${seen.size}/${TEAMS_PER_GROUP}`);
      }
    }
  }

  for (const [key, count] of pairSeasonCounts) {
    if (count !== 2) { errors++; fail('season pair count', `${key} appears ${count} times, expected 2`); }
  }
  const expectedPairsPerGroup = (TEAMS_PER_GROUP * (TEAMS_PER_GROUP - 1)) / 2;
  const pairCountsPerGroup = new Map();
  for (const key of pairSeasonCounts.keys()) {
    const g = key.split(':').slice(0, 3).join(':');
    pairCountsPerGroup.set(g, (pairCountsPerGroup.get(g) || 0) + 1);
  }
  for (const [g, count] of pairCountsPerGroup) {
    if (count !== expectedPairsPerGroup) { errors++; fail(`${g} unique season pairs`, `${count}/${expectedPairsPerGroup}`); }
  }

  let botClubs = 0;
  let botRosterErrors = 0;
  for (const [id, p] of players) {
    if (!id.startsWith('BOT_') && p.isBot !== true) continue;
    botClubs++;
    const roster = Array.isArray(p.ownedPlayers) ? p.ownedPlayers : [];
    if (roster.length !== 5) {
      botRosterErrors++; errors++; fail(`bot roster ${id}`, `${roster.length}/5 players`);
      continue;
    }
    const roles = new Set();
    for (const player of roster) {
      roles.add(String(player.role || ''));
      const playerErrors = validateBotPlayer(player);
      for (const issue of playerErrors) {
        botRosterErrors++; errors++; fail(`bot player ${id}`, issue);
      }
    }
    if (roles.size !== 5) { botRosterErrors++; errors++; fail(`bot roles ${id}`, `${roles.size}/5 unique roles`); }
  }
  ok('bot clubs found', botClubs);
  if (botRosterErrors === 0) ok('bot rosters', 'all checked rosters contain 5 players with OVR 23-27');

  const staleLocks = matches.filter(m => {
    if (m.isFinished === true || m.isProcessing !== true) return false;
    const started = parseStart(m.processingStartedAt);
    return Number.isFinite(started) && Date.now() - started > 10 * 60 * 1000;
  });
  if (staleLocks.length) warn('stale match locks', staleLocks.length);
  else ok('stale match locks', 0);

  const finished = matches.filter(m => m.isFinished === true).length;
  const pending = matches.length - finished;
  ok('finished matches', finished);
  ok('unfinished matches', pending);

  console.log('');
  if (errors) {
    console.log(`STATUS: FAILED (${errors} issue(s))`);
    process.exitCode = 2;
  } else {
    console.log('STATUS: HEALTHY');
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('AUDIT ERROR:', err);
    process.exitCode = 1;
  });
}

module.exports = { main };
