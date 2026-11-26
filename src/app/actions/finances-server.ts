'use server';

/**
 * @fileOverview Серверный модуль финансов на базе Admin SDK.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase-admin';
import { FinancialOpSchema } from '@/app/lib/validation-schemas';
import { logger } from '@/app/lib/logger';
import { requireServerActor } from '@/lib/server-auth';
import { assertStagingSeasonOneResetNotInProgress } from '@/app/lib/staging-season-one-write-fence';

function readFinancialBalance(value: unknown) {
  const balance = value === undefined || value === null
    ? 0
    : (typeof value === 'number' || typeof value === 'string') ? Number(value) : NaN;
  if (!Number.isSafeInteger(balance) || balance < 0) throw new Error('INVALID_BALANCE');
  return balance;
}

/**
 * Выполняет финансовую операцию с постоянным ключом идемпотентности,
 * scoped к пользователю. Баланс, receipt и economy ledger фиксируются атомарно.
 */
export async function processFinancialOperation(idToken: string, data: unknown) {
  const { uid: userId } = await requireServerActor(idToken);
  const validation = FinancialOpSchema.safeParse(data);
  if (!validation.success) return { success: false, error: 'INVALID_INPUT' };

  const { idempotencyKey, amount, type, description } = validation.data;
  const db = getAdminDb();

  try {
    return await db.runTransaction(async (transaction) => {
      await assertStagingSeasonOneResetNotInProgress(transaction, db);
      const receiptRef = db.collection('system_v1').doc(`financial_op_${userId}_${idempotencyKey}`);
      const playerRef = db.collection('players_v14').doc(userId);
      const ledgerRef = db.collection('economy_transactions').doc(`financial_${userId}_${idempotencyKey}`);

      const receiptSnap = await transaction.get(receiptRef);
      if (receiptSnap.exists) {
        const receipt = receiptSnap.data() || {};
        if (receipt.amount !== amount || receipt.type !== type) {
          throw new Error('IDEMPOTENCY_KEY_REUSED');
        }
        logger.warn('Idempotency match detected. Skipping operation.', { userId, idempotencyKey });
        return { success: true, alreadyProcessed: true };
      }

      const playerSnap = await transaction.get(playerRef);
      if (!playerSnap.exists) throw new Error('PLAYER_NOT_FOUND');

      const player = playerSnap.data() || {};
      const balanceBefore = readFinancialBalance(player[type]);
      if (!Number.isSafeInteger(balanceBefore) || balanceBefore < 0) throw new Error('INVALID_BALANCE');
      if (amount < 0 && balanceBefore < Math.abs(amount)) throw new Error('INSUFFICIENT_FUNDS');

      const balanceAfter = balanceBefore + amount;
      if (!Number.isSafeInteger(balanceAfter) || balanceAfter < 0) throw new Error('INVALID_BALANCE');

      transaction.update(playerRef, {
        [type]: balanceAfter,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(ledgerRef, {
        userId,
        amount,
        currency: type,
        type: 'FINANCIAL_OPERATION',
        description: description || 'Financial operation',
        balanceBefore,
        balanceAfter,
        idempotencyKey,
        timestamp: FieldValue.serverTimestamp(),
      });
      transaction.create(receiptRef, {
        userId,
        amount,
        type,
        ledgerId: ledgerRef.id,
        processedAt: FieldValue.serverTimestamp(),
      });

      return { success: true };
    });
  } catch (error: any) {
    logger.error('Financial operation failed', error, { userId, idempotencyKey });
    return { success: false, error: error?.message || 'FINANCIAL_OPERATION_FAILED' };
  }
}
