import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSeasonOneArchiveEntries,
  validateSeasonOneArchiveSources,
  validateSeasonOneArchiveCompleteness,
} from '../src/app/actions/staging-season-one-reset-archive.ts';

function canonicalSources() {
  const sources = [];
  for (let level = 1; level <= 4; level++) {
    for (let group = 1; group <= 2 ** (level - 1); group++) {
      const tableId = `table_v140_S1_LALPHA_V${level}_G${group}`;
      sources.push({ path: `league_tables_v2/${tableId}`, data: { season: 1, version: 140, leagueId: 'ALPHA' } });
      for (let rank = 1; rank <= 8; rank++) {
        const slotId = `S1_LALPHA_D${level}_G${group}_R${rank}`;
        const clubId = `club-${level}-${group}-${rank}`;
        sources.push({ path: `league_slots_v1/${slotId}`, data: { season: 1, leagueId: 'ALPHA' } });
        sources.push({ path: `players_v14/${clubId}`, data: { id: clubId, credits: 1000, ownedPlayers: [{ id: `player-${rank}` }] } });
        sources.push({
          path: `cup_participant_snapshots_v1/cup_s1_lALPHA/teams/${clubId}`,
          data: { cupId: 'cup_s1_lALPHA', season: 1, teamId: clubId },
        });
      }
    }
  }
  let fixture = 0;
  for (let level = 1; level <= 4; level++) {
    for (let group = 1; group <= 2 ** (level - 1); group++) {
      for (let tour = 1; tour <= 14; tour++) {
        for (let pair = 1; pair <= 4; pair++) {
          fixture++;
          const homeRank = pair;
          const awayRank = 9 - pair;
          const id = `match_v140_S1_LALPHA_V${level}_G${group}_T${tour}_R${homeRank}_vs_R${awayRank}`;
          sources.push({
            path: `matches_v2/${id}`,
            data: { season: 1, version: 140, leagueId: 'ALPHA' },
          });
        }
      }
    }
  }
  sources.push({
    path: 'cup_pyramid_v1/cup_s1_lALPHA',
    data: { id: 'cup_s1_lALPHA', season: 1 },
  });
  for (let i = 1; i <= 56; i++) {
    const id = `cup_S1_R1_M${String(i).padStart(2, '0')}`;
    sources.push({
      path: `cup_matches/${id}`,
      data: { season: 1, cupId: 'cup_s1_lALPHA' },
    });
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
  const profile = built.entries.find(entry => entry.sourcePath === 'players_v14/club-1-1-1');
  assert.deepEqual(profile.data, sources.find(source => source.path === 'players_v14/club-1-1-1').data);
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
    assert.ok(result.reasons.includes('ARCHIVE_SOURCE_PATH_NOT_ALLOWLISTED') || result.reasons.includes('ARCHIVE_SOURCE_IDENTITY_MISMATCH'), path);
  }
});

test('Season 1 backup rejects duplicate paths and malformed document payloads', () => {
  const duplicate = validateSeasonOneArchiveSources([
    { path: 'players_v14/club-1-1-1', data: { id: 'club-1' } },
    { path: 'players_v14/club-1-1-1', data: { id: 'club-1' } },
  ]);
  assert.equal(duplicate.valid, false);
  assert.ok(duplicate.reasons.includes('ARCHIVE_SOURCE_PATH_DUPLICATED'));

  const malformed = validateSeasonOneArchiveSources([
    { path: 'players_v14/club-1-1-1', data: [] },
  ]);
  assert.equal(malformed.valid, false);
  assert.ok(malformed.reasons.includes('ARCHIVE_SOURCE_DOCUMENT_INVALID'));
});

test('Season 1 backup cannot be marked complete when any canonical collection is short', () => {
  let removedMatch = false;
  const sources = canonicalSources().filter(source => {
    if (!removedMatch && source.path.startsWith('matches_v2/')) {
      removedMatch = true;
      return false;
    }
    return true;
  });
  const built = buildSeasonOneArchiveEntries(sources);
  assert.equal(built.ready, true);
  const result = validateSeasonOneArchiveCompleteness(built.entries);
  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes('ARCHIVE_CORE_SOURCE_COUNT_INVALID:matches_v2'));
});
