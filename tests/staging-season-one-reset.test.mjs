import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildFreshSeasonOneResetPlan } from '../src/app/actions/staging-season-one-reset-plan.ts';
import { resetFreshSeasonOnePlayerState, resetFreshSeasonOneClubProfileState, createFreshSeasonOneHumanClubProfile } from '../src/app/actions/fresh-season-one-player-reset.ts';
import { buildFreshSeasonOneWorldDocuments } from '../src/app/actions/fresh-season-one-world-builder.ts';

const root = resolve(import.meta.dirname, '..');
const read = path => readFileSync(resolve(root, path), 'utf8');

function createValidInput() {
  const tables = [];
  const slots = [];
  const matches = [];
  const profileIds = new Set();

  for (let level = 1; level <= 4; level++) {
    for (let group = 1; group <= 2 ** (level - 1); group++) {
      const teams = [];
      const stats = {};
      for (let rank = 1; rank <= 8; rank++) {
        const id = `BOT_ALPHA_L${level}_G${group}_R${rank}`;
        const team = { id, name: id, rank, isBot: true };
        teams.push(team);
        stats[id] = team;
        profileIds.add(id);
        slots.push({
          id: `S1_LALPHA_D${level}_G${group}_R${rank}`,
          data: {
            season: 1, leagueId: 'ALPHA', division: level, group, rank,
            status: 'FREE', occupantId: null,
          },
        });
      }
      tables.push({
        id: `table_v140_S1_LALPHA_V${level}_G${group}`,
        data: { season: 1, leagueId: 'ALPHA', level, group, version: 140, stats },
      });

      const pool = Array.from({ length: 8 }, (_, index) => index);
      for (let round = 0; round < 7; round++) {
        for (let index = 0; index < 4; index++) {
          const first = teams[pool[index]];
          const second = teams[pool[7 - index]];
          const fixtures = [
            { tour: round + 1, home: first, away: second },
            { tour: round + 8, home: second, away: first },
          ];
          for (const fixture of fixtures) {
            const id = `match_v140_S1_LALPHA_V${level}_G${group}_T${fixture.tour}_R${fixture.home.rank}_vs_R${fixture.away.rank}`;
            matches.push({
              id,
              data: {
                id, season: 1, leagueId: 'ALPHA', level, groupId: group, version: 140,
                tour: fixture.tour, homeId: fixture.home.id, awayId: fixture.away.id,
                homeRank: fixture.home.rank, awayRank: fixture.away.rank,
              },
            });
          }
        }
        const last = pool.pop();
        pool.splice(1, 0, last);
      }
    }
  }

  const participants = tables.flatMap(table => {
    const { level, group, stats } = table.data;
    return Object.values(stats).map((team, index) => ({
      ...team, level, group, seed: 0,
    }));
  }).sort((a, b) => a.level - b.level || a.rank - b.rank || a.group - b.group || a.id.localeCompare(b.id))
    .map((team, index) => ({ ...team, seed: index + 1 }));
  const openingEligible = participants.filter(team => team.level !== 1);
  const openingRound = [];
  for (let index = 0; index < 56; index++) {
    const stronger = openingEligible[openingEligible.length - 2 - index * 2];
    const weaker = openingEligible[openingEligible.length - 1 - index * 2];
    const id = `cup_S1_R1_M${String(index + 1).padStart(2, '0')}`;
    openingRound.push({
      id: `r1_m${index + 1}`, index: index + 1, matchId: id, status: 'scheduled',
      home: { ...weaker }, away: { ...stronger },
    });
  }
  const cup = {
    id: 'cup_s1_lALPHA', season: 1, leagueId: 'ALPHA', name: 'Кубок Пирамиды',
    status: 'active', currentRound: 1, seasonStart: '2026-11-09T15:00:00.000Z', formatVersion: 4, format: 'D1_REST_OPENING_ROUND',
    totalRounds: 7, totalParticipants: 120, totalMatches: 119, preliminaryMatches: 56,
    openingRoundRestCount: 8, openingRoundRestTeams: participants.filter(team => team.level === 1),
    byeCount: 0, participants, rounds: { r1: openingRound, r2: [], r3: [], r4: [], r5: [], r6: [], r7: [] },
  };
  const cupFixtures = openingRound.map(pairing => ({
    id: pairing.matchId,
    data: {
      id: pairing.matchId, cupId: 'cup_s1_lALPHA', season: 1, cupRound: 1, bestOf: 1,
      scheduledAt: new Date('2026-11-10T04:00:00.000Z'),
      homeId: pairing.home.id, awayId: pairing.away.id,
      homeTeamSnapshot: { id: pairing.home.id, players: Array.from({ length: 5 }, (_, i) => ({ id: `h-${i}` })) },
      awayTeamSnapshot: { id: pairing.away.id, players: Array.from({ length: 5 }, (_, i) => ({ id: `a-${i}` })) },
    },
  }));
  const cupSnapshots = participants.map(team => ({
    id: team.id,
    data: {
      cupId: 'cup_s1_lALPHA', season: 1, teamId: team.id,
      matchSnapshot: { id: team.id, players: Array.from({ length: 5 }, (_, i) => ({ id: `p-${i}` })) },
    },
  }));

  return {
    config: { activeSeasonNumber: 1, worldReady: true, phase: 'REGULAR_SEASON', seasonStart: '2026-11-09T15:00:00.000Z' },
    tables, slots, matches, profileIds, legacyCupMatches: 0,
    cup, cupFixtures, cupSnapshots,
    archives: 0, rollovers: 0, history: 0,
    archiveMatches: 0, matchPlayerEffects: 0, matchRevenueReceipts: 0, cupMatchRevenueReceipts: 0,
    matchConsequenceReceipts: 0, leagueSeasonRewardReceipts: 0, pyramidCupRewardReceipts: 0,
    liveLocks: [], unclassifiedMatches: 0,
    now: new Date('2026-11-22T14:00:00.000Z'),
  };
}

