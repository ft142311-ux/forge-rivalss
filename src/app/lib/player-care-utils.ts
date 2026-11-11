export type PlayerCareMode = 'energy' | 'form';

function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function applyPlayerCareToOwnedPlayers(
  ownedPlayers: any[],
  playerId: string,
  mode: PlayerCareMode,
  medicalSkill: number,
) {
  const index = ownedPlayers.findIndex((player) => player?.id === playerId);
  if (index < 0) throw new Error('PLAYER_NOT_OWNED');

  const currentPlayer = ownedPlayers[index];
  const updatedPlayers = [...ownedPlayers];
  if (mode === 'energy') {
    const current = Math.max(0, Math.min(100, finiteNumber(currentPlayer.fatigue, 100)));
    if (current >= 100) throw new Error('PLAYER_ALREADY_FULLY_RECOVERED');
    const value = Math.min(100, current + 25);
    updatedPlayers[index] = { ...currentPlayer, fatigue: value };
    return { updatedPlayers, value, field: 'fatigue' as const };
  }

  const medical = Math.max(0, Math.min(100, finiteNumber(medicalSkill)));
  const cap = 100 + medical;
  const current = Math.max(0, Math.min(cap, finiteNumber(currentPlayer.form, 100)));
  if (current >= cap) throw new Error('PLAYER_ALREADY_AT_FORM_CAP');
  const value = Math.min(cap, current + 15);
  updatedPlayers[index] = { ...currentPlayer, form: value };
  return { updatedPlayers, value, field: 'form' as const };
}

export function recoverAssignedSquadPlayers(ownedPlayers: any[], lineup: Record<string, unknown>) {
  const assignedIds = new Set(
    Object.values(lineup || {}).filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
  if (!assignedIds.size) throw new Error('NO_ASSIGNED_SQUAD_PLAYERS');

  let recoveredPlayers = 0;
  const updatedPlayers = ownedPlayers.map((player) => {
    if (!assignedIds.has(player?.id)) return player;
    const current = Math.max(0, Math.min(100, finiteNumber(player.fatigue, 100)));
    if (current >= 100) return player;
    recoveredPlayers += 1;
    return { ...player, fatigue: 100 };
  });
  if (!recoveredPlayers) throw new Error('SQUAD_ALREADY_FULLY_RECOVERED');
  return { updatedPlayers, recoveredPlayers };
}
