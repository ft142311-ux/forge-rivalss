import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aggregatePlayerCombatStats } from '../src/app/lib/player-combat-stats.ts';

test('combat stats aggregate every supplied map row for match settlement', () => {
  assert.deepEqual(
    aggregatePlayerCombatStats([
      { kills: 4, deaths: 2, assists: 7 },
      { kills: 3, deaths: 1, assists: 5 },
    ], { coerceValues: true }),
    { kills: 7, deaths: 3, assists: 12 },
  );
});

test('combat stats preserve the roster history legacy addition semantics', () => {
  assert.deepEqual(
    aggregatePlayerCombatStats([{ kills: '2', deaths: 1, assists: 3 }], {
      initial: { kills: 4, deaths: 2, assists: 1 },
    }),
    { kills: '42', deaths: 3, assists: 4 },
  );
});

test('combat stats safely handle empty and missing scoreboard values', () => {
  assert.deepEqual(aggregatePlayerCombatStats([]), { kills: 0, deaths: 0, assists: 0 });
  assert.deepEqual(
    aggregatePlayerCombatStats([{ kills: null }, {}], { coerceValues: true }),
    { kills: 0, deaths: 0, assists: 0 },
  );
});

test('settlement and roster history share arithmetic without merging row selection rules', () => {
  const settlement = readFileSync(new URL('../src/app/actions/autonomous-cycle.ts', import.meta.url), 'utf8');
  const roster = readFileSync(new URL('../src/app/roster/stats/page.tsx', import.meta.url), 'utf8');

  assert.match(settlement, /boards\.filter\(\(row:any\)/);
  assert.match(settlement, /aggregatePlayerCombatStats\(perf, \{ coerceValues: true \}\)/);
  assert.match(roster, /simulation\?\.games\?\.\[0\]\?\.scoreboard\?\.find/);
  assert.match(roster, /aggregatePlayerCombatStats\(\[performance\]/);
});
