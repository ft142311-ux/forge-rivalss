import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/cup-engine.ts', import.meta.url), 'utf8');

test('Pyramid Cup validates canonical opening membership and every prior winner before fixture repair', () => {
  const start = source.indexOf('export async function runPyramidCupCycle');
  const openingGuard = source.indexOf('isCanonicalPyramidCupOpeningField(', start);
  const progressionGuard = source.indexOf('isPyramidCupRoundProgressionValid(', start);
  const failure = source.indexOf('CUP_BRACKET_INTEGRITY_FAILED', start);
  const repair = source.indexOf('repairCurrentRoundFixtures(db, cup, activeSeasonStart)', start);
  assert.ok(start >= 0);
  assert.ok(openingGuard > start);
  assert.ok(progressionGuard > openingGuard);
  assert.ok(failure > progressionGuard);
  assert.ok(repair > failure);
});

test('Pyramid Cup fixture IDs use contiguous canonical 1-based indexes in every round', () => {
  const start = source.indexOf('function assertValidCupRoundPairings');
  const end = source.indexOf('export async function runPyramidCupCycle', start);
  assert.ok(start >= 0 && end > start);
  const validator = source.slice(start, end);
  assert.match(validator, /index > expectedCount/);
  assert.match(validator, /pairing\.id !== `r\$\{round\}_m\$\{index\}`/);
});

test('Cup prize settlement replays the exact credited amount from a matching ledger receipt', () => {
  const start = source.indexOf('async function payCupPrize');
  const end = source.indexOf('async function finishTechnically', start);
  assert.ok(start >= 0 && end > start);
  const settlement = source.slice(start, end);
  assert.match(settlement, /resolveCupPrizeReplayAmount\(receipt/);
  assert.match(settlement, /if \(replayAmount === null\) throw new Error\('CUP_PRIZE_RECEIPT_CONFLICT'\)/);
  assert.match(settlement, /return replayAmount/);
});
