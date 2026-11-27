import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isTournamentStageMatchSetComplete, resolveTournamentGroupOutcome } from '../src/app/lib/tournament-stage-utils.ts';

const source = readFileSync(new URL('../src/app/actions/tournament-system.ts', import.meta.url), 'utf8');

test('tournament stage readiness requires the canonical fixture matrix and completed outcomes', () => {
  const start = source.indexOf('async function stageMatchesDone');
  const end = source.indexOf('function expectedStageMatchCount', start);
  assert.ok(start >= 0 && end > start);
  const stageCheck = source.slice(start, end);
  assert.ok(stageCheck.includes('snap.docs.length !== expectedCount'));
  assert.ok(stageCheck.includes('isTournamentStageMatchSetComplete('));
  assert.ok(stageCheck.includes("collection('groups').get()"));
  assert.ok(stageCheck.includes('groupTeamsById[groupDoc.id] = teamIds'));
  assert.ok(stageCheck.includes('groupTeamsById,'));
  assert.ok(stageCheck.includes('maxParticipants'));

  const helper = readFileSync(new URL('../src/app/lib/tournament-stage-utils.ts', import.meta.url), 'utf8');
  assert.ok(helper.includes('isTournamentStageMatchComplete(match, stage)'));
  assert.ok(helper.includes("if (stage !== 'groups' && !match.winnerId) return false"));
  assert.ok(helper.includes('expected.delete(key)'));
  assert.ok(helper.includes('roundEntries.length !== 2'));
  assert.ok(helper.includes('roundTeamIds.size !== 4'));
  assert.ok(helper.includes('playedPairs.size !== 6'));
});

test('group match settlement validates standings rows before atomically publishing result and report', () => {
  const start = source.indexOf('async function resolveTournamentMatch');
  const end = source.indexOf('async function stageMatchesDone', start);
  assert.ok(start >= 0 && end > start);
  const resolver = source.slice(start, end);
  const finalizeStart = resolver.indexOf('const finalized = await db.runTransaction');
  const guard = resolver.indexOf('TOURNAMENT_GROUP_STANDINGS_INTEGRITY_FAILED', finalizeStart);
  const matchWrite = resolver.indexOf("t.update(matchRef, {", finalizeStart);
  const reportWrite = resolver.indexOf("t.set(db.collection(MATCH_COLLECTIONS.tournament)", finalizeStart);
  const standingsWrite = resolver.indexOf("t.update(groupRef, { teams: groupRows", finalizeStart);
  assert.ok(finalizeStart >= 0 && guard > finalizeStart && matchWrite > guard && reportWrite > guard && standingsWrite > reportWrite);
  assert.match(resolver, /const homeRow = groupRows\.find/);
  assert.match(resolver, /const awayRow = groupRows\.find/);
});

import { isTournamentStageFixtureCompatible } from '../src/app/lib/tournament-stage-transition.ts';

test('stage transition reuses only a fully compatible scheduled fixture', () => {
  const expected = {
    id: 'quarterfinal_1',
    tournamentId: 'daily-cup',
    stage: 'quarterfinal',
    round: 1,
    index: 1,
    homeId: 'team-a',
    awayId: 'team-b',
    bestOf: 2,
    scheduledAt: 1_800_000_000_000,
    status: 'scheduled',
  };
  const existing = { ...expected, createdAt: 123 };

  assert.equal(isTournamentStageFixtureCompatible(existing, expected), true);
  assert.equal(isTournamentStageFixtureCompatible({ ...existing, status: 'completed' }, expected), false);
  assert.equal(isTournamentStageFixtureCompatible({ ...existing, bestOf: 1 }, expected), false);
  assert.equal(isTournamentStageFixtureCompatible({ ...existing, scheduledAt: undefined }, expected), false);
  assert.equal(isTournamentStageFixtureCompatible({ ...existing, round: 2 }, expected), false);
  assert.equal(isTournamentStageFixtureCompatible({ ...existing, tournamentId: 'other-cup' }, expected), false);
  assert.equal(isTournamentStageFixtureCompatible({ ...existing, awayId: 'team-c' }, expected), false);
});

test('BO2 group standings use the series winner, not aggregate game-score totals', () => {
  // A 1-1 split can have unequal aggregate in-game scores and is still a draw.
  assert.equal(resolveTournamentGroupOutcome('draw', 'home-team', 'away-team'), 'draw');
  // A series winner keeps the win even if aggregate game score is lower.
  assert.equal(resolveTournamentGroupOutcome('home', 'home-team', 'away-team'), 'home_win');
  assert.equal(resolveTournamentGroupOutcome('away', 'home-team', 'away-team'), 'away_win');
});

test('invalid BO2 outcomes or participant identities fail closed', () => {
  assert.equal(resolveTournamentGroupOutcome('unknown', 'home-team', 'away-team'), null);
  assert.equal(resolveTournamentGroupOutcome('draw', '', 'away-team'), null);
  assert.equal(resolveTournamentGroupOutcome('home', 'same-team', 'same-team'), null);
});

