'use server';

import { getAdminDb } from '@/lib/firebase-admin';
import { requireServerActor } from '@/lib/server-auth';
import {
  clearYouthScoutingReportWithDb,
  completeDailyYouthTrainingWithDb,
  promoteYouthPlayerWithDb,
  recruitYouthCandidateWithDb,
  scoutYouthCandidatesWithDb,
} from '@/app/lib/youth-academy';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'YOUTH_ACADEMY_ACTION_FAILED';
}

export async function scoutYouthCandidatesAction(idToken: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    return await scoutYouthCandidatesWithDb(getAdminDb(), uid);
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}

export async function recruitYouthCandidateAction(idToken: string, candidateId: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    return await recruitYouthCandidateWithDb(getAdminDb(), uid, candidateId);
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}

export async function clearYouthScoutingReportAction(idToken: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    return await clearYouthScoutingReportWithDb(getAdminDb(), uid);
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}

export async function promoteYouthPlayerAction(idToken: string, playerId: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    return await promoteYouthPlayerWithDb(getAdminDb(), uid, playerId);
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}

export async function completeDailyYouthTrainingAction(idToken: string, playerId: string) {
  try {
    const { uid } = await requireServerActor(idToken);
    return await completeDailyYouthTrainingWithDb(getAdminDb(), uid, playerId);
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}
