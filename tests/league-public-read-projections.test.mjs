import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const cupRoute = readFileSync(new URL('../src/app/api/league/cup/route.ts', import.meta.url), 'utf8');
const matchesRoute = readFileSync(new URL('../src/app/api/league/matches/route.ts', import.meta.url), 'utf8');
const cupPage = readFileSync(new URL('../src/app/tournaments/cup/page.tsx', import.meta.url), 'utf8');
const matchesPage = readFileSync(new URL('../src/app/matches/page.tsx', import.meta.url), 'utf8');
const rewards = readFileSync(new URL('../src/components/game/DailyRewardManager.tsx', import.meta.url), 'utf8');

test('Pyramid Cup is served through an authenticated public projection', () => {
  assert.match(cupRoute, /requireServerActor\(token\)/);
  assert.match(cupRoute, /cup_pyramid_v1/);
  assert.match(cupRoute, /participants/);
  assert.match(cupRoute, /rounds/);
  assert.doesNotMatch(cupRoute, /matchSnapshot|players_v14|tactics|privateKey/i);
  assert.match(cupPage, /fetch\('\/api\/league\/cup'/);
  assert.doesNotMatch(cupPage, /doc\(db, ['"]cup_pyramid_v1['"]/);
});

test('league calendar projection is authenticated, scoped to the manager and excludes private snapshots', () => {
  assert.match(matchesRoute, /requireServerActor\(token\)/);
  assert.match(matchesRoute, /LEAGUE_SCOPE_MISMATCH/);
  assert.match(matchesRoute, /matches_v2/);
  assert.doesNotMatch(matchesRoute, /homeTeamSnapshot|awayTeamSnapshot|tactics|roster|privateKey/i);
  assert.match(matchesPage, /fetch\('\/api\/league\/matches'/);
  assert.doesNotMatch(matchesPage, /query\(collection\(db, 'matches_v2'/);
});

test('daily reward dialog waits for confirmed server credit before closing', () => {
  assert.match(rewards, /const claimed = await claimReward\(\)/);
  assert.match(rewards, /if \(claimed\) setShowReward\(false\)/);
  assert.match(rewards, /disabled=\{isClaiming\}/);
});
