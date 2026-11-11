import 'server-only';

import { getAdminDb } from '@/lib/firebase-admin';
import { ensureSeasonCalendar } from './season-calendar';

const RESET_MARKER_ID = 'clean_world_reset_v1';
const DELETE_BATCH_SIZE = 400;

// Deliberately limited to known game-state collections. Firebase Authentication
// users and application secrets/configuration are not deleted.
const GAME_COLLECTIONS_TO_CLEAR = [
  'league_tables_v2',
  'matches_v2',
  'league_slots_v1',
  'players_v14',
  'league_tables_v1',
  'matches_v1',
  'matches',
  'league_season_rollovers_v1',
  'league_season_archives_v1',
  'cup_pyramid_v1',
  'economy_transactions',
  'global_chat_v2',
  'friend_requests_v4',
  'market_v7',
] as const;

async function deleteCollectionContents(db: any, collectionName: string) {
  let deleted = 0;
  while (true) {
    const snapshot = await db.collection(collectionName).limit(DELETE_BATCH_SIZE).get();
    if (snapshot.empty) break;
    const batch = db.batch();
    for (const doc of snapshot.docs) batch.delete(doc.ref);
    await batch.commit();
    deleted += snapshot.size;
  }
  return deleted;
}

/**
 * One-shot, explicitly confirmed clean-world reset for the local game database.
 * A marker prevents a retry from wiping a world that has already been created.
 */
export async function resetAndCreateCleanSeason1(confirmation: unknown) {
  if (confirmation !== 'RESET_FORGE_RIVALS_WORLD_S1') {
    return { success: false, action: 'CONFIRMATION_REQUIRED', worldReady: false };
  }

  const db = getAdminDb();
  const system = db.collection('system_v1');
  const markerRef = system.doc(RESET_MARKER_ID);
  const markerSnap = await markerRef.get();
  const marker = markerSnap.exists ? markerSnap.data() || {} : {};

  if (marker.phase === 'WORLD_CREATED') {
    const verification = await ensureSeasonCalendar();
    return {
      ...verification,
      resetSkipped: true,
      action: verification.worldReady ? 'CLEAN_SEASON1_ALREADY_READY' : 'CLEAN_SEASON1_BUILD_CONTINUES',
    };
  }

  // The marker is committed before destructive operations. If a request times
  // out mid-wipe, a retry repeats deletion safely; after BUILDING it must never
  // wipe again, because the new season documents may already exist.
  const deletedByCollection: Record<string, number> = {};
  if (marker.phase !== 'BUILDING' && marker.phase !== 'WORLD_CREATED') {
    await markerRef.set({
      phase: 'RESETTING',
      targetSeason: 1,
      startedAt: marker.startedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      collections: [...GAME_COLLECTIONS_TO_CLEAR],
    }, { merge: true });

    for (const collectionName of GAME_COLLECTIONS_TO_CLEAR) {
      deletedByCollection[collectionName] = await deleteCollectionContents(db, collectionName);
    }

    // Reset only season-related system documents; leave unrelated system config intact.
    const systemDocs = [
      'season_config',
      'global_stats',
      'season_rollover_v1',
      'season_calendar_build_v1',
      'repair_v140_S1_LALPHA',
      'repair_v140_S2_LALPHA',
    ];
    const batch = db.batch();
    for (const id of systemDocs) batch.delete(system.doc(id));
    await batch.commit();

    await markerRef.set({
      phase: 'BUILDING',
      targetSeason: 1,
      deletedByCollection,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  }

  const result: Record<string, any> = await ensureSeasonCalendar(1);
  if (result.worldReady === true && result.seasonNumber === 1) {
    await markerRef.set({
      phase: 'WORLD_CREATED',
      targetSeason: 1,
      completedAt: new Date().toISOString(),
      verification: {
        observedCanonicalTables: result.observedCanonicalTables ?? 15,
        observedCanonicalSlots: result.observedCanonicalSlots ?? 120,
        observedCanonicalMatches: result.observedCanonicalMatches ?? 840,
      },
    }, { merge: true });
  } else {
    await markerRef.set({
      phase: 'BUILDING',
      targetSeason: 1,
      lastResult: {
        success: result.success,
        worldReady: result.worldReady,
        action: result.action,
        reason: result.reason,
      },
      updatedAt: new Date().toISOString(),
    }, { merge: true });
  }

  return {
    ...result,
    action: result.worldReady ? 'CLEAN_SEASON1_CREATED' : 'CLEAN_SEASON1_BUILD_INCOMPLETE',
    resetStarted: true,
    deletedByCollection,
    resetMarker: markerRef.id,
  };
}
