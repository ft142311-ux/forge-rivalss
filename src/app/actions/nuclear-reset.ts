import 'server-only';

/**
 * Скрипт "Ядерной очистки" v145 (Admin SDK Transition).
 */

import { getAdminDb } from '@/lib/firebase-admin';

const DELETE_BATCH_SIZE = 500;
const BATCHES_PER_CALL = 3; 

export async function totalNuclearResetV131() {
  // Destructive world maintenance is supported only against the local emulator.
  // Never allow an authenticated admin action to wipe a deployed Firestore project.
  if (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS !== 'true') {
    return { success: false, error: 'LOCAL_EMULATOR_REQUIRED', deletedCount: 0 };
  }

  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(emulatorHost)) {
    return { success: false, error: 'LOCAL_FIRESTORE_EMULATOR_REQUIRED', deletedCount: 0 };
  }

  const db = getAdminDb();

  const systemDocs = [
    'repair_v131_S1_LALPHA', 'init_v131_S1_LALPHA',
    'repair_v140_S1_LALPHA', 'init_v140_S1_LALPHA',
    'world_v131_status', 'world_v140_status'
  ];

  let totalDeletedInThisCall = 0;

  try {
    for (let b = 0; b < BATCHES_PER_CALL; b++) {
      const batch = db.batch();
      let batchCount = 0;

      if (b === 0) {
        for (const sId of systemDocs) {
          batch.delete(db.collection('system_v1').doc(sId));
          batchCount++;
        }
      }

      const colls = [
        'league_tables_v2', 'matches_v2', 
        'league_tables_v1', 'matches_v1', 'players_v13',
        'players_v12', 'players_v11', 'players_v10',
        'global_chat_v2', 'market_v7', 'friend_requests_v4', 
        'private_messages_v3', 'cup_matches', 'notifications_v7',
        'cup_pyramid_v1', 'cw_basket_v2', 'friendly_lobbies_v3',
        'associations_v4'
      ];

      for (const coll of colls) {
        if (batchCount >= DELETE_BATCH_SIZE) break;
        const snap = await db.collection(coll).limit(DELETE_BATCH_SIZE - batchCount).get();
        
        snap.docs.forEach(d => {
          batch.delete(d.ref);
          batchCount++;
        });
      }

      if (batchCount > 0) {
        await batch.commit();
        totalDeletedInThisCall += batchCount;
      }
    }
  } catch (globalErr: any) {
    console.error("[NUCLEAR RESET CRITICAL ERROR]:", globalErr.message);
    return { success: false, error: globalErr.message };
  }

  const isComplete = totalDeletedInThisCall < (DELETE_BATCH_SIZE / 2);
  return { success: true, isComplete, deletedCount: totalDeletedInThisCall };
}
