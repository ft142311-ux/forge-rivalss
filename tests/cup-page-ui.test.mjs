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
  assert.match(source, /const CUP_ROUND_DAYS = \[2, 3, 4, 5, 6, 7, 8\]/);
  assert.match(source, /formatCupKickoff\(cupData\.seasonStart, activeRound, language\)/);
  assert.match(source, /roundFinishedCount\/roundMatchCount/);
  assert.match(source, /Europe\/Moscow/);
});

test('finished Pyramid Cup fixtures link to the canonical Match Overview report', () => {
  assert.match(source, /m\.status === 'finished' && m\.matchId/);
  assert.match(source, /\/match\?id=\$\{encodeURIComponent\(m\.matchId\)\}/);
  assert.match(source, /ОТЧЁТ БОЯ/);
});
