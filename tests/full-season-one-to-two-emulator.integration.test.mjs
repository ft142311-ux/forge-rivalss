import test from 'node:test';
import assert from 'node:assert/strict';
import { getAdminDb } from '../src/lib/firebase-admin.ts';
import { ensureSeasonCalendar, publishPreparedSeason, activatePublishedSeason } from '../src/app/actions/season-calendar.ts';
import { buildBotClub } from '../src/app/actions/bot-roster.ts';
import { calculateGroupStandings } from '../src/app/actions/season-rollover-standings.ts';
import { getTableId } from '../src/app/lib/leagues-data.ts';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const DAY_MS = 24 * 60 * 60 * 1000;
const HUMAN_ID = 'HUMAN_FULL_SEASON_ACCEPTANCE';

function buildFixtures(level, group) {
  const teams = Array.from({ length: 8 }, (_, index) => {
    const rank = index + 1;
    const id = level === 1 && group === 1 && rank === 1
      ? HUMAN_ID
      : `BOT_ALPHA_L${level}_G${group}_R${rank}`;
    return { id, name: id === HUMAN_ID ? 'Human Acceptance Club' : `Bot D${level} G${group} R${rank}`, rank };
  });
  const firstLeg = [];
  let rotation = [...teams];
  for (let tour = 1; tour <= 7; tour++) {
    for (let index = 0; index < 4; index++) {
      firstLeg.push({ tour, home: rotation[index], away: rotation[7 - index] });
    }
    rotation = [rotation[0], rotation[7], ...rotation.slice(1, 7)];
  }
  return [...firstLeg, ...firstLeg.map(item => ({ tour: item.tour + 7, home: item.away, away: item.home }))]
    .map((fixture, index) => {
      const lowerRankWins = fixture.home.rank < fixture.away.rank;
      const score = lowerRankWins ? { home: 2, away: 0 } : { home: 0, away: 2 };
      return {
        matchId: `S1_ACCEPT_D${level}_G${group}_M${String(index + 1).padStart(2, '0')}`,
        season: 1,
        version: 140,
        leagueId: 'ALPHA',
        type: 'league',
        matchType: 'league',
        level,
        groupId: group,
        tour: fixture.tour,
        homeRank: fixture.home.rank,
        awayRank: fixture.away.rank,
        homeId: fixture.home.id,
        homeName: fixture.home.name,
        awayId: fixture.away.id,
        awayName: fixture.away.name,
        score,
        scoreA: score.home,
        scoreB: score.away,
        status: 'finished',
        isFinished: true,
        resolvedAt: new Date(Date.now() - (15 - fixture.tour) * DAY_MS),
      };
    });
}

