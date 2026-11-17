import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/cup-engine.ts', import.meta.url), 'utf8');

test('cup fixture creation and round advancement share one fenced transaction', () => {
  const start = source.indexOf('async function commitCupRoundTransition');
  const end = source.indexOf('async function commitCupRoundState', start);
  assert.ok(start >= 0 && end > start);
  const transition = source.slice(start, end);
  assert.match(transition, /db\.runTransaction\(async \(tx: any\) =>/);
  assert.match(transition, /Number\(current\.currentRound \|\| 1\) !== expectedRound/);
  assert.match(transition, /tx\.get\(entry\.dedicatedRef\)/);
  assert.match(transition, /tx\.get\(entry\.legacyRef\)/);
  assert.match(transition, /tx\.create\(entry\.dedicatedRef/);
  assert.match(transition, /rounds\[roundKey\(nextRound\)\] = nextPairings/);
  assert.match(transition, /currentRound: nextRound/);
  assert.ok(transition.indexOf('Promise.all(entries.map') < transition.indexOf('entries.forEach'));
  assert.doesNotMatch(transition, /batch\.set\(/);
});

test('cup round state commits only when the persisted round still matches the worker snapshot', () => {
  const start = source.indexOf('async function commitCupRoundState');
  const end = source.indexOf('export async function generatePyramidCup', start);
  assert.ok(start >= 0 && end > start);
  const commit = source.slice(start, end);
  assert.match(commit, /db\.runTransaction\(async \(tx: any\) =>/);
  assert.match(commit, /Number\(current\.currentRound \|\| 1\) !== expectedRound/);
  assert.match(commit, /return false/);
  assert.match(commit, /rounds\[roundKey\(expectedRound\)\] = pairings/);
  assert.match(commit, /if \(options\.nextRound\) patch\.currentRound = options\.nextRound/);
});

test('cup waiting, advancing and final branches use the fenced state commit', () => {
  const start = source.indexOf('export async function runPyramidCupCycle');
  const cycle = source.slice(start);
  assert.match(cycle, /commitCupRoundState\(db, cup\.ref, round, pairings\)/);
  assert.match(cycle, /commitCupRoundTransition\([\s\S]*?round, pairings, nextRound, nextPairs/);
  assert.match(cycle, /completion: \{/);
  assert.doesNotMatch(cycle, /createRoundMatches\(/);
  assert.doesNotMatch(cycle, /cup\.ref\.update\(\{ rounds/);
});
