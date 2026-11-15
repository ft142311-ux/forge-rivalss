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

test('league calendar repair actions require an administrator identity', () => {
  assert.match(source, /import \{ requireAdminActor \} from ['"]@\/lib\/server-auth['"]/);
  assert.doesNotMatch(source, /requireServerActor/);

  for (const name of ['repairCurrentLeagueCalendar', 'repairAllLeagueCalendar']) {
    assert.match(actionBody(name), /await requireAdminActor\(idToken\)/, name);
  }
});
