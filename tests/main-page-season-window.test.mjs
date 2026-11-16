import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8');

test('home card switches to offseason during the persisted gap before the next season', () => {
  assert.match(source, /const offseasonTargetMs = seasonStartMs \+ 14 \* 24 \* 60 \* 60 \* 1000 \+ 13 \* 60 \* 60 \* 1000/);
  assert.match(source, /const offseasonDisplayWindowActive = Number\.isFinite\(nextSeasonStartMs\)\s*&&\s*nowMs >= offseasonTargetMs\s*&& nowMs < nextSeasonStartMs/);
  assert.match(source, /const shouldTreatAsOffseason = offseasonDisplayWindowActive \|\| \(!effectiveSeasonWindowIsActive/);
});

test('offseason display does not move the persisted next-season activation boundary', () => {
  const target = source.slice(source.indexOf('const offseasonDisplayWindowActive'), source.indexOf('const myCurrentSeasonMatches'));
  assert.match(target, /nowMs < nextSeasonStartMs/);
  assert.doesNotMatch(target, /nextSeasonStartMs\s*=|seasonStartMs\s*=/);
});
