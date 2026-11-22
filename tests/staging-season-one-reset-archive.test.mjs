import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSeasonOneArchiveEntries,
  validateSeasonOneArchiveSources,
  validateSeasonOneArchiveCompleteness,
} from '../src/app/actions/staging-season-one-reset-archive.ts';

function canonicalSources() {
  const sources = [];
  for (let i = 1; i <= 15; i++) {
    sources.push({ path: `league_tables_v2/table-${i}`, data: { season: 1, version: 140 } });
  }
  for (let i = 1; i <= 120; i++) {
    sources.push({ path: `league_slots_v1/slot-${i}`, data: { season: 1 } });
    sources.push({ path: `players_v14/club-${i}`, data: { id: `club-${i}`, credits: 1000, ownedPlayers: [{ id: `player-${i}` }] } });
    sources.push({ path: `cup_participant_snapshots_v1/cup_s1_lALPHA/teams/club-${i}`, data: { cupId: 'cup_s1_lALPHA', teamId: `club-${i}` } });
  }
  for (let i = 1; i <= 840; i++) {
    sources.push({ path: `matches_v2/match-${i}`, data: { season: 1, version: 140 } });
  }
  sources.push({ path: 'cup_pyramid_v1/cup_s1_lALPHA', data: { season: 1 } });
  for (let i = 1; i <= 56; i++) {
    sources.push({ path: `cup_matches/cup_S1_R1_M${String(i).padStart(2, '0')}`, data: { season: 1, cupId: 'cup_s1_lALPHA' } });
  }
  return sources;
}

test('Season 1 backup allowlist includes canonical documents and complete profile payloads', () => {
  const sources = canonicalSources();
  const built = buildSeasonOneArchiveEntries(sources);
  assert.equal(built.ready, true, built.reasons.join(','));
  assert.equal(built.entries.length, sources.length);
  const completeness = validateSeasonOneArchiveCompleteness(built.entries);
  assert.equal(completeness.valid, true, completeness.reasons.join(','));
  const profile = built.entries.find(entry => entry.sourcePath === 'players_v14/club-1');
  assert.deepEqual(profile.data, sources.find(source => source.path === 'players_v14/club-1').data);
});

test('Season 1 backup rejects account, credential, and unrelated collection paths', () => {
  for (const path of [
    'users/user-1',
    'auth_users/user-1',
    'players_v14/club-1/private_credentials/password',
    'tournaments_v1/tournament-1',
    'matches_v2/match-S2',
    'cup_participant_snapshots_v1/cup_s2_lALPHA/teams/club-1',
  ]) {
    const result = validateSeasonOneArchiveSources([{ path, data: { secret: 'never archive' } }]);
    assert.equal(result.valid, false, path);
    assert.ok(result.reasons.includes('ARCHIVE_SOURCE_PATH_NOT_ALLOWLISTED'), path);
  }
});

test('Season 1 backup rejects duplicate paths and malformed document payloads', () => {
  const duplicate = validateSeasonOneArchiveSources([
    { path: 'players_v14/club-1', data: { id: 'club-1' } },
    { path: 'players_v14/club-1', data: { id: 'club-1' } },
  ]);
  assert.equal(duplicate.valid, false);
  assert.ok(duplicate.reasons.includes('ARCHIVE_SOURCE_PATH_DUPLICATED'));

  const malformed = validateSeasonOneArchiveSources([
    { path: 'players_v14/club-1', data: [] },
  ]);
  assert.equal(malformed.valid, false);
  assert.ok(malformed.reasons.includes('ARCHIVE_SOURCE_DOCUMENT_INVALID'));
});

test('Season 1 backup cannot be marked complete when any canonical collection is short', () => {
  const sources = canonicalSources().filter(source => source.path !== 'matches_v2/match-840');
  const built = buildSeasonOneArchiveEntries(sources);
  assert.equal(built.ready, true);
  const result = validateSeasonOneArchiveCompleteness(built.entries);
  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes('ARCHIVE_CORE_SOURCE_COUNT_INVALID:matches_v2'));
});
