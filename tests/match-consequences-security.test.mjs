import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/gameplay.ts', import.meta.url), 'utf8');

test('match consequences require a real finished match and an authenticated participant', () => {
  const start = source.indexOf('export async function applyMatchConsequencesAction');
  const action = source.slice(start);
  assert.match(action, /MATCH_REPORT_COLLECTIONS/);
  assert.match(action, /MATCH_NOT_FOUND/);
  assert.match(action, /MATCH_NOT_FINISHED/);
  assert.match(action, /MATCH_ACCESS_DENIED/);
  assert.match(action, /storedMatchType !== safeMatchType/);
  assert.match(action, /db\.runTransaction\(async t =>/);
});

test('match consequences only apply to players present in the persisted simulation lineup', () => {
  const start = source.indexOf('export async function applyMatchConsequencesAction');
  const action = source.slice(start);
  assert.match(action, /simulation\.homeRoles : simulation\.awayRoles/);
  assert.match(action, /actualPlayerIds/);
  assert.match(action, /requestedIds\.some\(id => !actualPlayerIds\.includes\(id\)\)/);
  assert.match(action, /MATCH_PLAYER_NOT_USED/);
  assert.match(action, /MATCH_PLAYER_NOT_OWNED/);
});

test('training minutes are derived from persisted game durations rather than caller input', () => {
  const start = source.indexOf('export async function applyMatchConsequencesAction');
  const action = source.slice(start);
  assert.match(action, /_minutesPlayed: number/);
  assert.match(action, /game\?\.duration/);
  assert.match(action, /const verifiedMinutesPlayed = Math\.min\(120, Math\.round\(minutesPlayed\)\)/);
  assert.match(action, /verifiedMinutesPlayed \/ 90/);
  assert.doesNotMatch(action, /Math\.max\(0, Math\.min\(1\.25, Number\(minutesPlayed\) \/ 90\)\)/);
});

test('match consequences are applied at most once per user and match', () => {
  const start = source.indexOf('export async function applyMatchConsequencesAction');
  const action = source.slice(start);
  assert.match(action, /match_consequence_receipts/);
  assert.match(action, /const \[matchSnap, profileSnap, receiptSnap\] = await Promise\.all/);
  assert.match(action, /if \(receiptSnap\.exists\) return \{ duplicate: true \}/);
  assert.match(action, /t\.create\(receiptRef/);
  assert.match(action, /duplicate: transactionResult\.duplicate/);
});
