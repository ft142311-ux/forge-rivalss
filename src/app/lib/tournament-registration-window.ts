export function isTournamentRegistrationOpen(tournament: any, now = Date.now()): boolean {
  if (!tournament || tournament.status !== 'registration') return false;
  const opensAt = Number(tournament.registrationOpenAt);
  const closesAt = Number(tournament.registrationCloseAt);
  return Number.isFinite(opensAt) && Number.isFinite(closesAt) &&
    Number.isFinite(now) && now >= opensAt && now < closesAt;
}
