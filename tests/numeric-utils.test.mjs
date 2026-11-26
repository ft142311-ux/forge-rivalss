import test from 'node:test';
import assert from 'node:assert/strict';
import { clampNumber } from '../src/app/lib/numeric-utils.ts';

test('clampNumber keeps values inside the inclusive range', () => {
  assert.equal(clampNumber(5, 0, 10), 5);
  assert.equal(clampNumber(0, 0, 10), 0);
  assert.equal(clampNumber(10, 0, 10), 10);
});

test('clampNumber limits values below and above the range', () => {
  assert.equal(clampNumber(-5, 0, 10), 0);
  assert.equal(clampNumber(15, 0, 10), 10);
});

test('clampNumber preserves the previous Math min/max behavior for edge values', () => {
  assert.equal(clampNumber(Number.NaN, 0, 10), Number.NaN);
  assert.equal(clampNumber(5, 10, 0), 10);
});
