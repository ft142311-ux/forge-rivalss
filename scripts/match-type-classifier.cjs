'use strict';

/**
 * Read-only classifier for Forge-Rivals match/report documents.
 * This classifies records; it never moves or deletes them.
 */
function classifyMatch(docId, data = {}) {
  const type = String(data.matchType || data.type || data.competitionType || '').trim().toLowerCase();
  const source = String(data.source || '').trim().toLowerCase();

  if (type === 'basket' || source === 'cw-basket') return 'basket';
  if (data.isFriendly === true || type === 'friendly' || source === 'friendly') return 'friendly';
  if (data.isCup === true || data.cupId || type === 'cup' || source === 'pyramid-cup') return 'cup';
  if (data.tournamentId || type === 'tournament' || type === 'tournament_match') return 'tournament';
  if (type === 'trial' || data.isTrial === true || source === 'trial') return 'trial';
  if (type === 'league' || (Number(data.version) === 140 && Number(data.season) >= 1 && data.leagueId)) return 'league';

  // Do not guess from a bare ID prefix: records with insufficient metadata need review.
  return 'unknown';
}

function isCanonicalSeason1LeagueMatch(docId, data = {}) {
  const idPattern = /^match_v140_S1_LALPHA_V[1-4]_G\d+_T(?:[1-9]|1[0-4])_R[1-8]_vs_R[1-8]$/;
  return idPattern.test(String(docId))
    && String(data.type || '').toLowerCase() === 'league'
    && Number(data.season) === 1
    && Number(data.version) === 140
    && String(data.leagueId || '').toUpperCase() === 'ALPHA'
    && Number(data.level) >= 1 && Number(data.level) <= 4
    && Number(data.groupId) >= 1;
}

module.exports = { classifyMatch, isCanonicalSeason1LeagueMatch };
