import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/tournaments/cup/page.tsx', import.meta.url), 'utf8');

test('Pyramid Cup UI exposes all frozen participants with their official seed and league slot', () => {
  assert.match(source, /cupData\.participants/);
  assert.match(source, /Number\(a\.seed\) - Number\(b\.seed\)/);
  assert.match(source, /ВСЕ УЧАСТНИКИ/);
  assert.match(source, /team\.seed/);
  assert.match(source, /team\.level/);
  assert.match(source, /team\.group/);
  assert.match(source, /team\.rank/);
});

test('Pyramid Cup UI displays the round kickoff and completion progress', () => {
  assert.match(source, /EXPECTED_MATCHES: Record<number, number> = \{ 1: 60, 2: 30, 3: 15, 4: 7, 5: 4, 6: 2, 7: 1 \}/);
  assert.match(source, /EXPECTED_SLOTS: Record<number, number> = \{ 1: 60, 2: 30, 3: 15, 4: 8, 5: 4, 6: 2, 7: 1 \}/);
  assert.match(source, /const CUP_ROUND_DAYS = \[2, 3, 4, 5, 6, 7, 8\]/);
  assert.match(source, /formatCupKickoff\(cupData\.seasonStart, activeRound, language\)/);
  assert.match(source, /roundFinishedCount\}\/\{roundMatchCount/);
  assert.match(source, /Europe\/Moscow/);
});

test('finished Pyramid Cup fixtures link to the canonical Match Overview report', () => {
  assert.match(source, /m\.status === 'finished' && m\.matchId/);
  assert.match(source, /\/match\?id=\$\{encodeURIComponent\(m\.matchId\)\}/);
  assert.match(source, /ОТЧЁТ БОЯ/);
});

test('Pyramid Cup opens on the currently active round instead of always resetting to the preliminary round', () => {
  assert.match(source, /const currentRound = Number\(cupData\?\.currentRound\)/);
  assert.match(source, /setActiveRound\(currentRound\)/);
  assert.match(source, /\[cupData\?\.id, cupData\?\.currentRound\]/);
});

test('completed Pyramid Cup prominently displays champion and finalist', () => {
  assert.match(source, /cupData\.status === 'completed' && cupData\.winnerId/);
  assert.match(source, /cupData\.winnerName \|\| cupData\.winnerId/);
  assert.match(source, /cupData\.finalistId/);
  assert.match(source, /cupData\.finalistName \|\| cupData\.finalistId/);
  assert.match(source, /ЧЕМПИОН КУБКА ПИРАМИДЫ/);
  assert.match(source, /ФИНАЛИСТ/);
});
