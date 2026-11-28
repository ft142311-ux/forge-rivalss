import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const economy = read('../src/app/actions/economy.ts');
const league = read('../src/app/actions/autonomous-cycle.ts');
const universal = read('../src/app/actions/universal-match-resolver.ts');
const tournaments = read('../src/app/actions/tournament-system.ts');
const store = read('../src/app/lib/store.tsx');
const home = read('../src/app/page.tsx');
const topBar = read('../src/components/game/TopBar.tsx');

test('daily reward XP is committed atomically with its existing idempotency receipt', () => {
  assert.match(economy, /createManagerXpAward\(p, MANAGER_XP_REWARDS\.dailyReward, 'daily_reward'\)/);
  assert.match(economy, /\.\.\.managerXpAward\.profilePatch/);
  assert.match(economy, /managerXp: managerXpAward\.receipt/);
  assert.match(economy, /t\.create\(receiptRef/);
});

test('official league settlement awards both eligible managers in the match transaction', () => {
  assert.match(league, /createManagerXpAward\(homePlayerData, getManagerMatchXp\('league'/);
  assert.match(league, /createManagerXpAward\(awayPlayerData, getManagerMatchXp\('league'/);
  assert.match(league, /managerXpAwards/);
  assert.match(league, /Object\.assign\(homeUpdate, homeManagerXp\.profilePatch\)/);
  assert.match(league, /Object\.assign\(awayUpdate, awayManagerXp\.profilePatch\)/);
});

test('universal match resolution awards Cup XP in the same match transaction', () => {
  assert.match(universal, /createManagerXpAward\(homeData, getManagerMatchXp\(xpCompetition/);
  assert.match(universal, /managerXpAwards/);
  assert.match(universal, /if \(homeManagerXp\) t\.update/);
  assert.match(universal, /if \(awayManagerXp\) t\.update/);
});

test('tournament XP is awarded only after the processing token and profile are verified', () => {
  const start = tournaments.indexOf('const finalized = await db.runTransaction');
  const end = tournaments.indexOf('\n    });\n    return finalized === true;', start);
  const finalize = tournaments.slice(start, end);
  const reads = finalize.indexOf('const humanProfileSnaps = await Promise.all');
  const firstWrite = finalize.search(/\bt\.(?:update|set|create|delete)\s*\(/);
  assert.ok(reads >= 0 && firstWrite > reads);
  assert.match(finalize, /createManagerXpAward\(profileData, getManagerMatchXp\('tournament'/);
  assert.match(finalize, /managerXpAwards/);
});

test('manager level changes are announced and progress is visible in home and top bar', () => {
  assert.match(store, /managerLevelSnapshotRef/);
  assert.match(store, /НОВЫЙ УРОВЕНЬ МЕНЕДЖЕРА/);
  assert.match(home, /managerXpProgress/);
  assert.match(topBar, /managerXpProgress/);
});
