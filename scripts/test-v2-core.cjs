const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src/app/lib/leagues-data.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  fileName: sourcePath,
});
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-rivals-v2-'));
const compiledPath = path.join(tempDir, 'leagues-data.cjs');
fs.writeFileSync(compiledPath, compiled.outputText, 'utf8');

try {
  const league = require(compiledPath);
  assert.equal(league.MAX_LEVELS, 4, 'league pyramid must have four divisions');
  assert.equal(league.TOTAL_GROUPS, 15, 'league pyramid must have 15 groups');
  assert.equal(league.TEAMS_PER_GROUP, 8, 'each group must have 8 teams');

  const teams = Array.from({ length: 8 }, (_, index) => ({
    id: `TEAM_${index + 1}`,
    name: `Team ${index + 1}`,
    rank: index + 1,
  }));
  const start = new Date('2026-09-21T15:00:00.000Z');
  const matches = league.generateSeasonCalendar(teams, 1, 'ALPHA', start);
  assert.equal(matches.length, 56, 'double round-robin group must contain 56 matches');

  const appearances = new Map(teams.map((team) => [team.id, 0]));
  const fixtureKeys = new Set();
  for (const match of matches) {
    assert.ok(appearances.has(match.homeId), 'home team must belong to group');
    assert.ok(appearances.has(match.awayId), 'away team must belong to group');
    assert.notEqual(match.homeId, match.awayId, 'a team cannot play itself');
    appearances.set(match.homeId, appearances.get(match.homeId) + 1);
    appearances.set(match.awayId, appearances.get(match.awayId) + 1);
    fixtureKeys.add(`${match.tour}:${match.homeId}:${match.awayId}`);
    assert.ok(Number.isFinite(Date.parse(match.startTime)), 'fixture start time must be valid');
  }
  assert.equal(fixtureKeys.size, 56, 'all fixture entries must be unique');
  for (const [teamId, count] of appearances) {
    assert.equal(count, 14, `${teamId} must play 14 matches per season`);
  }

  const first = league.getMatchResult(1, 8, 1, 8, 1, 1, 12345);
  const repeat = league.getMatchResult(1, 8, 1, 8, 1, 1, 12345);
  assert.deepEqual(repeat, first, 'same input must produce the same result');
  for (const score of first) assert.ok(Number.isInteger(score) && score >= 0 && score <= 6);

  const matchPage = fs.readFileSync(path.join(root, 'src/app/match/page.tsx'), 'utf8');
  const matchReportUtils = fs.readFileSync(path.join(root, 'src/app/lib/match-report-utils.ts'), 'utf8');
  assert.match(matchPage, /normalizeMatchTimeline\(game\)/, 'match page must use the shared live event normalizer');
  assert.match(matchReportUtils, /\.\.\.source,[\s\S]{0,220}minute:/, 'shared live event normalization must preserve source fields');
  assert.doesNotMatch(matchPage, /text-10px\]/, 'invalid K/D/A font utility must not return');
  const autonomous = fs.readFileSync(path.join(root, 'src/app/actions/autonomous-cycle.ts'), 'utf8');
  assert.match(autonomous, /export async function runTransferMarketExpirySweep/);
  assert.match(autonomous, /export async function runPlayerAuctionSettlementSweep/);

  console.log(JSON.stringify({
    success: true,
    checks: [
      'league pyramid: 4 divisions / 15 groups / 8 teams per group',
      'double round-robin: 56 fixtures and 14 appearances per team',
      'fixture timestamps and IDs',
      'deterministic bounded match result',
      'match report live-event preservation',
      'cron export presence',
    ],
    fixtureCount: matches.length,
    matchResultSample: first,
  }, null, 2));
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
