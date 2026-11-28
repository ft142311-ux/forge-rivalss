import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const economy = read('../src/app/actions/economy.ts');
const league = read('../src/app/actions/autonomous-cycle.ts');
const universal = read('../src/app/actions/universal-match-resolver.ts');
const tournaments = read('../src/app/actions/tournament-system.ts');
const trial = read('../src/app/actions/trial-match-resolver.ts');
const friendly = read('../src/app/actions/friendly-matchmaking.ts');
const store = read('../src/app/lib/store.tsx');
const home = read('../src/app/page.tsx');
const topBar = read('../src/components/game/TopBar.tsx');

test('daily reward claims never award manager XP', () => {
  assert.doesNotMatch(economy, /tryCreateManagerXpAward|managerXp/);
  const start = store.indexOf('const claimReward = useCallback');
  const end = store.indexOf('const purchasePremium = useCallback', start);
  const claim = store.slice(start, end);
  assert.doesNotMatch(claim, /managerXp|managerLevel|experiencePoints/);
});

test('official league settlement awards both eligible managers in the match transaction', () => {
  assert.match(league, /tryCreateManagerXpAward\(homePlayerData, getManagerMatchXp\('league'/);
  assert.match(league, /tryCreateManagerXpAward\(awayPlayerData, getManagerMatchXp\('league'/);
  assert.match(league, /managerXpAwards/);
  assert.match(league, /managerXpSkipped/);
  assert.match(league, /Object\.assign\(homeUpdate, homeManagerXp\.profilePatch\)/);
  assert.match(league, /Object\.assign\(awayUpdate, awayManagerXp\.profilePatch\)/);
});

test('universal match resolution awards Cup XP in the same match transaction', () => {
  assert.match(universal, /tryCreateManagerXpAward\(homeData, getManagerMatchXp\(xpCompetition/);
  assert.match(universal, /managerXpAwards/);
  assert.match(universal, /managerXpSkipped/);
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
  assert.match(finalize, /tryCreateManagerXpAward\(profileData, getManagerMatchXp\('tournament'/);
  assert.match(finalize, /managerXpAwards/);
  assert.match(finalize, /managerXpSkipped/);
});

test('corrupt manager XP cannot block official match settlement transactions', () => {
  for (const source of [league, universal, tournaments, trial]) {
    assert.doesNotMatch(source, /createManagerXpAward\(/);
    assert.match(source, /tryCreateManagerXpAward/);
  }
});

test('trial match XP is committed with the terminal match report exactly once', () => {
  assert.match(trial, /tryCreateManagerXpAward\(currentProfile, getManagerMatchXp\('trial'/);
  assert.match(trial, /tryCreateManagerXpAward\(profileData, getManagerMatchXp\('trial'/);
  assert.match(trial, /if \(managerXpAward\) tx\.update\(profileRef, managerXpAward\.profilePatch\)/);
  assert.match(trial, /if \(managerXpAward\) transaction\.update\(profileRef, managerXpAward\.profilePatch\)/);
  assert.match(trial, /managerXpAwards/);
});

test('association matches award 20/30 XP and friendly challenges award 10/15 XP to both managers', () => {
  assert.match(friendly, /const isAssociationMatch = collectionName === MATCH_COLLECTIONS\\.association \\|\\| matchType === 'basket'/);
  assert.match(friendly, /getManagerMatchXp\\(competition, report\\.winnerId === String\\(match\\.hostId\\)\\)/);
  assert.match(friendly, /getManagerMatchXp\\(competition, report\\.winnerId === String\\(match\\.challengerId\\)\\)/);
  assert.match(friendly, /tryCreateManagerXpAward\\(homeData/);
  assert.match(friendly, /tryCreateManagerXpAward\\(awayData/);
  assert.match(friendly, /if \\(homeXpAward\\) t\\.update\\(homeSnap\\.ref/);
  assert.match(friendly, /if \\(awayXpAward\\) t\\.update\\(awaySnap\\.ref/);
  assert.match(friendly, /managerXpAwards/);
  assert.match(friendly, /managerXpSkipped/);
});

test('manager level changes are announced and progress is visible in home and top bar', () => {
  assert.match(store, /normalizeManagerProgress\(d\)/);
  assert.match(store, /managerLevel: normalizedManagerProgress\.managerLevel/);
  assert.match(store, /experiencePoints: normalizedManagerProgress\.experiencePoints/);
  assert.match(store, /managerLevelSnapshotRef/);
  assert.match(store, /НОВЫЙ УРОВЕНЬ МЕНЕДЖЕРА/);
  assert.match(home, /managerXpProgress/);
  assert.match(topBar, /managerXpProgress/);
});