test('group settlement persists the actual series score and applies points from the series outcome', () => {
  const start = source.indexOf('async function resolveTournamentMatch');
  const end = source.indexOf('async function stageMatchesDone', start);
  const resolver = source.slice(start, end);
  assert.match(resolver, /resolveTournamentGroupOutcome\(simulation\.winnerSide, home\.id, away\.id\)/);
  assert.match(resolver, /seriesScore: simulation\.seriesScore/);
  assert.match(resolver, /winnerSide: resolvedWinnerSide/);
  assert.match(resolver, /if \(groupOutcome === 'draw'\)/);
  assert.match(resolver, /else if \(groupOutcome === 'home_win'\)/);
  assert.doesNotMatch(resolver, /homeScore === awayScore/);
});


function createGroupStageFixtureSet(maxParticipants) {
  const groupTeamsById = {};
  const entries = [];
  const rounds = [
    [[0, 1], [2, 3]],
    [[0, 2], [1, 3]],
    [[0, 3], [1, 2]],
  ];
  const groupCount = maxParticipants / 4;

  for (let groupIndex = 0; groupIndex < groupCount; groupIndex += 1) {
    const groupId = String.fromCharCode(65 + groupIndex);
    const teamIds = Array.from({ length: 4 }, (_, index) => `team-${groupId}-${index + 1}`);
    groupTeamsById[groupId] = teamIds;

    rounds.forEach((pairs, roundIndex) => {
      pairs.forEach(([homeIndex, awayIndex], pairIndex) => {
        const id = `groups_${groupId}_${roundIndex + 1}_${pairIndex + 1}`;
        entries.push({
          id,
          data: {
            id,
            stage: 'groups',
            groupId,
            round: roundIndex + 1,
            index: pairIndex + 1,
            homeId: teamIds[homeIndex],
            awayId: teamIds[awayIndex],
            status: 'finished',
            winnerId: teamIds[homeIndex],
          },
        });
      });
    });
  }

  return { entries, groupTeamsById };
}

test('group stage fixture matrix covers every roster member exactly once in each round', () => {
  for (const maxParticipants of [16, 32]) {
    const { entries, groupTeamsById } = createGroupStageFixtureSet(maxParticipants);
    assert.equal(isTournamentStageMatchSetComplete(entries, 'groups', maxParticipants, groupTeamsById), true);

    const repeatedTeam = entries.map(entry => ({ id: entry.id, data: { ...entry.data } }));
    const brokenRoundOne = repeatedTeam.find(entry =>
      entry.data.groupId === 'A' && entry.data.round === 1 && entry.data.index === 2
    );
    brokenRoundOne.data.homeId = groupTeamsById.A[0];
    assert.equal(isTournamentStageMatchSetComplete(repeatedTeam, 'groups', maxParticipants, groupTeamsById), false);

    const foreignTeam = entries.map(entry => ({ id: entry.id, data: { ...entry.data } }));
    const brokenRoundTwo = foreignTeam.find(entry =>
      entry.data.groupId === 'A' && entry.data.round === 2 && entry.data.index === 1
    );
    brokenRoundTwo.data.homeId = groupTeamsById.B[0];
    assert.equal(isTournamentStageMatchSetComplete(foreignTeam, 'groups', maxParticipants, groupTeamsById), false);
  }
});

test('group stage fixture matrix rejects overlapping or incomplete group rosters', () => {
  const { entries, groupTeamsById } = createGroupStageFixtureSet(16);
  const overlappingRosters = {
    ...groupTeamsById,
    B: [...groupTeamsById.B.slice(0, 3), groupTeamsById.A[0]],
  };
  assert.equal(isTournamentStageMatchSetComplete(entries, 'groups', 16, overlappingRosters), false);

  const incompleteRosters = { ...groupTeamsById, D: undefined };
  assert.equal(isTournamentStageMatchSetComplete(entries, 'groups', 16, incompleteRosters), false);
});

test('group stage fixture matrix rejects repeated opponents even when every round uses all four teams', () => {
  const { entries, groupTeamsById } = createGroupStageFixtureSet(16);
  const repeatedOpponents = entries.map(entry => ({ id: entry.id, data: { ...entry.data } }));
  const roundTwo = repeatedOpponents.filter(entry =>
    entry.data.groupId === 'A' && entry.data.round === 2
  );
  roundTwo[0].data.homeId = groupTeamsById.A[0];
  roundTwo[0].data.awayId = groupTeamsById.A[1];
  roundTwo[1].data.homeId = groupTeamsById.A[2];
  roundTwo[1].data.awayId = groupTeamsById.A[3];

  // Each team still plays exactly once in round two, but both fixtures repeat
  // round one's pairings. A real round robin requires six distinct opponents.
  assert.equal(isTournamentStageMatchSetComplete(repeatedOpponents, 'groups', 16, groupTeamsById), false);
});
