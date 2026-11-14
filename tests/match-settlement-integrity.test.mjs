import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/autonomous-cycle.ts', import.meta.url), 'utf8');
const start = source.indexOf('export async function resolveDailyMatches()');
const end = source.indexOf('export async function ', start + 1);
const resolver = source.slice(start, end === -1 ? undefined : end);

test('league settlement claims a per-attempt processing token transactionally', () => {
  assert.ok(resolver.includes('const processingToken = randomUUID();'));
  assert.ok(resolver.includes('const claimed = await db.runTransaction'));
  assert.ok(resolver.includes('processingToken,'));
  assert.ok(resolver.includes("current.status || '').toLowerCase() === 'finished'"));
  assert.ok(resolver.includes('if (!stale) return false;'));
});

test('league settlement fences stale workers before applying any result or rewards', () => {
  assert.ok(resolver.includes('m.processingToken !== processingToken || m.isProcessing !== true'));
  assert.ok(resolver.includes("throw new Error('MATCH_PROCESSING_LOCK_LOST')"));
  assert.ok(resolver.includes("status: 'finished'"));
  assert.ok(resolver.includes('isFinished: true'));
  assert.ok(resolver.includes('processingToken: FieldValue.delete()'));
  assert.ok(resolver.includes('latest.processingToken !== processingToken'));
});

test('match result, player progression and home revenue share one Firestore transaction', () => {
  assert.ok(resolver.includes('const settled = await db.runTransaction'));
  assert.ok(resolver.includes('match_player_effects_v1'));
  assert.ok(resolver.includes('economy_transactions'));
  assert.ok(resolver.includes('balanceBefore: before'));
  assert.ok(resolver.includes('balanceAfter: after'));
  assert.ok(resolver.includes('tx.set(homeEffectRef!'));
  assert.ok(resolver.includes('tx.set(awayEffectRef!'));
  assert.ok(resolver.includes('tx.set(economyTxRef!'));
  assert.ok(resolver.includes('tx.update(matchDoc.ref, {'));
});

test('league worker scans all active-season fixtures and rebuilds standings before and after settlement', () => {
  assert.ok(resolver.includes(".where('season', '==', currentSeason)"));
  assert.ok(resolver.includes(".where('version', '==', 140)"));
  assert.ok(resolver.includes('const standingsBeforeResolve = await rebuildLeagueTablesFromFinishedMatches(db, currentSeason)'));
  assert.ok(resolver.includes('const standingsSync = await rebuildLeagueTablesFromFinishedMatches(db, currentSeason)'));
});
test('league match claims and settlement are fenced against rollover and active-season changes', () => {
  assert.ok(source.includes("import { isSeasonRolloverLockStale, SEASON_ROLLOVER_LOCK_ID } from './season-rollover-lock'")); 
  assert.ok(resolver.includes('tx.get(configRef)'));
  assert.ok(resolver.includes('tx.get(rolloverLockRef)'));
  assert.ok(resolver.includes("reason: 'SEASON_ROLLOVER_IN_PROGRESS'"));
  assert.ok(resolver.includes("throw new Error('MATCH_ROLLOVER_IN_PROGRESS')"));
  assert.ok(resolver.includes('Number(freshConfig.activeSeasonNumber || 0) !== currentSeason'));
  assert.ok(resolver.includes('Number(settlementConfig.activeSeasonNumber || 0) !== currentSeason'));
  assert.ok(resolver.includes('freshLifecycle.leagueMatchesPaused'));
  assert.ok(resolver.includes('settlementLifecycle.leagueMatchesPaused'));
});
