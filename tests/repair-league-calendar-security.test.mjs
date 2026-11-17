import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../src/app/actions/repair-league-calendar.ts', import.meta.url),
  'utf8',
);

function actionBody(name) {
  const start = source.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `missing exported action: ${name}`);
  const next = source.indexOf('\nexport async function ', start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

test('current-group calendar repair is authenticated and cannot rewrite global season state', () => {
  const action = actionBody('repairCurrentLeagueCalendar');
  assert.match(action, /requireServerActor\(idToken\)/);
  assert.doesNotMatch(action, /requireAdminActor\(idToken\)/);
  assert.doesNotMatch(action, /data:\s*\{\s*activeSeasonNumber:/);
  assert.doesNotMatch(action, /lease\.commit\(\[\{\s*ref:\s*db\.collection\(['"]system_v1['"]\)/);
});

test('all-groups calendar repair is restricted to administrators', () => {
  const action = actionBody('repairAllLeagueCalendar');
  assert.match(action, /requireAdminActor\(idToken\)/);
});
