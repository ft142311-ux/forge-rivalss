export function associationTreasuryAfterDailyPayment(treasury: number, dailyPayment: number) {
  return Math.max(0, Number(treasury || 0) + Number(dailyPayment || 0));
}

export function associationExperienceGain(matchWon: boolean, tournament = false) {
  return (matchWon ? 2 : 1) + (tournament ? 2 : 0);
}

export function validateSingleAssociation(currentAssociationId: string | null | undefined, targetAssociationId: string) {
  return !currentAssociationId || currentAssociationId === targetAssociationId;
}

export function qualifiesForAssociationCup(memberCount: number) { return Number(memberCount || 0) >= 25; }
export function canJoinOnlyOneAssociation(currentAssociationId: string | null | undefined, targetAssociationId: string) { return validateSingleAssociation(currentAssociationId, targetAssociationId); }
export function associationDailyTreasuryPayment(memberCount: number, configuredPayment: number) {
  return Math.max(0, Math.round(Number(configuredPayment || 0) * Math.max(1, Number(memberCount || 0))));
}
