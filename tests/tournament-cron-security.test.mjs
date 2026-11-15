import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../src/app/actions/tournament-system.ts', import.meta.url),
  'utf8',
);

function actionBody(name) {
  const start = source.indexOf(`export async function ${name}`);
  assert.ok(start >= 0, `missing exported action: ${name}`);
  const next = source.indexOf('\nexport async function ', start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

test('tournament cron entry points share constant-time cron secret validation', () => {
  assert.match(source, /import \{ assertCronSecret \} from ['"]@\/lib\/server-cron-auth['"]/);
  for (const name of ['generateDailyTournaments', 'runTournamentCycle']) {
    const action = actionBody(name);
    assert.match(action, /assertCronSecret\(cronToken\)/, name);
    assert.match(action, /catch\s*\{\s*return \{ success: false, error: 'UNAUTHORIZED' \};\s*\}/, name);
    assert.doesNotMatch(action, /cronToken\s*!==?\s*cronSecret|process\.env\.CRON_SECRET/);
  }
});
