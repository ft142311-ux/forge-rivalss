import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/tournaments/cup/page.tsx', import.meta.url), 'utf8');

test('Pyramid Cup page subscribes to season config and can display the prepared season before activation', () => {
  assert.match(source, /doc\(db, 'system_v1', 'season_config'\)/);
  assert.match(source, /seasonConfig\?\.preparedWorldReady === true/);
  assert.match(source, /preparedSeasonNumber > Number\(activeSeasonNumber/);
  assert.match(source, /const cupDocId = `cup_s\$\{cupSeasonNumber\}_lALPHA`/);
});

test('Pyramid Cup page waits for prepared season metadata before resolving the cup document', () => {
  assert.match(source, /isCupLoading \|\| isSeasonConfigLoading/);
  assert.match(source, /S\{cupSeasonNumber\}/);
});

test('Pyramid Cup page no longer tells users to wait until after league round one', () => {
  assert.doesNotMatch(source, /after league round one|после первого тура лиги/i);
  assert.match(source, /при подготовке сезона/);
});
