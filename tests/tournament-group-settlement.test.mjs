import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/tournament-system.ts', import.meta.url), 'utf8');

test('tournament stage readiness requires the canonical fixture matrix and completed outcomes', () => {
  const start = source.indexOf('async function stageMatchesDone');
  const end = source.indexOf('function expectedStageMatchCount', start);
  assert.ok(start >= 0 && end > start);
  const stageCheck = source.slice(start, end);
  assert.ok(stageCheck.includes('snap.docs.length !== expectedCount'));
  assert.ok(stageCheck.includes('isTournamentStageMatchSetComplete('));
  assert.ok(stageCheck.includes('maxParticipants'));

  const helper = readFileSync(new URL('../src/app/lib/tournament-stage-utils.ts', import.meta.url), 'utf8');
  assert.ok(helper.includes('isTournamentStageMatchComplete(match, stage)'));
  assert.ok(helper.includes("if (stage !== 'groups' && !match.winnerId) return false"));
  assert.ok(helper.includes('expected.delete(key)'));
});

test('group match settlement validates standings rows before atomically publishing result and report', () => {
  const start = source.indexOf('async function resolveTournamentMatch');
  const end = source.indexOf('async function stageMatchesDone', start);
  assert.ok(start >= 0 && end > start);
  const resolver = source.slice(start, end);
  const finalizeStart = resolver.indexOf('const finalized = await db.runTransaction');
  const guard = resolver.indexOf('TOURNAMENT_GROUP_STANDINGS_INTEGRITY_FAILED', finalizeStart);
  const matchWrite = resolver.indexOf("t.update(matchRef, {", finalizeStart);
  const reportWrite = resolver.indexOf("t.set(db.collection(MATCH_COLLECTIONS.tournament)", finalizeStart);
  const standingsWrite = resolver.indexOf("t.update(groupRef, { teams: groupRows", finalizeStart);
  assert.ok(finalizeStart >= 0 && guard > finalizeStart && matchWrite > guard && reportWrite > guard && standingsWrite > reportWrite);
  assert.match(resolver, /const homeRow = groupRows\.find/);
  assert.match(resolver, /const awayRow = groupRows\.find/);
});
