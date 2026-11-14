import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/autonomous-cycle.ts', import.meta.url), 'utf8');
const start = source.indexOf('export async function resolveDailyMatches()');
const end = source.indexOf('\\nexport async function ', start + 1);
const resolver = source.slice(start, end === -1 ? undefined : end);

test('league settlement claims a per-attempt processing token transactionally', () => {
  assert.match(resolver, /const processingToken = randomUUID\\(\\)/);
  assert.match(resolver, /db\\.runTransaction\\(async \\(tx: any\\) => \\{/);
  assert.match(resolver, /processingToken,\\s*\\}\\);/);
  assert.match(resolver, /current\\.isFinished === true \\|\\| String\\(current\\.status \\|\\| ''\\)\\.toLowerCase\\(\\) === 'finished'/);
  assert.match(resolver, /if \\(current\\.isProcessing === true\\)[\\s\\S]*?if \\(!stale\\) return false/);
});

test('league settlement fences stale workers before applying any result or rewards', () => {
  assert.match(resolver, /m\\.processingToken !== processingToken \\|\\| m\\.isProcessing !== true/);
  assert.match(resolver, /throw new Error\\('MATCH_PROCESSING_LOCK_LOST'\\)/);
  assert.match(resolver, /tx\\.update\\(matchDoc\\.ref, \\{[\\s\\S]*?status: 'finished',[\\s\\S]*?isFinished: true,[\\s\\S]*?processingToken: FieldValue\\.delete\\(\\)/);
  assert.match(resolver, /if \\(latest\\.isFinished === true \\|\\| latest\\.processingToken !== processingToken\\) return/);
});

test('match result, player progression and home revenue share one Firestore transaction', () => {
  assert.match(resolver, /const settled = await db\\.runTransaction\\(async \\(tx: any\\) => \\{/);
  assert.match(resolver, /match_player_effects_v1/);
  assert.match(resolver, /economy_transactions.*match_/);
  assert.match(resolver, /balanceBefore: before,[\\s\\S]*?balanceAfter: after/);
  assert.match(resolver, /tx\\.set\\(homeEffectRef![\\s\\S]*?tx\\.set\\(awayEffectRef!/);
  assert.match(resolver, /tx\\.set\\(economyTxRef![\\s\\S]*?tx\\.update\\(matchDoc\\.ref, \\{/);
});

test('league worker scans the complete active-season fixture set and rebuilds standings after settlement', () => {
  assert.match(resolver, /\\.where\\('season', '==', currentSeason\\)[\\s\\S]*?\\.where\\('version', '==', 140\\)[\\s\\S]*?\\.get\\(\\)/);
  assert.match(resolver, /const standingsBeforeResolve = await rebuildLeagueTablesFromFinishedMatches\\(db, currentSeason\\)/);
  assert.match(resolver, /const standingsSync = await rebuildLeagueTablesFromFinishedMatches\\(db, currentSeason\\)/);
});
