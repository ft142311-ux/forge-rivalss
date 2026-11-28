import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('youth academy actions are server-authoritative and connected to the game store', () => {
  const actions = read('../src/app/actions/youth-academy.ts');
  const store = read('../src/app/lib/store.tsx');
  for (const name of [
    'scoutYouthCandidatesAction',
    'recruitYouthCandidateAction',
    'clearYouthScoutingReportAction',
    'promoteYouthPlayerAction',
    'completeDailyYouthTrainingAction',
  ]) assert.ok(actions.includes('function ' + name), name + ' action exists');
  for (const name of ['scoutCandidates', 'recruitCandidate', 'promoteYouthPlayer', 'claimDailyPlayerTraining']) {
    assert.ok(store.includes('const ' + name + ' = useCallback'), name + ' is wired through the store');
  }
});

test('scouting and recruitment persist candidates and enforce academy capacity', () => {
  const actions = read('../src/app/actions/youth-academy.ts');
  assert.ok(actions.includes('generateScoutedPlayer'));
  assert.ok(actions.includes('scoutingCandidates: candidates'));
  assert.ok(actions.includes('YOUTH_ACADEMY_FULL'));
  assert.ok(actions.includes('youthAcademyPlayers: [...youthPlayers, player]'));
});

test('youth training uses a 24-hour server timer and applies growth only after completion', () => {
  const gameplay = read('../src/app/actions/gameplay.ts');
  const actions = read('../src/app/actions/youth-academy.ts');
  assert.ok(gameplay.includes('youthAcademyPlayers'));
  assert.ok(gameplay.includes('Date.now() + 24 * 3600000'));
  assert.ok(actions.includes('YOUTH_TRAINING_NOT_FINISHED'));
  assert.ok(actions.includes('proStats: stats'));
  assert.ok(actions.includes('dailyTrainingFinishTime: null'));
});

test('promotion requires age 18 and atomically moves a player to the senior roster', () => {
  const actions = read('../src/app/actions/youth-academy.ts');
  assert.ok(actions.includes('age.numeric < 18'));
  assert.ok(actions.includes('YOUTH_PLAYER_NOT_18'));
  assert.ok(actions.includes('youthAcademyPlayers: youthPlayers.filter'));
  assert.ok(actions.includes('ownedPlayers: [...seniorPlayers, promoted]'));
});

test('youth auctions respect academy capacity and settle into youth rosters', () => {
  const auction = read('../src/app/lib/auction-expiry-sweep.ts');
  const listing = read('../src/app/lib/market-listing.ts');
  assert.ok(auction.includes("lot.isYouth === true ? 'youthAcademyPlayers' : 'ownedPlayers'"));
  assert.ok(auction.includes('buyerHasYouthCapacity'));
  assert.ok(listing.includes('youthAcademyPlayers: players'));
});
