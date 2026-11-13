import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateGroupStandings } from '../src/app/actions/season-rollover-standings.ts';
import { expectedRolloverGroups } from '../src/app/actions/season-rollover-plan.ts';
import { getCompletedSeasonArchives, getVisibleSeasonArchives, isCompletedSeasonArchive, isRecoveredSeasonArchive, isSeasonArchiveReadyToComplete, validateSeasonArchiveSnapshot } from '../src/app/actions/season-archive.ts';

function makeSeasonArchive(sourceSeason = 1) {
  const groups = expectedRolloverGroups();
  const matches = [];
  const standings = {};
  const planGroups = {};
  for (const groupKey of groups) {
    const [, level, group] = /^D([1-4])-G(\d+)$/.exec(groupKey);
    const participantByRank = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [index + 1, `${groupKey}-TEAM-${index + 1}`]));
    const fixtures = [];
    for (let homeRank = 1; homeRank <= 8; homeRank++) {
      for (let awayRank = 1; awayRank <= 8; awayRank++) {
        if (homeRank === awayRank) continue;
        const draw = (homeRank + awayRank) % 5 === 0;
        const homeScore = draw ? 1 : homeRank < awayRank ? 2 : 0;
        const awayScore = draw ? 1 : homeRank < awayRank ? 0 : 2;
        const fixture = {
          matchId: `${groupKey}-T${Math.ceil(fixtures.length / 4) + 1}-${homeRank}-${awayRank}`,
          version: 140, sourceSeason, level: Number(level), group: Number(group),
          tour: Math.ceil(fixtures.length / 4) + 1,
          homeRank, awayRank,
          homeId: participantByRank[homeRank], homeName: participantByRank[homeRank],
          awayId: participantByRank[awayRank], awayName: participantByRank[awayRank],
          score: { home: homeScore, away: awayScore }, status: 'finished', isFinished: true,
        };
        fixtures.push(fixture);
        matches.push(fixture);
      }
    }
    standings[groupKey] = calculateGroupStandings({}, fixtures).map((row, index) => ({ ...row, rank: index + 1 }));
    planGroups[groupKey] = standings[groupKey].map(row => ({ id: row.id, rank: row.rank }));
  }
  const archive = {
    sourceSeason, leagueId: 'ALPHA', archiveVersion: 1, status: 'preparing',
    expectedMatches: 840, finishedMatches: 840, groups: 15, teamCount: 120,
    finalizedAt: new Date().toISOString(),
    integrity: { complete: true, unfinishedMatches: 0, invalidResults: 0, canonicalMatches: 840, duplicateCanonicalFixtures: 0 },
    standings,
  };
  const plan = { sourceSeason, targetSeason: sourceSeason + 1, ready: true, awards: { ready: true }, groups: planGroups };
  return { archive, matches, plan };
}

test('archive cannot become completed before all saved matches, standings, and rollover plan validate', () => {
  const { archive, matches, plan } = makeSeasonArchive();
  assert.equal(validateSeasonArchiveSnapshot(archive, matches).valid, true);
  assert.equal(isSeasonArchiveReadyToComplete(archive, matches.slice(0, -1), plan), false);
  assert.equal(isSeasonArchiveReadyToComplete(archive, matches, { ...plan, ready: false }), false);
  assert.equal(isSeasonArchiveReadyToComplete(archive, matches, plan), true);
});

test('late engine-reconstructed archive remains visibly completed only with full validated results', () => {
  const { archive, matches, plan } = makeSeasonArchive(2);
  archive.status = 'completed';
  archive.completedAt = new Date().toISOString();
  archive.completionMode = 'late_engine_reconstruction';
  archive.reconstruction = { method: 'shared-match-engine', simulatedMatches: 840, historicalRosterSnapshotAvailable: false };
  archive.integrity.recovery = true;
  assert.equal(isSeasonArchiveReadyToComplete(archive, matches, plan), true);
  assert.equal(isCompletedSeasonArchive(archive), true);
  assert.equal(isSeasonArchiveReadyToComplete(archive, matches.slice(1), plan), false);
});

test('archive standings are checked against all 840 persisted match results', () => {
  const { archive, matches } = makeSeasonArchive();
  const altered = structuredClone(matches);
  altered[0].score = { home: 0, away: 2 };
  assert.equal(validateSeasonArchiveSnapshot(archive, altered).valid, false);
  assert.equal(validateSeasonArchiveSnapshot(archive, matches.slice(1)).valid, false);
});

