import { timestampToMillis } from './timestamp-utils';

/**
 * One-time baseline for unread reports. Reports completed before the user
 * installs this migration are historical and must not keep the menu badge alive.
 */
export function getReportUnreadCutoff(uid: string): number {
  if (typeof window === 'undefined' || !uid) return Number.MAX_SAFE_INTEGER;
  const key = `forge_rivals_report_unread_cutoff_v1_${uid}`;
  try {
    const saved = window.localStorage.getItem(key);
    if (saved) {
      const parsed = Number(saved);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    const cutoff = Date.now();
    window.localStorage.setItem(key, String(cutoff));
    return cutoff;
  } catch {
    // If storage is unavailable, avoid resurrecting old reports in this session.
    return Date.now();
  }
}

export function getReportTimestamp(match: any): number {
  const value = match?.resolvedAt ?? match?.playedAt ?? match?.finishedAt ?? match?.createdAt ?? match?.startTime;
  const millis = timestampToMillis(value);
  return Number.isFinite(millis) ? millis : 0;
}
