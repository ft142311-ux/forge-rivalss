'use strict';

const SEASON = 1;
const CALENDAR_REVISION = 3;

/** Pure config builder kept separate so tests never initialize Firebase Admin. */
function buildSuccessfulRebuildConfig(adminSdk, seasonStart) {
  return {
    activeSeasonNumber: SEASON,
    phase: 'REGULAR_SEASON',
    worldReady: true,
    seasonStart: seasonStart.toISOString(),
    nextSeasonStart: new Date(seasonStart.getTime() + 17 * 86400000).toISOString(),
    calendarRevision: CALENDAR_REVISION,
    rebuildStatus: 'STAGE_3A8_COMPLETE',
    rebuildError: adminSdk.firestore.FieldValue.delete(),
    updatedAt: adminSdk.firestore.FieldValue.serverTimestamp(),
  };
}

module.exports = { buildSuccessfulRebuildConfig };