test('Full isolated Emulator journey: Season 1 rollover, Season 2 world and Pyramid Cup preparation, publication, activation and cleanup', {
  skip: !emulatorHost,
}, async t => {
  assert.match(emulatorHost, /^(127[.]0[.]0[.]1|localhost):[0-9]+$/);
  const projectId = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
  assert.equal(projectId, 'demo-forge-rivals-season-lifecycle-test');

  const db = getAdminDb();
  const collections = [
    'system_v1', 'league_tables_v2', 'league_slots_v1', 'players_v14', 'matches_v2',
    'cup_pyramid_v1', 'cup_matches', 'cup_participant_snapshots_v1',
    'league_season_archives_v1', 'league_season_rollovers_v1',
    'league_season_history_v1', 'league_slot_history_v1',
    'economy_transactions', 'market_v7', 'match_player_effects_v1',
    'match_consequence_receipts', 'match_report_views_v1',
  ];
  t.after(async () => {
    for (const name of collections) {
      const snapshot = await db.collection(name).get().catch(() => null);
      if (!snapshot) continue;
      for (let offset = 0; offset < snapshot.docs.length; offset += 400) {
        const batch = db.batch();
        snapshot.docs.slice(offset, offset + 400).forEach(doc => batch.delete(doc.ref));
        await batch.commit().catch(() => undefined);
      }
    }
    for (const root of ['cup_s1_lALPHA', 'cup_s2_lALPHA', 'S1', 'S2']) {
      const cupSnapshot = await db.collection('cup_participant_snapshots_v1').doc(root).collection('teams').get().catch(() => null);
      if (cupSnapshot) {
        for (let offset = 0; offset < cupSnapshot.docs.length; offset += 400) {
          const batch = db.batch();
          cupSnapshot.docs.slice(offset, offset + 400).forEach(doc => batch.delete(doc.ref));
          await batch.commit().catch(() => undefined);
        }
      }
      const archiveSnapshot = await db.collection('league_season_archives_v1').doc(root).collection('matches').get().catch(() => null);
      if (archiveSnapshot) {
        for (let offset = 0; offset < archiveSnapshot.docs.length; offset += 400) {
          const batch = db.batch();
          archiveSnapshot.docs.slice(offset, offset + 400).forEach(doc => batch.delete(doc.ref));
          await batch.commit().catch(() => undefined);
        }
      }
    }
  });

  const seasonStartMs = Date.now() - 18 * DAY_MS;
  const seasonStart = new Date(seasonStartMs);
  const seasonBoundary = new Date(seasonStartMs + 17 * DAY_MS);
  const seasonTwoNextBoundary = new Date(seasonBoundary.getTime() + 15 * DAY_MS);
  const configRef = db.collection('system_v1').doc('season_config');
  await configRef.set({
    activeSeasonNumber: 1,
    phase: 'REGULAR_SEASON',
    worldReady: true,
    worldGeneration: 'CLEAN_S1_V1',
    seasonStart: seasonStart.toISOString(),
    nextSeasonStart: seasonBoundary.toISOString(),
    calendarRevision: 4,
    pyramidCupRequired: true,
    pyramidCupReady: true,
    pyramidCupReadySeasonNumber: 1,
    historyCleanupPending: false,
  });
  await db.collection('cup_pyramid_v1').doc('cup_s1_lALPHA').set({
    id: 'cup_s1_lALPHA',
    season: 1,
    status: 'completed',
    winnerId: HUMAN_ID,
    winnerName: 'Human Acceptance Club',
  });

  const seedWrites = [];
  const totalFixtures = [];
  for (let level = 1; level <= 4; level++) {
    for (let group = 1; group <= 2 ** (level - 1); group++) {
      const fixtures = buildFixtures(level, group);
      assert.equal(fixtures.length, 56);
      const slots = Array.from({ length: 8 }, (_, index) => {
        const rank = index + 1;
        const id = level === 1 && group === 1 && rank === 1
          ? HUMAN_ID
          : `BOT_ALPHA_L${level}_G${group}_R${rank}`;
        return {
          season: 1,
          leagueId: 'ALPHA',
          division: level,
          group,
          rank,
          status: id === HUMAN_ID ? 'OCCUPIED' : 'FREE',
          occupantId: id === HUMAN_ID ? HUMAN_ID : null,
          occupancyGeneration: id === HUMAN_ID ? 11 : 0,
          id,
        };
      });
      const computed = calculateGroupStandings({}, fixtures, 8, slots);
      const stats = Object.fromEntries(computed.map(row => [row.id, { ...row, isBot: row.id.startsWith('BOT_') }]));
      const tableId = getTableId(1, 'ALPHA', level, group);
      seedWrites.push({
        ref: db.collection('league_tables_v2').doc(tableId),
        data: { id: tableId, leagueId: 'ALPHA', level, group, season: 1, version: 140, stats },
      });
      for (const slot of slots) {
        const slotId = `S1_LALPHA_D${level}_G${group}_R${slot.rank}`;
        seedWrites.push({
          ref: db.collection('league_slots_v1').doc(slotId),
          data: { ...slot, id: slotId },
        });
      }
      for (const fixture of fixtures) {
        seedWrites.push({
          ref: db.collection('matches_v2').doc(fixture.matchId),
          data: fixture,
        });
        totalFixtures.push(fixture);
      }
    }
  }
  assert.equal(totalFixtures.length, 840);

  const allTeamIds = new Set();
  for (const fixture of totalFixtures) {
    allTeamIds.add(fixture.homeId);
    allTeamIds.add(fixture.awayId);
  }
  const profileWrites = [...allTeamIds].map(id => {
    const name = id === HUMAN_ID ? 'Human Acceptance Club' : id.replaceAll('_', ' ');
    const profile = buildBotClub(id, name);
    return {
      ref: db.collection('players_v14').doc(id),
      data: {
        ...profile,
        id,
        uid: id,
        clubName: name,
        displayName: name,
        isBot: id !== HUMAN_ID,
        credits: id === HUMAN_ID ? 1_000_000 : 0,
        trophies: [],
        seasonAwards: {},
      },
    };
  });
  assert.equal(profileWrites.length, 120);

  const allWrites = [...seedWrites, ...profileWrites];
  for (let offset = 0; offset < allWrites.length; offset += 400) {
    const batch = db.batch();
    allWrites.slice(offset, offset + 400).forEach(write => batch.set(write.ref, write.data));
    await batch.commit();
  }

  const sourceCupMatches = await db.collection('cup_matches').limit(1).get();
  assert.equal(sourceCupMatches.empty, true);

  const prepared = await ensureSeasonCalendar(2);
  assert.equal(prepared.success, true, JSON.stringify(prepared));
  assert.equal(prepared.prepared, true);
  assert.equal(prepared.worldReady, true);
  assert.equal(prepared.seasonNumber, 2);
  assert.equal(prepared.totalExpectedMatches, 840);
  assert.equal(prepared.totalExpectedSlots, 120);

  const [preparedConfig, rolloverArchive, rolloverPlan] = await Promise.all([
    configRef.get(),
    db.collection('league_season_archives_v1').doc('S1').get(),
    db.collection('league_season_rollovers_v1').doc('S2').get(),
  ]);
  assert.equal(preparedConfig.get('activeSeasonNumber'), 1);
  assert.equal(preparedConfig.get('preparedSeasonNumber'), 2);
  assert.equal(preparedConfig.get('preparedWorldReady'), true);
  assert.equal(rolloverArchive.get('status'), 'completed');
  assert.equal(rolloverArchive.get('expectedMatches'), 840);
  assert.equal(rolloverPlan.get('ready'), true);

  const [s2Tables, s2Slots, s2Matches] = await Promise.all([
    db.collection('league_tables_v2').where('season', '==', 2).get(),
    db.collection('league_slots_v1').where('season', '==', 2).get(),
    db.collection('matches_v2').where('season', '==', 2).get(),
  ]);
  assert.equal(s2Tables.size, 15);
  assert.equal(s2Slots.size, 120);
  assert.equal(s2Matches.size, 840);
  const s2HumanSlots = s2Slots.docs.filter(doc => doc.get('occupantId') === HUMAN_ID);
  assert.equal(s2HumanSlots.length, 1);
  assert.equal(s2HumanSlots[0].get('status'), 'OCCUPIED');

  const published = await publishPreparedSeason();
  assert.equal(published.success, true, JSON.stringify(published));
  assert.equal(published.published, true);
  const [publishedConfig, seasonTwoCup] = await Promise.all([
    configRef.get(),
    db.collection('cup_pyramid_v1').doc('cup_s2_lALPHA').get(),
  ]);
  assert.equal(publishedConfig.get('phase'), 'PUBLISHED');
  assert.equal(publishedConfig.get('preparedPublished'), true);
  assert.equal(seasonTwoCup.exists, true);
  assert.equal(seasonTwoCup.get('totalParticipants'), 120);
  assert.equal(seasonTwoCup.get('totalMatches'), 119);
  assert.equal(seasonTwoCup.get('preliminaryMatches'), 56);
  assert.equal(seasonTwoCup.get('openingRoundRestCount'), 8);
  assert.equal(seasonTwoCup.get('byeCount'), 0);
  assert.equal(seasonTwoCup.get('rounds.r1').length, 56);
  const seasonTwoCupSnapshots = await db.collection('cup_participant_snapshots_v1').doc('cup_s2_lALPHA').collection('teams').get();
  assert.equal(seasonTwoCupSnapshots.size, 120);

  const activated = await activatePublishedSeason();
  assert.equal(activated.success, true, JSON.stringify(activated));
  assert.equal(activated.action, 'SEASON_ACTIVATED');
  assert.equal(activated.worldReady, true);
  const [activeConfig, finalArchive, retainedRolloverPlan, humanProfile, humanLedger] = await Promise.all([
    configRef.get(),
    db.collection('league_season_archives_v1').doc('S1').get(),
    db.collection('league_season_rollovers_v1').doc('S2').get(),
    db.collection('players_v14').doc(HUMAN_ID).get(),
    db.collection('economy_transactions').doc(`season_1_${HUMAN_ID}`).get(),
  ]);
  assert.equal(activeConfig.get('activeSeasonNumber'), 2);
  assert.equal(activeConfig.get('phase'), 'REGULAR_SEASON');
  assert.equal(activeConfig.get('worldReady'), true);
  assert.equal(activeConfig.get('historyCleanupPending'), false);
  assert.equal(activeConfig.get('retainedArchiveSeason'), 1);
  assert.equal(finalArchive.get('status'), 'completed');
  assert.equal(finalArchive.get('expectedMatches'), 840);
  assert.equal(retainedRolloverPlan.exists, true);
  assert.equal(humanProfile.exists, true);
  assert.equal(humanProfile.get('uid'), HUMAN_ID);
  assert.equal(humanProfile.get('credits'), 5_000_000);
  assert.equal(humanProfile.get('trophies').length, 2);
  assert.equal(humanLedger.get('amount'), 4_000_000);

  const [visibleArchives, visiblePlans] = await Promise.all([
    db.collection('league_season_archives_v1').get(),
    db.collection('league_season_rollovers_v1').get(),
  ]);
  assert.deepEqual(visibleArchives.docs.map(doc => doc.id), ['S1']);
  assert.deepEqual(visiblePlans.docs.map(doc => doc.id), ['S2']);
});
