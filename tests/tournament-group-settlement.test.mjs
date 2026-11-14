import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/tournament-system.ts', import.meta.url), 'utf8');

test('group stage accepts completed BO2 draws while knockout stages require a winner', () => {
  const start = source.indexOf('async function stageMatchesDone');
  const end = source.indexOf('function expectedStageMatchCount', start);
  assert.ok(start >= 0 && end > start);
  const stageCheck = source.slice(start, end);
  assert.match(stageCheck, /match\.status !== 'finished' \|\| !match\.homeId \|\| !match\.awayId/);
  assert.match(stageCheck, /stage !== 'groups' && !match\.winnerId/);
  assert.match(stageCheck, /match\.winnerId && !\[match\.homeId, match\.awayId\]\.includes\(match\.winnerId\)/);
});

test('group match settlement validates standings rows before atomically publishing result and report', () => {
  const start = source.indexOf('async function resolveTournamentMatch');
  const end = source.indexOf('async function stageMatchesDone', start);
  assert.ok(start >= 0 && end > start);
  const resolver = source.slice(start, end);
  const guard = resolver.indexOf('TOURNAMENT_GROUP_STANDINGS_INTEGRITY_FAILED');
  const matchWrite = resolver.indexOf("t.update(matchRef, {");
  const reportWrite = resolver.indexOf("t.set(db.collection(MATCH_COLLECTIONS.tournament)");
  const standingsWrite = resolver.indexOf("t.update(groupRef, { teams: groupRows");
  assert.ok(guard >= 0 && matchWrite > guard && reportWrite > guard && standingsWrite > reportWrite);
  assert.match(resolver, /const homeRow = groupRows\.find/);
  assert.match(resolver, /const awayRow = groupRows\.find/);
});
