import { MATCH_COLLECTIONS } from './match-storage';
import { isMatchReportFinished, isMatchWithinClubLifetime } from './match-report-utils';

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
): number {
  if (!uid || !Array.isArray(records)) return 0;
  const unreadIds = new Set<string>();
  for (const record of records) {
    const match = record?.match || {};
    const id = String(record?.id || match.id || '');
    if (!id) continue;
    const finished = isMatchReportFinished(match);
    if (!finished || match.seen === true || match.reportStatus === 'viewed') continue;
    if (!isMatchWithinClubLifetime(match, profileCreatedAt)) continue;

    const participant = [
      match.homeId, match.awayId, match.homeUid, match.awayUid,
      match.hostId, match.challengerId,
    ].some(value => String(value || '') === uid);
    const rankBasedLeagueParticipant = record.collectionName === MATCH_COLLECTIONS.league &&
      String(match.leagueId || '') === league.leagueId &&
      Number(match.level) === league.level &&
      String(match.groupId || '') === league.groupId &&
      [Number(match.homeRank), Number(match.awayRank)].includes(league.rank);
    if (!participant && !rankBasedLeagueParticipant) continue;
    // Match Center routes reports by document ID, so count the same global ID once
    // even when a legacy copy is present in another mode-specific collection.
    unreadIds.add(id);
  }
  return unreadIds.size;
}
