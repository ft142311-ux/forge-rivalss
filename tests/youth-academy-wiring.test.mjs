import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const actions = read('../src/app/actions/youth-academy.ts');
const service = read('../src/app/lib/youth-academy.ts');
const rules = read('../src/app/lib/youth-academy-rules.ts');
const gameplay = read('../src/app/actions/gameplay.ts');
const listing = read('../src/app/lib/market-listing.ts');
const auction = read('../src/app/lib/auction-expiry-sweep.ts');
const trainingPage = read('../src/app/youth-academy/training/page.tsx');
const packageJson = JSON.parse(read('../package.json'));

test('youth academy mutations are authenticated, transactional and fenced against Season 1 reset', () => {
  for (const name of [
    'scoutYouthCandidatesAction',
    'recruitYouthCandidateAction',
    'clearYouthScoutingReportAction',
    'promoteYouthPlayerAction',
    'completeDailyYouthTrainingAction',
  ]) {
    assert.ok(actions.includes('export async function ' + name));
  }
  assert.equal((actions.match(/requireServerActor\(idToken\)/g) || []).length, 5);
  assert.ok(service.includes('assertStagingSeasonOneResetNotInProgress(tx, db)'));
  assert.ok(service.includes("db.collection('players_v14').doc(uid)"));
  assert.doesNotMatch(service, /managerXp|experiencePoints|managerLevel/);
});

test('scouting and recruitment validate academy capacity, preserve scout quality and are idempotent', () => {
  assert.ok(service.includes('getYouthAcademyCapacity(profile.academy)'));
  assert.ok(service.includes('getYouthScoutLevel(profile.academy)'));
  assert.ok(service.includes('Math.min(20, scoutLevel * 1.25)'));
  assert.ok(service.includes('scoutingRevision: nextRevision'));
  assert.ok(service.includes('YOUTH_ACADEMY_FULL'));
  assert.ok(service.includes('alreadyRecruited: true'));
  assert.ok(service.includes('PLAYER_ALREADY_IN_FIRST_TEAM'));
  assert.ok(rules.includes('Number.isSafeInteger(parsed)'));
});

test('promotion validates game age, market reservation and unfinished training before moving rosters', () => {
  assert.ok(service.includes('resolveYouthPlayerAge(player, nowMs)'));
  assert.ok(service.includes("if (age < 18) throw new Error('YOUTH_PLAYER_NOT_18')"));
  assert.ok(service.includes("if (player.dailyTrainingFinishTime) throw new Error('YOUTH_TRAINING_IN_PROGRESS')"));
  assert.ok(service.includes('PLAYER_OWNERSHIP_AMBIGUOUS'));
  assert.ok(service.includes('ownedPlayers: [...owned, promoted]'));
  assert.ok(service.includes('youthAcademyPlayers: youth.filter'));
});

test('daily training uses validated rosters, canonical growth and one-time server completion', () => {
  assert.ok(gameplay.includes('startDailyTrainingWithDb(getAdminDb(), uid, playerId, focus)'));
  assert.ok(service.includes('readFoundationRoster'));
  assert.ok(service.includes('applyTraining({ ...player, age }'));
  assert.ok(service.includes('YOUTH_TRAINING_NOT_FINISHED'));
  assert.ok(service.includes('dailyTrainingFinishTime: null'));
  assert.ok(listing.includes("if (player.dailyTrainingFinishTime) throw new Error('YOUTH_TRAINING_IN_PROGRESS')"));
  assert.ok(trainingPage.includes('resolveTrainingFinishTimeMs(player.dailyTrainingFinishTime)'));
  assert.doesNotMatch(trainingPage, /new Date\(player\.dailyTrainingFinishTime!\)\.getTime\(\)/);
});

test('youth auctions require an exact seller lock and a valid buyer academy capacity', () => {
  assert.ok(auction.includes('isYouthMarketLockValidForLot'));
  assert.ok(auction.includes('canAcceptYouthAuctionPurchase'));
  assert.ok(auction.includes('buyerYouthCapacityAvailable'));
  assert.ok(auction.includes('sellerHasCrossRosterDuplicate'));
  assert.ok(auction.includes('buyerDoesNotAlreadyOwnYouth'));
  assert.ok(listing.includes('PLAYER_OWNERSHIP_AMBIGUOUS'));
  assert.ok(listing.includes('player.transferMarketId'));
});

test('youth emulator coverage is wired into the Beta-only Firestore integration command', () => {
  assert.ok(packageJson.scripts['test:registration:emulator'].includes('tests/youth-academy-emulator.integration.test.mjs'));
});
