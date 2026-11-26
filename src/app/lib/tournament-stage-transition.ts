export function isTournamentStageFixtureCompatible(existing: Record<string, unknown>, expected: Record<string, unknown>) {
  const stringFields = ['id', 'tournamentId', 'stage', 'homeId', 'awayId', 'status'];
  for (const field of stringFields) {
    if (String(existing[field] ?? '') !== String(expected[field] ?? '')) return false;
  }

  const numericFields = ['round', 'index', 'bestOf', 'scheduledAt'];
  for (const field of numericFields) {
    const actual = Number(existing[field]);
    const wanted = Number(expected[field]);
    if (!Number.isFinite(actual) || !Number.isFinite(wanted) || actual !== wanted) return false;
  }

  return expected.status === 'scheduled';
}
