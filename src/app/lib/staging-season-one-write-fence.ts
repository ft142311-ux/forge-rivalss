/**
 * Transactional write fence for player/profile mutations while the Beta Season 1
 * reset is rebuilding the canonical world. Call from inside the same Firestore
 * transaction, before its first write, so a concurrent reset-marker change
 * conflicts and retries against the current marker.
 */
export async function assertStagingSeasonOneResetNotInProgress(tx: any, db: any) {
  const configRef = db.collection('system_v1').doc('season_config');
  const configSnap = await tx.get(configRef);
  const config = configSnap.exists ? configSnap.data() || {} : {};
  if (config.stagingSeasonOneResetInProgress === true || config.stagingFreshSeasonOneReset === true) {
    throw new Error('STAGING_SEASON_ONE_RESET_IN_PROGRESS');
  }
}
