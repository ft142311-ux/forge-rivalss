import { getAdminDb } from '../src/lib/firebase-admin';
import { validateRolloverPlan } from '../src/app/actions/season-rollover-plan';
import { expectedRolloverGroups } from '../src/app/actions/season-rollover-plan';

async function main() {
  const db = getAdminDb();
  const [config, archive, planSnap, existingMatches, existingTables, existingSlots, existingArchive] = await Promise.all([
    db.doc('system_v1/season_config').get(),
    db.doc('league_season_archives_v1/S1').get(),
    db.doc('league_season_rollovers_v1/S2').get(),
    db.collection('matches_v2').where('season', '==', 2).get(),
    db.collection('league_tables_v2').where('season', '==', 2).get(),
    db.collection('league_slots_v1').where('season', '==', 2).get(),
    db.doc('league_season_archives_v1/S2').get(),
  ]);
  const plan = planSnap.data() || {};
  if (!config.exists || Number(config.data()?.activeSeasonNumber) !== 1 || config.data()?.phase !== 'REGULAR_SEASON' ||
      archive.data()?.status !== 'completed' || !validateRolloverPlan(plan, 1, 2).valid) throw new Error('S2_PROFILE_CHECK_GUARD_FAILED');
  const teams = expectedRolloverGroups().flatMap(key => plan.groups[key] || []);
  const snapshots = await Promise.all(teams.map(team => db.doc(`players_v14/${String(team.id)}`).get()));
  const missing = snapshots.filter(snap => !snap.exists).map(snap => snap.id);
  const invalidBotProfiles = snapshots.filter(snap => snap.exists && snap.id.startsWith('BOT_')).filter(snap => {
    const roster = snap.data()?.ownedPlayers;
    return !Array.isArray(roster) || roster.length !== 5 || !roster.every((player: any) => Number(player?.overallRating ?? player?.ovr) >= 23 && Number(player?.overallRating ?? player?.ovr) <= 27 && player?.proStats && typeof player.proStats === 'object');
  }).map(snap => snap.id);
  console.log(JSON.stringify({
    readOnly: true,
    writesPerformed: 0,
    uniquePlanParticipants: new Set(teams.map(team => String(team.id))).size,
    profileDocuments: snapshots.filter(snap => snap.exists).length,
    missingProfiles: missing,
    invalidBotProfiles,
    existingS2: { matches: existingMatches.size, tables: existingTables.size, slots: existingSlots.size, archive: existingArchive.exists },
  }, null, 2));
  await db.terminate();
  if (missing.length || invalidBotProfiles.length) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
