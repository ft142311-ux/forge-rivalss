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

const routeSource = readFileSync(
  new URL('../src/app/api/cron/tournaments/route.ts', import.meta.url),
  'utf8',
);
const cupEngineSource = readFileSync(
  new URL('../src/app/actions/cup-engine.ts', import.meta.url),
  'utf8',
);

test('tournament HTTP cron authenticates before invoking either tournament engine', () => {
  const guard = routeSource.indexOf("if (!cronSecret || !isCronAuthorized(request, cronSecret))");
  const leagueCycle = routeSource.indexOf('runTournamentCycle(cronSecret)');
  const cupCycle = routeSource.indexOf('runPyramidCupCycle()');
  assert.ok(guard >= 0 && leagueCycle > guard && cupCycle > guard);
  assert.match(routeSource, /new NextResponse\('Unauthorized', \{ status: 401 \}\)/);
  assert.match(routeSource, /const cronSecret = process\.env\.CRON_SECRET/);
});

test('Pyramid Cup cycle remains a server-only worker rather than an exposed Server Action module', () => {
  assert.match(cupEngineSource, /^import ['"]server-only['"]/);
  assert.doesNotMatch(cupEngineSource, /^['"]use server['"]/);
});

test('tournament unregistration is closed at the same deadline as registration', () => {
  const unregister = actionBody('unregisterFromTournamentAction');
  assert.ok(unregister.includes('Date.now() >= Number(data.registrationCloseAt)'));
  assert.ok(
    unregister.indexOf('registrationCloseAt') < unregister.indexOf('t.update(ref'),
    'the deadline must be checked before participant state is changed',
  );
});
test('daily tournament generation tolerates only a competing deterministic-ID create', () => {
  const generatorStart = source.indexOf('async function generateDailyTournamentsInternal');
  const generatorEnd = source.indexOf('export async function generateDailyTournaments', generatorStart);
  assert.ok(generatorStart >= 0 && generatorEnd > generatorStart);
  const generator = source.slice(generatorStart, generatorEnd);
  assert.match(generator, /await ref\.create\(data\)/);
  assert.match(generator, /code === 6 \|\| code === 'already-exists' \|\| code === 'ALREADY_EXISTS'/);
  assert.match(generator, /if \(code === 6[^\n]+\) continue;/);
  assert.match(generator, /if \(code === 6[^\n]+\) continue;[\s\S]*?throw error;/);
});