test('archive list hides preparing, incomplete, and malformed future seasons and deduplicates season IDs', () => {
  const first = makeSeasonArchive(1).archive;
  first.status = 'completed'; first.completedAt = new Date().toISOString();
  const duplicate = { ...first, marker: 'duplicate' };
  const pending = { ...makeSeasonArchive(2).archive, sourceSeason: 2 };
  const incomplete = { ...makeSeasonArchive(3).archive, sourceSeason: 3, status: 'completed', completedAt: new Date().toISOString(), finishedMatches: 839 };
  const listed = getCompletedSeasonArchives([first, duplicate, pending, incomplete]);
  assert.deepEqual(listed.map(item => item.sourceSeason), [1]);
  assert.notEqual(listed[0].marker, 'duplicate');
});

test('recovered archive is visible but never treated as a completed season or final standings', () => {
  const startingParticipants = Object.fromEntries(expectedRolloverGroups().map(group => [group,
    Array.from({ length: 8 }, (_, i) => ({ id: `${group}-S2-${i + 1}`, rank: i + 1, name: `${group} team ${i + 1}` }))]));
  const recovered = {
    sourceSeason: 2, leagueId: 'ALPHA', archiveVersion: 1, status: 'recovered', recoveredAt: '2026-10-27T00:00:00.000Z',
    expectedMatches: 840, finishedMatches: 0, unresolvedMatches: 840, groups: 15, teamCount: 120,
    standings: {}, startingParticipants,
    recovery: { status: 'incomplete', finalStandingsAvailable: false, reason: 'SEASON_INCOMPLETE' },
  };
  assert.equal(isRecoveredSeasonArchive(recovered), true);
  assert.equal(getCompletedSeasonArchives([recovered]).length, 0);
  assert.deepEqual(getVisibleSeasonArchives([recovered]).map(item => item.sourceSeason), [2]);
  assert.equal(isRecoveredSeasonArchive({ ...recovered, standings: { 'D1-G1': [] } }), false);
  assert.equal(getVisibleSeasonArchives([{ ...recovered, finishedMatches: 1 }]).length, 0);
  assert.equal(getVisibleSeasonArchives([{ ...recovered, startingParticipants: {} }]).length, 0);
});

test('recovered archive rejects invalid counters, timestamps, metadata, extra groups, and duplicate ranks', () => {
  const startingParticipants = Object.fromEntries(expectedRolloverGroups().map(group => [group,
    Array.from({ length: 8 }, (_, i) => ({ id: `${group}-TEAM-${i + 1}`, rank: i + 1 }))]));
  const base = {
    sourceSeason: 2, leagueId: 'ALPHA', archiveVersion: 1, status: 'recovered',
    recoveredAt: '2026-10-27T00:00:00.000Z', expectedMatches: 840,
    finishedMatches: 137, unresolvedMatches: 703, groups: 15, teamCount: 120,
    standings: {}, startingParticipants,
    recovery: { status: 'incomplete', finalStandingsAvailable: false, reason: 'SEASON_INCOMPLETE' },
  };
  assert.equal(isRecoveredSeasonArchive(base), true);
  const invalid = [
    { ...base, finishedMatches: -1, unresolvedMatches: 841 },
    { ...base, finishedMatches: 1.5, unresolvedMatches: 838.5 },
    { ...base, unresolvedMatches: 702 },
    { ...base, recoveredAt: 'not-a-date' },
    { ...base, groups: 14 },
    { ...base, teamCount: 119 },
    { ...base, recovery: { ...base.recovery, reason: '' } },
    { ...base, startingParticipants: { ...base.startingParticipants, 'D5-G1': [] } },
    { ...base, startingParticipants: { ...base.startingParticipants, 'D1-G1': base.startingParticipants['D1-G1'].map((row, i) => ({ ...row, rank: i === 1 ? 1 : row.rank })) } },
  ];
  for (const candidate of invalid) assert.equal(isRecoveredSeasonArchive(candidate), false);
});



test('archive pruning retains the newest completed archive and only prunes fully verified older archives', async () => {
  const { resolveArchivePrunePlan } = await import('../src/app/actions/season-archive.ts');
  const first = makeSeasonArchive(1);
  first.archive.status = 'completed';
  first.archive.completedAt = '2026-10-08T15:00:00.000Z';
  const second = makeSeasonArchive(2);
  second.archive.status = 'completed';
  second.archive.completedAt = '2026-10-23T15:00:00.000Z';
  const result = resolveArchivePrunePlan([
    { id: 'S1', archive: first.archive, matches: first.matches },
    { id: 'S2', archive: second.archive, matches: second.matches },
  ], 4, 2);
  assert.equal(result.ready, true);
  assert.deepEqual(result.pruneIds, ['S1']);
  assert.equal(result.retainedArchiveSeason, 2);
});

