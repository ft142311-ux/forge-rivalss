import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/foundation-advanced.ts', import.meta.url), 'utf8');

test('foundation fan actions read fresh manager state in the same transaction as the action receipt', () => {
  const start = source.indexOf('export async function foundationFanAction');
  const end = source.indexOf('export async function castGoldenPlayerVoteAction', start);
  const action = source.slice(start, end);
  assert.match(action, /INVALID_FAN_ACTION/);
  assert.match(action, /db\.runTransaction\(async t =>/);
  assert.match(action, /const \[freshAction, managerSnap\] = await Promise\.all/);
  assert.match(action, /t\.get\(ref\)/);
  assert.match(action, /t\.update\(ref, \{ fans:/);
  assert.match(action, /t\.create\(actionRef/);
  assert.doesNotMatch(action, /const snap = await ref\.get\(\)/);
});
