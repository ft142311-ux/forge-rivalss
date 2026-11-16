import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/foundation-management.ts', import.meta.url), 'utf8');

test('foundation tournament results require a scheduled fixture in the same active tournament', () => {
  const start = source.indexOf('export async function recordFoundationTournamentResultAction');
  const end = source.indexOf('export async function joinAssociationFoundationAction', start);
  const action = source.slice(start, end);
  assert.match(action, /TOURNAMENT_MATCH_NOT_FOUND/);
  assert.match(action, /data\.status !== 'active'/);
  assert.match(action, /fixture\.tournamentId/);
  assert.match(action, /fixture\.status !== 'scheduled'/);
  assert.match(action, /RESULT_PARTICIPANTS_MISMATCH/);
});

test('only a fixture participant or tournament creator may submit a valid one-time result', () => {
  const start = source.indexOf('export async function recordFoundationTournamentResultAction');
  const end = source.indexOf('export async function joinAssociationFoundationAction', start);
  const action = source.slice(start, end);
  assert.match(action, /uid !== winnerId && uid !== loserId && data\.createdBy !== uid/);
  assert.match(action, /TOURNAMENT_MATCH_ALREADY_RESOLVED/);
  assert.match(action, /return \{ alreadyResolved: true \}/);
  assert.match(action, /t\.update\(matchRef/);
  assert.doesNotMatch(action, /t\.set\(matchRef/);
});
