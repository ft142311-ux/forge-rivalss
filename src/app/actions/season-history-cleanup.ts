import { FieldValue } from 'firebase-admin/firestore';
import { resolveHistoryCleanupCompletion } from './season-history-policy';

/**
 * Clear the durable post-activation cleanup marker only while the requested
 * season still owns it. The transaction makes retries and competing workers
 * safe: at most one caller observes shouldMarkComplete=true.
 */
export async function completeSeasonHistoryCleanup(db: any, targetSeason: number) {
  const configRef = db.collection('system_v1').doc('season_config');
  return await db.runTransaction(async (tx: any) => {
    const configSnap = await tx.get(configRef);
    const config = configSnap.exists ? configSnap.data() || {} : null;
    const decision = resolveHistoryCleanupCompletion(config, targetSeason);
    if (!decision.ready) return decision;
    if (decision.shouldMarkComplete) {
      tx.update(configRef, {
        historyCleanupPending: false,
        historyCleanupCompletedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
    return decision;
  });
}
