import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getCompletedSeriesScore,
  normalizeMatchTimeline,
  parseMatchSeriesScore,
  resolveMatchSimulation,
} from '../src/app/lib/match-report-utils.ts';

test('resolveMatchSimulation preserves stored simulation and legacy fallback shape', () => {
  const simulation = { games: [{ homeScore: 1 }], seriesScore: '1-0' };
  assert.equal(resolveMatchSimulation({ simulation }), simulation);
  assert.deepEqual(resolveMatchSimulation({ scoreA: 2, scoreB: 1, winner: 'Home' }), {
    games: [{ scoreA: 2, scoreB: 1, winner: 'Home' }],
    seriesScore: '2-1',
    winner: 'Home',
    isTbdWin: undefined,
  });
  assert.equal(resolveMatchSimulation(null), null);
});

test('parseMatchSeriesScore supports object, string and legacy score fields', () => {
  assert.deepEqual(parseMatchSeriesScore({ homeScore: 2, awayScore: 1 }, {}), { home: 2, away: 1 });
  assert.deepEqual(parseMatchSeriesScore('2–1', {}), { home: 2, away: 1 });
  assert.deepEqual(parseMatchSeriesScore(undefined, { scoreA: 1, awayScore: 2 }), { home: 1, away: 2 });
});

test('normalizeMatchTimeline preserves source fields and normalizes legacy event shapes', () => {
  assert.deepEqual(normalizeMatchTimeline({ timeline: [
    { time: '03:00', description: 'First blood', score: '1:0', extra: true },
    'Tower destroyed',
    null,
    { minute: '10:00', message: 'Dragon secured' },
    { text: '' },
  ] }), [
    { time: '03:00', description: 'First blood', score: '1:0', extra: true, minute: '03:00', text: 'First blood' },
    { text: 'Tower destroyed', minute: '2:00' },
    { minute: '10:00', message: 'Dragon secured', text: 'Dragon secured' },
  ]);
});

test('getCompletedSeriesScore sums only completed maps and safely handles missing data', () => {
  const games = [{ homeScore: 1, awayScore: 0 }, { homeScore: 0, awayScore: 1 }, { homeScore: 1, awayScore: 0 }];
  assert.deepEqual(getCompletedSeriesScore(games, 2), { home: 1, away: 1 });
  assert.deepEqual(getCompletedSeriesScore(games, 3), { home: 2, away: 1 });
  assert.deepEqual(getCompletedSeriesScore(null, 2), { home: 0, away: 0 });
});
