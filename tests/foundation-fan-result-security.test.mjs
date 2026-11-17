import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/foundation-management.ts', import.meta.url), 'utf8');

test('legacy fan result action cannot accept client-supplied wins or attendance capacity', () => {
  const start = source.indexOf('export async function updateFansAfterOfficialHomeMatchAction');
  const end = source.indexOf('export async function createFoundationTournamentAction', start);
  assert.ok(start >= 0 && end > start);
  const action = source.slice(start, end);
  assert.match(action, /await requireServerActor\(idToken\)/);
  assert.match(action, /OFFICIAL_MATCH_RESULT_REQUIRED/);
  assert.doesNotMatch(action, /getAdminDb\(/);
  assert.doesNotMatch(action, /expectedAttendance|updateFansAfterHomeMatch|\.update\(|\.add\(|\.set\(/);
});
