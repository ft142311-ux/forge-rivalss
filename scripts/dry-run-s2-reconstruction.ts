import { getAdminDb } from '../src/lib/firebase-admin';
import { buildSeasonTwoRecoveryDocuments } from '../src/app/actions/season-recovery-core';
import { validateRolloverPlan } from '../src/app/actions/season-rollover-plan';
import { buildMatchTeamSnapshot, simulateMatchCore } from '../src/app/lib/match-simulation';
import { isValidSeasonTwoRecoveryResult } from '../src/app/actions/season-recovery-core';

async function main() {
  const db = getAdminDb();
  const configSnap = await db.doc('system_v1/season_config').get();
  const config = configSnap.data() || {};
  const archiveSnap = await db.doc('league_season_archives_v1/S1').get();
  const planSnap = await db.doc('league_season_rollovers_v1/S2').get();
  const plan = planSnap.data() || {};
  if (!configSnap.exists || Number(config.activeSeasonNumber) !== 1 || config.phase !== 'REGULAR_SEASON' ||
      config.worldReady !== true || !archiveSnap.exists || archiveSnap.data()?.status !== 'completed' ||
      !validateRolloverPlan(plan, 1, 2).valid) throw new Error('S2_RECONSTRUCTION_DRY_RUN_GUARD_FAILED');

  const built = buildSeasonTwoRecoveryDocuments(plan, new Date('2026-10-08T15:00:00.000Z'));
  const profileIds = [...new Set(built.matches.flatMap(match => [String(match.data.homeId), String(match.data.awayId)]))]
    .filter(id => !id.startsWith('BOT_'));
  const profileSnaps = await Promise.all(profileIds.map(id => db.doc(`players_v14/${id}`).get()));
  const missingProfiles = profileSnaps.filter(snap => !snap.exists).map(snap => snap.id);
  const profileById = new Map(profileSnaps.map(snap => [snap.id, snap.data() || {}]));
  const invalidSimulationResults: string[] = [];
  let humanInvolvedMatches = 0;
  for (const match of built.matches) {
    const data = match.data;
    if (!String(data.homeId).startsWith('BOT_') || !String(data.awayId).startsWith('BOT_')) humanInvolvedMatches++;
    const home = profileById.get(String(data.homeId)) || {};
    const away = profileById.get(String(data.awayId)) || {};
    const simulation = simulateMatchCore({
      matchId: match.id,
      teamA: buildMatchTeamSnapshot(home, data.homeName, String(data.homeId), 'league'),
      teamB: buildMatchTeamSnapshot(away, data.awayName, String(data.awayId), 'league'),
      bestOf: 2,
    });
    const [scoreA, scoreB] = String(simulation.seriesScore || '').split('-').map(Number);
    if (!isValidSeasonTwoRecoveryResult({ status: 'finished', isFinished: true, scoreA, scoreB })) invalidSimulationResults.push(match.id);
  }
  const report = {
    readOnly: true,
    writesPerformed: 0,
    config: { activeSeasonNumber: config.activeSeasonNumber, phase: config.phase, worldReady: config.worldReady },
    sourceArchive: { exists: archiveSnap.exists, status: archiveSnap.data()?.status || null },
    plan: { valid: validateRolloverPlan(plan, 1, 2).valid },
    generatedCalendar: { tables: built.tables.length, slots: built.slots.length, matches: built.matches.length, canonical: built.readiness.ready },
    participants: { uniqueProfilesRequired: profileIds.length, missingProfiles, humanInvolvedMatches },
    simulation: { invalidResults: invalidSimulationResults.length, sampleInvalidMatchIds: invalidSimulationResults.slice(0, 10) },
  };
  console.log(JSON.stringify(report, null, 2));
  await db.terminate();
  if (missingProfiles.length || invalidSimulationResults.length || !built.readiness.ready) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
