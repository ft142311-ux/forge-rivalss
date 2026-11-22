import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildFreshSeasonOneResetPlan } from '../src/app/actions/staging-season-one-reset-plan.ts';
import { resetFreshSeasonOnePlayerState } from '../src/app/actions/fresh-season-one-player-reset.ts';

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

  return {
    config: { activeSeasonNumber: 1, worldReady: true, phase: 'REGULAR_SEASON' },
    tables, slots, matches, profileIds,
    cupExists: false, cupMatches: 0, cupSnapshots: 0,
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
  assert.match(source, /export async function GET/);
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
  assert.match(source, /season_rollover_v1/);
  assert.match(source, /season_calendar_build_v1/);
  assert.match(source, /collection\('matches'\)/);
  assert.doesNotMatch(source, /\.set\(|\.create\(|\.update\(|\.delete\(|runTransaction\(/);
  assert.doesNotMatch(source, /participantIds\s*:\s*\[|profileIds\s*:\s*\[/);
});

test('fresh Season 1 reset plan validates 120 participants and complete 840-match round robin', () => {
  const plan = buildFreshSeasonOneResetPlan(createValidInput());
  assert.equal(plan.ready, true, plan.reasons.join(','));
  assert.equal(plan.preserve.participantProfiles, 120);
  assert.equal(plan.preserve.leagueSlots, 120);
  assert.equal(plan.expected.leagueMatches, 840);
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

test('fresh Season 1 preflight rejects slot identity and match round-robin corruption', () => {
  const slotInput = createValidInput();
  slotInput.slots[0].data.status = 'OCCUPIED';
  slotInput.slots[0].data.occupantId = 'unrelated-user';
  const slotPlan = buildFreshSeasonOneResetPlan(slotInput);
  assert.equal(slotPlan.ready, false);
  assert.ok(slotPlan.reasons.includes('OCCUPIED_SLOT_STANDINGS_MISMATCH'));

  const matchInput = createValidInput();
  matchInput.matches[0].data.homeId = matchInput.matches[0].data.awayId;
  const matchPlan = buildFreshSeasonOneResetPlan(matchInput);
  assert.equal(matchPlan.ready, false);
  assert.ok(matchPlan.reasons.includes('LEAGUE_MATCH_SCOPE_INVALID'));
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

test('legacy full-world reset is hard-blocked outside local Firebase Emulator', () => {
  const source = read('src/app/actions/clean-season1-world.ts');
  assert.match(source, /'players_v14'/);
  assert.match(source, /!process\.env\.FIRESTORE_EMULATOR_HOST/);
  assert.match(source, /process\.env\.VERCEL === '1'/);
  assert.match(source, /configuredProject === 'forge-rivalstest'/);
  assert.match(source, /EMULATOR_ONLY_RESET_BLOCKED/);
  assert.ok(source.indexOf('EMULATOR_ONLY_RESET_BLOCKED') < source.indexOf('const db = getAdminDb()'));
});

test('fresh Season 1 player reset clears only season counters and stale competition references', () => {
  const player = {
    id: 'manager-1',
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
    credits: 123456,
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
    lastMatchEconomy: { totalRevenue: 500 },
    lastMatchConsequences: {
      matchId: 'match_v140_S1_LALPHA_V1_G1_T14_R1_vs_R2',
      matchType: 'league',
    },
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
  assert.deepEqual(reset.seasonAwards, { S0: { rank: 2 } });
  assert.deepEqual(reset.trophies, [
    { id: 'personal-achievement', type: 'player_award', season: 1 },
    { id: 'league-cup-season-2', type: 'league_champion', season: 2 },
  ]);
  assert.deepEqual(Object.keys(reset.matchEconomy), [
    'match_v140_S2_LALPHA_V1_G1_T1_R1_vs_R2',
  ]);
  assert.equal(reset.lastMatchEconomy, null);
  assert.equal(reset.lastMatchConsequences, null);

  for (const key of [
    'id', 'name', 'overallRating', 'proStats', 'proTalents', 'trainingProgress',
    'skillCaps', 'fatigue', 'form', 'tilt', 'isInjured', 'injuredUntil',
    'credits', 'totalMatchesPlayed', 'matchesPlayedToday', 'lastMatchDateXP', 'titles',
  ]) assert.deepEqual(reset[key], player[key], `preserves ${key}`);
});

test('fresh Season 1 preflight refuses active settlement and season worker locks', () => {
  const processing = createValidInput();
  processing.matches[0].data.isProcessing = true;
  const processingPlan = buildFreshSeasonOneResetPlan(processing);
  assert.equal(processingPlan.ready, false);
  assert.ok(processingPlan.reasons.includes('MATCH_SETTLEMENT_IN_PROGRESS'));

  const locked = createValidInput();
  locked.liveLocks = ['season_calendar_build_v1'];
  const lockedPlan = buildFreshSeasonOneResetPlan(locked);
  assert.equal(lockedPlan.ready, false);
  assert.ok(lockedPlan.reasons.includes('SEASON_WORKER_LOCKED'));
});

test('fresh Season 1 preflight rejects unknown season match documents', () => {
  const input = createValidInput();
  input.unclassifiedMatches = 1;
  const plan = buildFreshSeasonOneResetPlan(input);
  assert.equal(plan.ready, false);
  assert.ok(plan.reasons.includes('UNCLASSIFIED_SEASON_MATCH_DOCUMENTS'));
});
