export type PreparedSlotDecision =
  | { ready: true; action: 'CREATE' | 'PRESERVE' | 'PLACE_HUMAN' }
  | { ready: false; reason: 'PREPARED_SLOT_IDENTITY_CONFLICT' };

export function resolvePreparedSlotRetry(
  existing: Record<string, any> | null,
  plannedTeamId: string,
) : PreparedSlotDecision {
  const plannedId = String(plannedTeamId || '');
  if (!plannedId) return { ready: false, reason: 'PREPARED_SLOT_IDENTITY_CONFLICT' };
  if (!existing) return { ready: true, action: 'CREATE' };

  const status = String(existing.status || '').toUpperCase();
  const occupantId = String(existing.occupantId || '');
  const isHumanPlan = !plannedId.startsWith('BOT_');

  if (status === 'OCCUPIED') {
    return isHumanPlan && occupantId === plannedId
      ? { ready: true, action: 'PRESERVE' }
      : { ready: false, reason: 'PREPARED_SLOT_IDENTITY_CONFLICT' };
  }

  if (status === 'FREE') {
    return isHumanPlan
      ? { ready: true, action: 'PLACE_HUMAN' }
      : { ready: true, action: 'PRESERVE' };
  }

  return { ready: false, reason: 'PREPARED_SLOT_IDENTITY_CONFLICT' };
}

export function shouldRepairExistingMatchCoordinates(
  existing: Record<string, any>,
  expectedLevel: number,
  expectedGroup: number,
) {
  if (existing.isFinished === true) return false;
  return Number(existing.level) !== expectedLevel || Number(existing.groupId) !== expectedGroup;
}