test('fresh Beta Season 1 preflight is authenticated, project-fenced and read-only', () => {
  const source = read('src/app/api/admin/staging-season-one-reset/route.ts');
  assert.match(source, /isCronAuthorized\(request\)/);
  assert.match(source, /EXPECTED_PROJECT = 'forge-rivalstest'/);
  assert.match(source, /function isExpectedProject/);
  assert.match(source, /getApps\(\)\[0\].*options.*projectId/);
  assert.match(source, /export async function GET/);
  assert.match(source, /export async function POST/);
  assert.match(source, /RESET_BETA_SEASON_ONE/);
  assert.match(source, /executeFreshSeasonOneReset/);
  assert.match(source, /readOnly: true/);
  assert.match(source, /league_tables_v2/);
  assert.match(source, /league_slots_v1/);
  assert.match(source, /matches_v2/);
  assert.match(source, /players_v14/);
  assert.match(source, /ownedPlayers/);
  assert.match(source, /unclassifiedMatches/);
  assert.match(source, /match_player_effects_v1/);
  assert.match(source, /economy_transactions/);
  assert.match(source, /match_consequence_receipts/);
  assert.match(source, /LEAGUE_SEASON_REWARD/);
  assert.match(source, /PYRAMID_CUP_CHAMPION_REWARD/);
  assert.match(source, /cup_participant_snapshots_v1/);
  assert.match(source, /cupFixtures: cupMatchesSnap\.docs\.map/);
  assert.match(source, /season_rollover_v1/);
  assert.match(source, /season_calendar_build_v1/);
  // S1 -> S2 rollover documents are keyed by the target season (S2).
  assert.match(source, /league_season_rollovers_v1'\)\.doc\('S2'\)/);
  assert.doesNotMatch(source, /league_season_rollovers_v1'\)\.doc\('S1'\)/);
  assert.match(source, /collection\('matches'\)/);
  assert.doesNotMatch(source, /\.set\(|\.create\(|\.update\(|\.delete\(|runTransaction\(/);
  assert.doesNotMatch(source, /participantIds\s*:\s*\[|profileIds\s*:\s*\[/);
});

test('fresh Season 1 reset preflight blocks extra orphaned club profiles', () => {
  const input = createValidInput();
  input.unexpectedProfileCount = 1;
  const plan = buildFreshSeasonOneResetPlan(input);
  assert.equal(plan.ready, false);
  assert.ok(plan.reasons.includes('UNEXPECTED_CLUB_PROFILES_PRESENT'));
});

test('fresh Season 1 reset plan validates 120 participants and complete 840-match round robin', () => {
  const plan = buildFreshSeasonOneResetPlan(createValidInput());
  assert.equal(plan.ready, true, plan.reasons.join(','));
  assert.equal(plan.preserve.firebaseAuthAccounts, true);
  assert.equal(plan.preserve.firebaseAuthUids, 0);
  assert.equal(plan.replace.clubProfiles, 120);
  assert.equal(plan.replace.botClubProfiles, 120);
  assert.equal(plan.expected.freeRegistrationSlots, 120);
  assert.equal(plan.replace.leagueSlots, 120);
  assert.equal(plan.replace.slotHistoryEvents, 0);
  assert.equal(plan.expected.leagueMatches, 840);
  assert.equal(plan.replace.cupExists, true);
  assert.equal(plan.replace.cupMatches, 56);
  assert.equal(plan.replace.cupParticipantSnapshots, 120);
  assert.equal(plan.replace.matchPlayerEffectLedgers, 0);
  assert.equal(plan.replace.matchRevenueReceipts, 0);
  assert.equal(plan.replace.cupMatchRevenueReceipts, 0);
  assert.equal(plan.replace.matchConsequenceReceipts, 0);
  assert.equal(plan.replace.leagueSeasonRewardReceipts, 0);
  assert.equal(plan.replace.pyramidCupRewardReceipts, 0);
  assert.equal(plan.replace.archivedLeagueMatches, 0);
  assert.equal(plan.target.seasonStart, '2026-11-22T15:00:00.000Z');
  assert.equal(plan.target.nextSeasonStart, '2026-12-09T15:00:00.000Z');
});

test('fresh Season 1 reset preflight does not require the old Cup, Cup snapshots or existing league fixtures', () => {
  const input = createValidInput();
  input.cup = null;
  input.cupFixtures = [];
  input.cupSnapshots = [];
  input.matches = [];
  const plan = buildFreshSeasonOneResetPlan(input);
  assert.equal(plan.ready, true, plan.reasons.join(','));
  assert.equal(plan.preserve.firebaseAuthAccounts, true);
  assert.equal(plan.replace.clubProfiles, 120);
  assert.equal(plan.replace.leagueSlots, 120);
  assert.equal(plan.replace.cupExists, false);
  assert.equal(plan.replace.cupMatches, 0);
  assert.equal(plan.replace.cupParticipantSnapshots, 0);
  assert.equal(plan.replace.leagueMatches, 0);
});

test('fresh Season 1 reset preserves human Firebase UIDs but replaces their club profiles', () => {
  const input = createValidInput();
  const table = input.tables[1];
  const slot = input.slots.find(item => item.id === 'S1_LALPHA_D2_G1_R1');
  const botId = 'BOT_ALPHA_L2_G1_R1';
  const userId = 'existing-auth-uid';
  const row = { ...table.data.stats[botId], id: userId, name: 'Old Club', isBot: false };
  delete table.data.stats[botId];
  table.data.stats[userId] = row;
  slot.data.status = 'OCCUPIED';
  slot.data.occupantId = userId;
  input.profileIds.delete(botId);
  input.profileIds.add(userId);

  const plan = buildFreshSeasonOneResetPlan(input);
  assert.equal(plan.ready, true, plan.reasons.join(','));
  assert.equal(plan.preserve.firebaseAuthAccounts, true);
  assert.equal(plan.preserve.firebaseAuthUids, 1);
  assert.equal(plan.replace.humanClubProfiles, 1);
  assert.equal(plan.replace.botClubProfiles, 119);
  assert.equal(plan.replace.clubProfiles, 120);
  assert.equal(plan.expected.freeRegistrationSlots, 119);
});

test('fresh Season 1 world builder replaces all club rosters while preserving human UIDs and ranks', () => {
  const input = createValidInput();
  input.tables[0].data.championId = 'stale-season-champion';
  input.tables[0].data.previousSeasonSummary = { points: 999 };
  const table = input.tables.find(item => item.id === 'table_v140_S1_LALPHA_V2_G1');
  const slot = input.slots.find(item => item.id === 'S1_LALPHA_D2_G1_R3');
  const botId = 'BOT_ALPHA_L2_G1_R3';
  const uid = 'existing-human-uid';
  const oldProfile = {
    id: uid, email: 'manager@example.invalid', displayName: 'Manager',
    clubName: 'Old Club', numericId: 1201, credits: 42, crystals: 9,
    ownedPlayers: [{ id: 'old-player-1', role: 'Carry' }],
  };
  delete table.data.stats[botId];
  table.data.stats[uid] = {
    id: uid, name: 'Old Club', rank: 3, isBot: false,
    matchesPlayed: 14, wins: 10, draws: 1, losses: 3, points: 31, diff: 22,
  };
  slot.data.status = 'OCCUPIED';
  slot.data.occupantId = uid;

  const result = buildFreshSeasonOneWorldDocuments({
    tables: input.tables, slots: input.slots,
    profiles: new Map([[uid, oldProfile]]),
    now: new Date('2026-11-22T15:00:00.000Z'),
  });

  assert.deepEqual(result.counts, {
    tables: 15, slots: 120, profiles: 120, humanClubs: 1, botClubs: 119,
    freeRegistrationSlots: 119,
  });
  const human = result.profiles.find(profile => profile.id === uid);
  assert.ok(human);
  assert.equal(human.data.id, uid);
  assert.equal(human.data.credits, 1_000_000);
  assert.equal(human.data.crystals, 50);
  assert.equal(human.data.ownedPlayers.length, 10);
  assert.ok(human.data.ownedPlayers.every(player => player.id !== 'old-player-1'));
  const freshTable = result.tables.find(item => item.id === table.id);
  assert.equal(freshTable.data.stats[uid].matchesPlayed, 0);
  assert.equal(freshTable.data.stats[uid].wins, 0);
  assert.equal(freshTable.data.stats[uid].points, 0);
  assert.equal(freshTable.data.stats[uid].isBot, false);
  assert.equal(freshTable.data.stats[uid].name, human.data.clubName);
  const freshSlot = result.slots.find(item => item.id === slot.id);
  assert.equal(freshSlot.data.status, 'OCCUPIED');
  assert.equal(freshSlot.data.occupantId, uid);
  assert.equal(freshSlot.data.occupancyGeneration, 0);
  const cleanTable = result.tables.find(item => item.id === input.tables[0].id);
  assert.equal(Object.hasOwn(cleanTable.data, 'championId'), false);
  assert.equal(Object.hasOwn(cleanTable.data, 'previousSeasonSummary'), false);

  const repeated = buildFreshSeasonOneWorldDocuments({
    tables: input.tables, slots: input.slots,
    profiles: new Map([[uid, oldProfile]]),
    now: new Date('2026-11-22T15:00:00.000Z'),
  });
  assert.deepEqual(
    repeated.profiles.find(profile => profile.id === uid).data.ownedPlayers.map(player => player.id),
    human.data.ownedPlayers.map(player => player.id),
    'retry with the same reset timestamp must reproduce identical player IDs',
  );
});

test('fresh Season 1 reset allows orphaned old Cup fixtures and snapshots when the Cup root is absent', () => {
  const input = createValidInput();
  input.cup = null;
  const plan = buildFreshSeasonOneResetPlan(input);
  assert.equal(plan.ready, true, plan.reasons.join(','));
  assert.equal(plan.replace.cupExists, false);
  assert.equal(plan.replace.cupMatches, 56);
  assert.equal(plan.replace.cupParticipantSnapshots, 120);
});

test('fresh Season 1 reset classifies old archives and rollover records as replaceable test data', () => {
  const input = createValidInput();
  input.archives = 1;
  input.rollovers = 1;
  input.history = 1;
  input.archiveMatches = 56;
  const plan = buildFreshSeasonOneResetPlan(input);
  assert.equal(plan.ready, true, plan.reasons.join(','));
  assert.equal(plan.replace.seasonArchives, 1);
  assert.equal(plan.replace.rolloverPlans, 1);
  assert.equal(plan.replace.seasonHistoryEntries, 1);
  assert.equal(plan.replace.archivedLeagueMatches, 56);
});

test('fresh Season 1 reset treats malformed old Cup and league fixtures as replaceable', () => {
  const input = createValidInput();
  input.cup.seasonStart = '2026-11-10T15:00:00.000Z';
  input.cupFixtures[0].data.scheduledAt = new Date('2026-11-10T05:00:00.000Z');
  input.matches[0].data.homeId = input.matches[0].data.awayId;
  input.legacyCupMatches = 3;
  const plan = buildFreshSeasonOneResetPlan(input);
  assert.equal(plan.ready, true, plan.reasons.join(','));
  assert.equal(plan.replace.cupExists, true);
  assert.equal(plan.replace.cupMatches, 56);
  assert.equal(plan.replace.cupParticipantSnapshots, 120);
  assert.equal(plan.replace.legacyCupMatches, 3);
});

test('fresh Season 1 preflight still rejects slot identity corruption', () => {
  const input = createValidInput();
  input.slots[0].data.status = 'OCCUPIED';
  input.slots[0].data.occupantId = 'unrelated-user';
  const plan = buildFreshSeasonOneResetPlan(input);
  assert.equal(plan.ready, false);
  assert.ok(plan.reasons.includes('OCCUPIED_SLOT_STANDINGS_MISMATCH'));
});

test('fresh Season 1 reset plan rejects missing profiles and a prepared next season', () => {
  const missingProfile = createValidInput();
  missingProfile.profileIds.delete(missingProfile.tables[0].data.stats.BOT_ALPHA_L1_G1_R1.id);
  const missingPlan = buildFreshSeasonOneResetPlan(missingProfile);
  assert.equal(missingPlan.ready, false);
  assert.ok(missingPlan.reasons.includes('PARTICIPANT_PROFILE_MISSING'));

  const prepared = createValidInput();
  prepared.config.preparedSeasonNumber = 2;
  const preparedPlan = buildFreshSeasonOneResetPlan(prepared);
  assert.equal(preparedPlan.ready, false);
  assert.ok(preparedPlan.reasons.includes('PREPARED_NEXT_SEASON_EXISTS'));
});

test('fresh Season 1 club reset preserves latest match economy when it belongs to another season', () => {
  const profile = {
    lastMatchId: 'match_v140_S2_LALPHA_V1_G1_T1_R1_vs_R2',
    lastMatchEconomy: { totalRevenue: 900 },
    matchEconomy: {
      match_v140_S2_LALPHA_V1_G1_T1_R1_vs_R2: { totalRevenue: 900 },
    },
  };
  const reset = resetFreshSeasonOneClubProfileState(profile);
  assert.equal(reset.lastMatchId, profile.lastMatchId);
  assert.deepEqual(reset.lastMatchEconomy, profile.lastMatchEconomy);
  assert.deepEqual(reset.matchEconomy, profile.matchEconomy);
});

test('calendar bypasses the old fixture gate only for an explicitly marked Beta Season 1 rebuild', () => {
  const source = read('src/app/actions/season-calendar.ts');
  assert.match(source, /config\.stagingFreshSeasonOneReset === true/);
  assert.match(source, /sourceSeason === 1/);
  assert.match(source, /targetSeason === 1/);
  assert.match(source, /config\.worldReady !== true/);
  assert.match(source, /lockedPreflight = pristineFirstWorld \|\| directRecoveryBuild \|\| stagingFreshSeasonOneReset/);
  assert.match(source, /stagingFreshSeasonOneReset: false/);
});

test('legacy full-world reset is hard-blocked outside local Firebase Emulator', () => {
  const source = read('src/app/actions/clean-season1-world.ts');
  assert.match(source, /'players_v14'/);
  assert.match(source, /!process\.env\.FIRESTORE_EMULATOR_HOST/);
  assert.match(source, /process\.env\.VERCEL === '1'/);
  assert.match(source, /configuredProject === 'forge-rivalstest'/);
  assert.match(source, /EMULATOR_ONLY_RESET_BLOCKED/);
  assert.ok(source.indexOf('EMULATOR_ONLY_RESET_BLOCKED') < source.indexOf('const db = getAdminDb()'));
});

test('fresh Season 1 club provisioning retains account UID but creates a new starter club', () => {
  const oldProfile = {
    id: 'existing-manager-uid',
    email: 'manager@example.invalid',
    displayName: 'Manager',
    clubName: 'Old Club',
    numericId: 1042,
    credits: 987654,
    crystals: 900,
    ownedPlayers: [{ id: 'old-player-1' }, { id: 'old-player-2' }],
  };
  const fresh = createFreshSeasonOneHumanClubProfile(
    oldProfile,
    { tier: 3, group: 2, rank: 6 },
    1,
    new Date('2026-11-22T15:00:00.000Z'),
  );

  assert.equal(fresh.id, oldProfile.id);
  assert.equal(fresh.email, oldProfile.email);
  assert.equal(fresh.displayName, fresh.clubName);
  assert.match(fresh.clubName, /^New Club /);
  assert.notEqual(fresh.clubName, oldProfile.clubName);
  assert.equal(fresh.numericId, oldProfile.numericId);
  assert.equal(fresh.credits, 1_000_000);
  assert.equal(fresh.crystals, 50);
  assert.equal(fresh.experiencePoints, 0);
  assert.equal(fresh.managerLevel, 1);
  assert.equal(fresh.selectedLeagueId, 'ALPHA');
  assert.equal(fresh.leagueLevel, 3);
  assert.equal(fresh.groupId, 2);
  assert.equal(fresh.rank, 6);
  assert.equal(fresh.lastProcessedSeason, 1);
  assert.equal(fresh.ownedPlayers.length, 10);
  assert.notEqual(fresh.credits, oldProfile.credits);
  assert.notEqual(fresh.crystals, oldProfile.crystals);
  assert.equal(new Set(fresh.ownedPlayers.map(player => player.id)).size, 10);
  assert.ok(fresh.ownedPlayers.every(player => !['old-player-1', 'old-player-2'].includes(player.id)));
  assert.ok(fresh.ownedPlayers.every(player => player.overallRating >= 28 && player.overallRating <= 37));
  assert.equal(fresh.lineup.carry, fresh.ownedPlayers.find(player => player.role === 'Carry').id);
  assert.equal(fresh.lineup.sub_carry, fresh.ownedPlayers.filter(player => player.role === 'Carry')[1].id);
  assert.equal(fresh.lastLoginDate, '2026-11-22T15:00:00.000Z');
  assert.ok(fresh.ownedPlayers.every(player => player.hiredAt === '2026-11-22T15:00:00.000Z'));
  assert.equal(Object.hasOwn(fresh, 'trophies'), false);
});

test('fresh Season 1 club provisioning rejects bot identities and invalid placements', () => {
  assert.throws(() => createFreshSeasonOneHumanClubProfile(
    { id: 'BOT_ALPHA_L1_G1_R1' }, { tier: 1, group: 1, rank: 1 },
  ), /FRESH_CLUB_ACCOUNT_UID_INVALID/);
  assert.throws(() => createFreshSeasonOneHumanClubProfile(
    { id: 'uid-1' }, { tier: 4, group: 9, rank: 1 },
  ), /FRESH_CLUB_PLACEMENT_INVALID/);
});

test('fresh Season 1 player reset clears only individual season counters', () => {
  const player = {
    id: 'player-1',
    name: 'Player One',
    overallRating: 88,
    proStats: { reflexes: 91 },
    proTalents: { reflexes: 80 },
    trainingProgress: { reflexes: 0.75 },
    skillCaps: { reflexes: 99 },
    fatigue: 37,
    form: 82,
    tilt: 12,
    isInjured: true,
    injuredUntil: '2026-12-01T00:00:00.000Z',
    totalMatchesPlayed: 44,
    matchesPlayedToday: 2,
    lastMatchDateXP: '2026-11-22',
    titles: { league: 1, cup: 2, friendly: 3 },
    seasonStats: { matches: 12, wins: 8, kills: 77, warnings: 2 },
    chemistryMatches: 12,
    lineupMatches: 12,
    lastMatchMinutes: 56,
    lastMatchId: 'match_v140_S1_LALPHA_V1_G1_T14_R1_vs_R2',
    lastMatchOfficial: true,
    warningCount: 2,
    suspensionUntil: '2026-11-25T00:00:00.000Z',
  };

  const reset = resetFreshSeasonOnePlayerState(player);
  assert.deepEqual(reset.seasonStats, {
    matches: 0, wins: 0, successfulActions: 0, warnings: 0,
    disqualifications: 0, kills: 0, deaths: 0, assists: 0, postMatchRating: 0,
  });
  assert.equal(reset.chemistryMatches, 0);
  assert.equal(reset.lineupMatches, 0);
  assert.equal(reset.warningCount, 0);
  assert.equal(reset.suspensionUntil, null);
  assert.equal(reset.lastMatchId, null);
  assert.equal(reset.lastMatchOfficial, false);
  for (const key of [
    'id', 'name', 'overallRating', 'proStats', 'proTalents', 'trainingProgress',
    'skillCaps', 'fatigue', 'form', 'tilt', 'isInjured', 'injuredUntil',
    'totalMatchesPlayed', 'matchesPlayedToday', 'lastMatchDateXP', 'titles',
  ]) assert.deepEqual(reset[key], player[key], `preserves ${key}`);
});

test('fresh Season 1 club profile reset preserves finances and identity while clearing season references', () => {
  const profile = {
    id: 'manager-1',
    email: 'manager@example.invalid',
    clubName: 'Forge Club',
    credits: 123456,
    crystals: 42,
    lineup: { carry: 'player-1' },
    tactics: { style: 'balanced' },
    arena: { capacity: 5000 },
    ownedPlayers: [{
      id: 'player-1',
      overallRating: 88,
      proStats: { reflexes: 91 },
      seasonStats: { matches: 12, wins: 8 },
      chemistryMatches: 12,
      fatigue: 37,
      form: 82,
    }],
    seasonAwards: { S1: { rank: 1 }, S0: { rank: 2 } },
    trophies: [
      { id: 'league-cup-season-1', type: 'league_champion', season: 1 },
      { id: 'pyramid-cup-season-1', type: 'pyramid_cup_champion', season: 1 },
      { id: 'personal-achievement', type: 'player_award', season: 1 },
      { id: 'league-cup-season-2', type: 'league_champion', season: 2 },
    ],
    matchEconomy: {
      match_v140_S1_LALPHA_V1_G1_T14_R1_vs_R2: { totalRevenue: 500 },
      cup_S1_R1_M01: { totalRevenue: 250 },
      match_v140_S2_LALPHA_V1_G1_T1_R1_vs_R2: { totalRevenue: 700 },
    },
    lastMatchId: 'cup_S1_R1_M01',
    lastMatchId: 'cup_S1_R1_M01',
    lastMatchEconomy: { totalRevenue: 500 },
    lastMatchConsequences: {
      matchId: 'cup_S1_R1_M01',
      matchType: 'cup',
    },
  };

  const reset = resetFreshSeasonOneClubProfileState(profile);
  assert.deepEqual(reset.seasonAwards, { S0: { rank: 2 } });
  assert.deepEqual(reset.trophies, [
    { id: 'personal-achievement', type: 'player_award', season: 1 },
    { id: 'league-cup-season-2', type: 'league_champion', season: 2 },
  ]);
  assert.deepEqual(Object.keys(reset.matchEconomy), [
    'match_v140_S2_LALPHA_V1_G1_T1_R1_vs_R2',
  ]);
  assert.equal(reset.lastMatchId, null);
  assert.equal(reset.lastMatchEconomy, null);
  assert.equal(reset.lastMatchConsequences, null);
  assert.equal(reset.ownedPlayers[0].seasonStats.matches, 0);
  assert.equal(reset.ownedPlayers[0].chemistryMatches, 0);
  for (const key of ['id', 'email', 'credits', 'crystals', 'lineup', 'tactics', 'arena']) {
    assert.deepEqual(reset[key], profile[key], `preserves ${key}`);
  }
});

test('fresh Season 1 executor is project-scoped, journaled, idempotent and verifies the Pyramid Cup', () => {
  const source = read('src/app/actions/fresh-season-one-reset-executor.ts');
  assert.match(source, /staging_fresh_season_one_reset_v1/);
  assert.match(source, /stepIndex/);
  assert.match(source, /lease/);
  assert.match(source, /FRESH_SEASON_ONE_RESET_LEASE_LOST/);
  assert.match(source, /buildFreshSeasonOneWorldDocuments/);
  assert.match(source, /ensureSeasonCalendar\(1, \{ allowDuringStagingReset: true \}\)/);
  assert.match(source, /totalMatches\) !== 119/);
  assert.match(source, /rounds\?\.r1\) \|\| cup\.rounds\.r1\.length !== 56/);
  assert.match(source, /snapshotDocs\.size !== 120/);
  assert.match(source, /leagueMatches\.length !== 840/);
  assert.match(source, /RESET_TARGET_CHANGED_DURING_RECOVERY/);
  assert.doesNotMatch(source, /admin\.auth\(\)\.deleteUser|deleteUsers\(/);
  const calendar = read('src/app/actions/season-calendar.ts');
  assert.match(calendar, /stagingSeasonOneResetInProgress === true && options\.allowDuringStagingReset !== true/);
  const orchestrator = read('src/app/actions/season-cycle.ts');
  assert.match(orchestrator, /STAGING_SEASON_ONE_RESET_IN_PROGRESS/);
  const leagueWorker = read('src/app/actions/autonomous-cycle.ts');
  assert.match(leagueWorker, /freshConfig\.stagingSeasonOneResetInProgress === true/);
  assert.match(leagueWorker, /settlementConfig\.stagingSeasonOneResetInProgress === true/);
  const cupWorker = read('src/app/actions/cup-engine.ts');
  assert.match(cupWorker, /STAGING_SEASON_ONE_RESET_IN_PROGRESS/);
  const tournamentWorker = read('src/app/actions/tournament-system.ts');
  assert.match(tournamentWorker, /STAGING_SEASON_ONE_RESET_IN_PROGRESS/);
  assert.match(tournamentWorker, /db\.runTransaction\(async \(t: any\) => \{[\s\S]*?t\.get\(db\.collection\('system_v1'\)\.doc\('season_config'\)\)/);
  assert.match(tournamentWorker, /resetConfigSnap\.data\(\)\?\.stagingSeasonOneResetInProgress === true/);
  const cupTransactions = read('src/app/actions/cup-engine.ts');
  assert.match(cupTransactions, /db\.runTransaction\(async \(tx: any\) => \{[\s\S]*?tx\.get\(db\.collection\('system_v1'\)\.doc\('season_config'\)\)/);
  assert.match(cupTransactions, /resetConfigSnap\.data\(\)\?\.stagingSeasonOneResetInProgress === true/);
  const marketWorker = read('src/app/lib/auction-expiry-sweep.ts');
  assert.match(marketWorker, /configSnap\.data\(\)\?\.stagingSeasonOneResetInProgress === true/);
  const marketSettlement = read('src/app/lib/auction-expiry-sweep.ts');
  assert.match(marketSettlement, /const \[lotSnap, resetConfigSnap\] = await Promise\.all\(\[tx\.get\(lotRef\), tx\.get\(resetConfigRef\)\]\)/);
  assert.match(marketSettlement, /resetConfigSnap\.data\(\)\?\.stagingSeasonOneResetInProgress === true/);
  const matchEconomy = read('src/app/actions/match-economy.ts');
  assert.match(matchEconomy, /configSnap\.data\(\)\?\.stagingSeasonOneResetInProgress === true/);
  const seasonInit = read('src/app/actions/season-init.ts');
  assert.match(seasonInit, /transaction\.get\(configRef\)/);
  assert.match(seasonInit, /STAGING_SEASON_ONE_RESET_IN_PROGRESS/);
});