test('archive pruning fails closed for malformed, partial, and unmarked recovered archives', async () => {
  const { resolveArchivePrunePlan } = await import('../src/app/actions/season-archive.ts');
  assert.equal(resolveArchivePrunePlan([
    { id: 'legacy', archive: {}, matches: [] },
  ], 3, null).reason, 'ARCHIVE_PRUNE_IDENTITY_CONFLICT');

  const incomplete = makeSeasonArchive(1);
  incomplete.archive.status = 'completed';
  incomplete.archive.completedAt = 'x';
  assert.equal(resolveArchivePrunePlan([
    { id: 'S1', archive: incomplete.archive, matches: incomplete.matches.slice(0, 10) },
  ], 3, null).reason, 'OBSOLETE_COMPLETED_ARCHIVE_INVALID');

  const startingParticipants = Object.fromEntries(expectedRolloverGroups().map(group => [group,
    Array.from({ length: 8 }, (_, i) => ({ id: `${group}-S2-${i + 1}`, rank: i + 1 }))]));
  const recovered = {
    sourceSeason: 2, leagueId: 'ALPHA', archiveVersion: 1, status: 'recovered',
    recoveredAt: '2026-10-27T00:00:00.000Z', expectedMatches: 840, finishedMatches: 0,
    unresolvedMatches: 840, standings: {}, startingParticipants,
    recovery: { status: 'incomplete', finalStandingsAvailable: false, reason: 'SEASON_INCOMPLETE' },
  };
  assert.equal(resolveArchivePrunePlan([
    { id: 'S2', archive: recovered, matches: [], historyStatus: null },
  ], 4, null).reason, 'RECOVERED_ARCHIVE_SKIP_MARKER_MISSING');
});

test('archive pruning resumes interrupted subcollection deletion only with a matching intent marker', async () => {
  const { resolveArchivePrunePlan } = await import('../src/app/actions/season-archive.ts');
  const first = makeSeasonArchive(1);
  first.archive.status = 'completed';
  first.archive.completedAt = '2026-10-08T15:00:00.000Z';
  first.archive.pruneStatus = 'PRUNING';
  first.archive.pruneTargetSeason = 4;
  first.archive.pruneRetainedArchiveSeason = 2;
  first.archive.prunePolicyVersion = 1;
  const second = makeSeasonArchive(2);
  second.archive.status = 'completed';
  second.archive.completedAt = '2026-10-23T15:00:00.000Z';
  const result = resolveArchivePrunePlan([
    { id: 'S1', archive: first.archive, matches: [] },
    { id: 'S2', archive: second.archive, matches: second.matches },
  ], 4, 2);
  assert.equal(result.ready, true);
  assert.deepEqual(result.pruneIds, ['S1']);
});


test('recovered season archive snapshot records only starting placements and truthful unfinished counts', async () => {
  const { buildRecoveredSeasonArchiveSnapshot, isRecoveredSeasonArchive } = await import('../src/app/actions/season-archive.ts');
  const startingParticipants = Object.fromEntries(expectedRolloverGroups().map(group => [group,
    Array.from({ length: 8 }, (_, i) => ({ id: `${group}-TEAM-${i + 1}`, rank: i + 1, name: `${group} team ${i + 1}` }))]));
  const result = buildRecoveredSeasonArchiveSnapshot({
    sourceSeason: 2,
    startingParticipants,
    finishedMatches: 137,
    reason: 'SEASON_INCOMPLETE',
    recoveredAt: '2026-10-23T15:00:00.000Z',
  });
  assert.equal(result.ready, true);
  assert.equal(isRecoveredSeasonArchive(result.archive), true);
  assert.equal(result.archive.finishedMatches, 137);
  assert.equal(result.archive.unresolvedMatches, 703);
  assert.deepEqual(result.archive.standings, {});
  assert.equal(Object.values(result.archive.startingParticipants).flat().length, 120);
  assert.equal(Object.values(result.archive.startingParticipants).flat().every(row => row.matchesPlayed === 0), true);
});

test('recovered season archive refuses incomplete or duplicate starting participant placements', async () => {
  const { buildRecoveredSeasonArchiveSnapshot } = await import('../src/app/actions/season-archive.ts');
  const startingParticipants = Object.fromEntries(expectedRolloverGroups().map(group => [group,
    Array.from({ length: 8 }, (_, i) => ({ id: `${group}-TEAM-${i + 1}`, rank: i + 1 }))]));
  startingParticipants['D1-G1'][0].id = startingParticipants['D1-G1'][1].id;
  const result = buildRecoveredSeasonArchiveSnapshot({
    sourceSeason: 2, startingParticipants, finishedMatches: 0, reason: 'NO_CANONICAL_RESULTS',
  });
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'CARRY_FORWARD_TEAM_OR_RANK_CONFLICT');
});
