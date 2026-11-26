import type { Firestore } from 'firebase-admin/firestore';
import { FOUNDATION_COLLECTIONS } from '@/game/foundation/config';

/** Returns the canonical Firestore document reference for a foundation manager. */
export function getFoundationManagerRef(db: Firestore, uid: string) {
  return db.collection(FOUNDATION_COLLECTIONS.managers).doc(uid);
}
