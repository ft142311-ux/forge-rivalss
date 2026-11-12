import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

test('authoritative match handlers route simulations through Match Engine', () => {
  const files = [
    'src/app/actions/autonomous-cycle.ts',
    'src/app/actions/universal-match-resolver.ts',
    'src/app/actions/friendly-matchmaking.ts',
    'src/app/actions/tournament-system.ts',
    'src/app/actions/trial-match-resolver.ts',
    'src/app/actions/season-recovery.ts',
  ];
  for (const file of files) {
    const source = read(file);
    assert.match(source, /runMatchEngine\(/, `${file} must call the shared engine`);
    assert.doesNotMatch(source, /simulateMatchCore\(/, `${file} must not call the low-level simulator directly`);
    assert.doesNotMatch(source, /import\s*\{[^}]*simulateMatchCore[^}]*\}/, `${file} must not import the low-level simulator`);
  }
});

test('legacy sequential recovery is disabled without database access', () => {
  const source = read('src/app/actions/season-sequential-recovery.ts');
  assert.match(source, /LEGACY_RECOVERY_DISABLED_USE_SEASON_ORCHESTRATOR/);
  assert.match(source, /writesStarted:\s*false/);
  assert.doesNotMatch(source, /getAdminDb|runMatchEngine|commitSeasonRolloverWrites|commitSeasonCalendarPublication/);
});

test('match modes have distinct Firestore collections', () => {
  const storage = read('src/app/lib/match-storage.ts');
  for (const name of ['matches_v2', 'cup_matches', 'tournament_matches_v1', 'friendly_matches_v1', 'training_matches_v1']) {
    assert.ok(storage.includes(name), `missing collection ${name}`);
  }
  const distinct = new Set(['matches_v2', 'cup_matches', 'tournament_matches_v1', 'friendly_matches_v1', 'training_matches_v1']);
  assert.equal(distinct.size, 5);
});

test('mode-specific reports are not mirrored into the league collection', () => {
  const friendly = read('src/app/actions/friendly-matchmaking.ts');
  const tournament = read('src/app/actions/tournament-system.ts');
  const trial = read('src/app/actions/trial-match-resolver.ts');
  assert.doesNotMatch(friendly, /collection\(['"]matches_v2['"]\)\.doc\(matchId\)/);
  assert.match(friendly, /MATCH_COLLECTIONS\.friendly/);
  assert.match(tournament, /MATCH_COLLECTIONS\.tournament/);
  assert.match(trial, /MATCH_COLLECTIONS\.trial/);
});

test('all report collections are covered by server report lookup', () => {
  const storage = read('src/app/lib/match-storage.ts');
  const reportAction = read('src/app/actions/match-report.ts');
  const viewer = read('src/app/match/page.tsx');
  for (const name of ['matches_v2', 'cup_matches', 'friendly_matches_v1', 'association_matches_v1', 'tournament_matches_v1', 'training_matches_v1']) {
    assert.ok(storage.includes(name), `missing storage mapping for ${name}`);
  }
  assert.match(reportAction, /for \(const collectionName of MATCH_REPORT_COLLECTIONS\)/);
  assert.match(viewer, /getMatchReportAction/);
});

test('CW basket uses isolated association collection and shared match resolver', () => {
  const cw = read('src/app/actions/cw-basket.ts');
  const resolver = read('src/app/actions/friendly-matchmaking.ts');
  const cron = read('src/app/api/cron/resolve-friendly-matches/route.ts');
  assert.match(cw, /MATCH_COLLECTIONS\.association/);
  assert.match(resolver, /resolveDueAssociationMatches/);
  assert.match(cron, /resolveDueAssociationMatches/);
});

test('client compatibility paths and AI adapter also use the shared engine', () => {
  for (const file of ['src/app/lib/store.tsx', 'src/ai/flows/simulate-moba-match.ts', 'src/app/lib/cup-utils.ts']) {
    const source = read(file);
    assert.match(source, /runMatchEngine\(/, `${file} must use the shared engine`);
    assert.doesNotMatch(source, /simulateMatchCore\(/, `${file} must not bypass the shared engine`);
  }
});
