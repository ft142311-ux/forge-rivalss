import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCanonicalDocuments } from './season-canonical';

function canonicalWorld() {
  const tables: Record<string, any>[] = [];
  const slots: Record<string, any>[] = [];
  const matches: Record<string, any>[] = [];

  for (let level = 1; level <= 4; level++) {
    for (let group = 1; group <= 2 ** (level - 1); group++) {
      const groupId = `${level}-${group}`;
      const ids = Array.from({ length: 8 }, (_, rank) => `TEAM_${groupId}_${rank + 1}`);
      tables.push({
        leagueId: 'ALPHA',
        level,
        group,
        stats: Object.fromEntries(ids.map((id, index) => [id, { id, rank: index + 1 }])),
      });
      ids.forEach((occupantId, index) => slots.push({
        division: level,
        group,
        rank: index + 1,
        status: 'OCCUPIED',
        occupantId,
      }));
      for (let homeRank = 1; homeRank <= 8; homeRank++) {
        for (let awayRank = 1; awayRank <= 8; awayRank++) {
          if (homeRank === awayRank) continue;
          matches.push({
            id: `MATCH_${groupId}_${homeRank}_${awayRank}`,
            level,
            groupId: group,
            homeRank,
            awayRank,
            homeId: ids[homeRank - 1],
            awayId: ids[awayRank - 1],
            isFinished: false,
            status: 'scheduled',
          });
        }
      }
    }
  }

  return { tables, slots, matches };
}

test('canonical validation accepts replaced bot identity in immutable completed fixtures', () => {
  const world = canonicalWorld();
  const historical = world.matches[0];
  historical.homeId = 'BOT_REPLACED_AFTER_MATCH';
  historical.isFinished = true;
  historical.status = 'finished';

  const result = evaluateCanonicalDocuments(world);
  assert.equal(result.ready, true, result.reasons.join(', '));
});

test('canonical validation still rejects current participant mismatch in pending fixtures', () => {
  const world = canonicalWorld();
  world.matches[0].homeId = 'BOT_UNEXPECTED_IN_PENDING_FIXTURE';

  const result = evaluateCanonicalDocuments(world);
  assert.equal(result.ready, false);
  assert.ok(result.reasons.includes('MATCH_PARTICIPANT_TABLE_MISMATCH'));
});
