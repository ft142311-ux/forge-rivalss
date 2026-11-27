import { MATCH_COLLECTIONS } from './match-storage';
import { hasValidClubCreatedAt, isMatchReportFinished, isMatchWithinClubLifetime } from './match-report-utils';

export type UnreadMatchReportRecord = {
  id: string;
  collectionName: string;
  match: any;
};

export type UnreadMatchReportLeagueContext = {
  leagueId: string;
  level: number;
  groupId: string;
  rank: number;
};

/** Count unique, completed, unread reports that belong to the current club. */
export function countUnreadMatchReportRecords(
  records: UnreadMatchReportRecord[],
  uid: string,
  profileCreatedAt: any,
  league: UnreadMatchReportLeagueContext,
  locallyViewedIds: readonly string[] = [],
): number {
  const managerId = String(uid || '').trim();
  if (!managerId || !Array.isArray(records)) return 0;

  // Keep legacy league coordinates byte-for-byte aligned with the report
  // authorization path; only manager identity values are whitespace-normalized.
  const leagueId = String(league.leagueId || '');
  const groupId = String(league.groupId || '');
  const leagueLevel = Number(league.level);
  const leagueRank = Number(league.rank);
  const locallyViewed = new Set(locallyViewedIds);
  const unreadIds = new Set<string>();
  for (const record of records) {
    const match = record?.match || {};
    const id = String(record?.id || match.id || '');
    if (!id) continue;
    const finished = isMatchReportFinished(match);
    if (!finished || match.seen === true || match.reportStatus === 'viewed' || locallyViewed.has(id)) continue;
    if (!isMatchWithinClubLifetime(match, profileCreatedAt)) continue;

    const participant = [
      match.homeId, match.awayId, match.homeUid, match.awayUid,
      match.hostId, match.challengerId,
    ].some(value => String(value ?? '').trim() === managerId);
    const rankBasedLeagueParticipant = hasValidClubCreatedAt(profileCreatedAt) &&
      record.collectionName === MATCH_COLLECTIONS.league &&
      String(match.leagueId || '') === leagueId &&
      Number(match.level) === leagueLevel &&
      String(match.groupId || '') === groupId &&
      [Number(match.homeRank), Number(match.awayRank)].includes(leagueRank);
    if (!participant && !rankBasedLeagueParticipant) continue;
    // Match Center routes reports by document ID, so count the same global ID once
    // even when a legacy copy is present in another mode-specific collection.
    unreadIds.add(id);
  }
  return unreadIds.size;
}
