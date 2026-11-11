/**
 * Read-only preflight for the Season 1 -> Season 2 rollover.
 * This module intentionally performs Firestore reads only. It does not create
 * archives/plans, repair league documents, acquire locks, or publish a season.
 */
import { validateRolloverPlan } from './season-rollover-plan';

const LEAGUE_ID = 'ALPHA';
const SEASON_1 = 1;
const SEASON_2 = 2;
const EXPECTED_NEXT_SEASON_START = '2026-10-08T15:00:00.000Z';
const EXPECTED_GROUPS = 15;
const EXPECTED_SLOTS = 120;
const EXPECTED_MATCHES = 840;
const EXPECTED_TABLES = 15;

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** Call with the existing Firebase Admin Firestore instance. No writes occur. */
export async function inspectSeason2RolloverPreflight(db: any) {
  const configRef = db.collection('system_v1').doc('season_config');
  const [configSnap, matchesSnap, slotsSnap, tablesSnap, planSnap] = await Promise.all([
    configRef.get(),
    db.collection('matches_v2')
      .where('season', '==', SEASON_1)
      .where('leagueId', '==', LEAGUE_ID)
      .where('version', '==', 140).get(),
    db.collection('league_slots_v1')
      .where('season', '==', SEASON_1)
      .where('leagueId', '==', LEAGUE_ID).get(),
    db.collection('league_tables_v2')
      .where('season', '==', SEASON_1)
      .where('leagueId', '==', LEAGUE_ID)
      .where('version', '==', 140).get(),
    db.collection('league_season_rollovers_v1').doc('S2').get(),
  ]);

  const config = configSnap.exists ? configSnap.data() || {} : {};
  const plan = planSnap.exists ? planSnap.data() || {} : null;
  const planValidation = validateRolloverPlan(plan, SEASON_1, SEASON_2);
  const matches = matchesSnap.docs.map((doc: any) => ({ id: doc.id, data: doc.data() || {} }));
  const slots = slotsSnap.docs.map((doc: any) => ({ id: doc.id, data: doc.data() || {} }));
  const tables = tablesSnap.docs.map((doc: any) => ({ id: doc.id, data: doc.data() || {} }));

  const matchKeys = new Set<string>();
  const invalidMatches: string[] = [];
  const groups = new Map<string, Set<string>>();
  for (const match of matches) {
    const m = match.data;
    const level = Number(m.division ?? m.level ?? 0);
    const group = Number(m.group ?? 0);
    const homeRank = Number(m.homeRank ?? m.teamA?.rank ?? 0);
    const awayRank = Number(m.awayRank ?? m.teamB?.rank ?? 0);
    if (![level, group, homeRank, awayRank].every(Number.isSafeInteger) || level < 1 || level > 4 || group < 1 || homeRank < 1 || homeRank > 8 || awayRank < 1 || awayRank > 8 || homeRank === awayRank) {
      invalidMatches.push(match.id);
      continue;
    }
    const groupKey = `${level}.${group}`;
    const key = `${groupKey}:${homeRank}>${awayRank}`;
    if (matchKeys.has(key)) invalidMatches.push(match.id);
    matchKeys.add(key);
    if (!groups.has(groupKey)) groups.set(groupKey, new Set());
    groups.get(groupKey)!.add(`${homeRank}>${awayRank}`);
    const finished = m.isFinished === true || m.status === 'FINISHED' || m.status === 'COMPLETED';
    const scoreA = Number(m.teamA?.score ?? m.homeScore ?? m.scoreA);
    const scoreB = Number(m.teamB?.score ?? m.awayScore ?? m.scoreB);
    if (!finished || !Number.isFinite(scoreA) || !Number.isFinite(scoreB)) invalidMatches.push(match.id);
  }

  const groupAudit = Array.from({ length: EXPECTED_GROUPS }, (_, index) => {
    const level = index < 8 ? 4 : index < 12 ? 3 : index < 14 ? 2 : 1;
    const group = index < 8 ? index + 1 : index < 12 ? index - 7 : index < 14 ? index - 11 : 1;
    const key = `${level}.${group}`;
    const observed = groups.get(key)?.size || 0;
    return { group: key, expectedMatches: 56, observedMatches: observed, ready: observed === 56 };
  });

  const nextSeasonStart = isoOrNull(config.nextSeasonStart);
  const checks = {
    configExists: configSnap.exists,
    activeSeasonIs1: Number(config.activeSeasonNumber || 0) === SEASON_1,
    worldReady: config.worldReady === true,
    boundaryUnchanged: nextSeasonStart === EXPECTED_NEXT_SEASON_START,
    canonicalMatchCount: matches.length === EXPECTED_MATCHES,
    allCanonicalMatchesFinishedAndValid: invalidMatches.length === 0,
    all15GroupsComplete: groupAudit.length === EXPECTED_GROUPS && groupAudit.every((g) => g.ready),
    canonicalSlotCount: slots.length === EXPECTED_SLOTS,
    canonicalTableCount: tables.length === EXPECTED_TABLES,
    rolloverPlanValid: planValidation.valid === true,
  };
  const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);

  return {
    readOnly: true,
    writesPerformed: 0,
    safeToProceed: blockers.length === 0,
    sourceSeason: Number(config.activeSeasonNumber || 0),
    targetSeason: SEASON_2,
    phase: String(config.phase || 'UNKNOWN'),
    worldReady: config.worldReady === true,
    seasonStart: isoOrNull(config.seasonStart),
    nextSeasonStart,
    expectedNextSeasonStart: EXPECTED_NEXT_SEASON_START,
    counts: {
      canonicalMatches: matches.length,
      canonicalSlots: slots.length,
      canonicalTables: tables.length,
      distinctCanonicalFixtures: matchKeys.size,
      observedGroups: groups.size,
    },
    checks,
    blockers,
    invalidMatchIds: [...new Set(invalidMatches)].slice(0, 50),
    groups: groupAudit,
    rolloverPlan: { exists: planSnap.exists, valid: planValidation.valid === true, reason: planValidation.reason || null },
  };
}
