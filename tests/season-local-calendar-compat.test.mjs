import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCanonicalSeasonDateWindow } from '../src/app/actions/season-boundary.ts';

const day = 24 * 60 * 60 * 1000;
const canonicalStart = new Date('2026-09-21T15:00:00.000Z');
const canonicalNext = new Date('2026-10-08T15:00:00.000Z');
const localStart = new Date('2026-11-09T15:00:00.000Z');
const localNext = new Date(localStart.getTime() + 17 * day);

test('clean local Season 1 accepts its generated 17-day schedule', () => {
  const result = resolveCanonicalSeasonDateWindow({
    worldGeneration: 'CLEAN_S1_V1', activeSeasonNumber: 1,
    persistedSeasonStart: localStart, persistedNextSeasonStart: localNext,
    canonicalSeasonStart: canonicalStart, canonicalNextSeasonStart: canonicalNext,
  });
  assert.equal(result.source, 'CLEAN_S1_V1');
  assert.equal(result.seasonStart.toISOString(), '2026-11-09T15:00:00.000Z');
  assert.equal(result.nextSeasonStart.toISOString(), '2026-11-26T15:00:00.000Z');
});

test('ordinary worlds do not inherit clean-local dynamic dates', () => {
  const result = resolveCanonicalSeasonDateWindow({
    worldGeneration: 'PRODUCTION', activeSeasonNumber: 1,
    persistedSeasonStart: localStart, persistedNextSeasonStart: localNext,
    canonicalSeasonStart: canonicalStart, canonicalNextSeasonStart: canonicalNext,
  });
  assert.equal(result.source, 'CANONICAL');
  assert.equal(result.seasonStart.toISOString(), canonicalStart.toISOString());
});

test('clean-local marker cannot authorize an arbitrary or malformed schedule', () => {
  const result = resolveCanonicalSeasonDateWindow({
    worldGeneration: 'CLEAN_S1_V1', activeSeasonNumber: 1,
    persistedSeasonStart: localStart, persistedNextSeasonStart: new Date(localStart.getTime() + 16 * day),
    canonicalSeasonStart: canonicalStart, canonicalNextSeasonStart: canonicalNext,
  });
  assert.equal(result.source, 'CANONICAL');
});

test('clean-local marker applies only to active Season 1', () => {
  const result = resolveCanonicalSeasonDateWindow({
    worldGeneration: 'CLEAN_S1_V1', activeSeasonNumber: 2,
    persistedSeasonStart: localStart, persistedNextSeasonStart: localNext,
    canonicalSeasonStart: canonicalStart, canonicalNextSeasonStart: canonicalNext,
  });
  assert.equal(result.source, 'CANONICAL');
});
