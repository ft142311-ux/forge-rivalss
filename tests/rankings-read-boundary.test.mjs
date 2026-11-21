import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const rankingsSource = readFileSync(new URL('../src/app/rankings/page.tsx', import.meta.url), 'utf8');

test('league standings do not query private player profiles for every group member', () => {
  assert.match(rankingsSource, /doc\(db, ['"]players_v14['"], user\.uid\)/);
  assert.doesNotMatch(
    rankingsSource,
    /query\(collection\(db, ['"]players_v14['"]/,
    'group-wide profile reads violate the players_v14 self-read boundary',
  );
  assert.doesNotMatch(rankingsSource, /groupPlayersQuery|groupPlayers/);
});

test('league standings render logos only from the public standings snapshot', () => {
  assert.match(rankingsSource, /const clubLogo = entry\.clubLogo \|\| null/);
});
