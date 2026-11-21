import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/cup-engine.ts', import.meta.url), 'utf8');

test('Pyramid Cup refuses a league table with a missing participant rank', () => {
  const start = source.indexOf('async function loadAllLeagueTeams');
  const end = source.indexOf('function publicTeam', start);
  assert.ok(start >= 0 && end > start);
  const loader = source.slice(start, end);
  assert.match(loader, /CUP_LEAGUE_STANDING_MISSING/);
  assert.match(loader, /if \(!entry\)/);
  assert.match(loader, /teams\.push\(normalizeTeam/);
});

test('Pyramid Cup refuses duplicate standings ranks instead of silently selecting one club', () => {
  const start = source.indexOf('async function loadAllLeagueTeams');
  const end = source.indexOf('function publicTeam', start);
  const loader = source.slice(start, end);
  assert.match(loader, /byRank\.has\(rank\)/);
  assert.match(loader, /CUP_DUPLICATE_LEAGUE_STANDING/);
});

test('Pyramid Cup verifies that standings row identity matches its document key', () => {
  const start = source.indexOf('async function loadAllLeagueTeams');
  const end = source.indexOf('function publicTeam', start);
  const loader = source.slice(start, end);
  assert.match(loader, /String\(value\?\.id \|\| key\)/);
  assert.match(loader, /rowId !== key/);
  assert.match(loader, /CUP_LEAGUE_STANDING_IDENTITY_INVALID/);
});

test('Pyramid Cup never fabricates a bot participant for an absent standings row', () => {
  const start = source.indexOf('async function loadAllLeagueTeams');
  const end = source.indexOf('function publicTeam', start);
  const loader = source.slice(start, end);
  assert.doesNotMatch(loader, /normalizeTeam\(byRank\.get\(rank\)/);
  assert.match(loader, /CUP_LEAGUE_STANDING_MISSING/);
});
