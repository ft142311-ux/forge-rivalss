import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../src/app/actions/repair-registered-club-state.ts', import.meta.url),
  'utf8',
);

test('club repair implementation is not exposed as a callable Server Action', () => {
  assert.match(source, /^async function repairRegisteredClubState\(userId: string\)/m);
  assert.doesNotMatch(source, /export async function repairRegisteredClubState\(/);
});

test('public club repair action derives its target UID from the verified actor', () => {
  const start = source.indexOf('export async function repairRegisteredClubStateAction');
  assert.ok(start >= 0);
  const action = source.slice(start);
  assert.match(action, /const actor = await requireServerActor\(idToken\)/);
  assert.match(action, /return repairRegisteredClubState\(actor\.uid\)/);
  assert.doesNotMatch(action, /repairRegisteredClubState\(userId\)/);
});
