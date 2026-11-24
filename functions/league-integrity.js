'use strict';

/** New clubs enter through Division 4 only; higher divisions are earned through sporting results. */
function isEligibleRegistrationSlot(slot, seasonNum) {
  if (!slot || typeof slot !== 'object' || Array.isArray(slot)) return false;

  const season = Number(seasonNum);
  const slotSeason = Number(slot.season);
  const division = Number(slot.division);
  const group = Number(slot.group);
  const rank = Number(slot.rank);
  const groupsInDivision = new Map([[1, 1], [2, 2], [3, 4], [4, 8]]);

  return slot.status === 'FREE' &&
    !slot.occupantId &&
    Number.isInteger(season) && season > 0 &&
    Number.isInteger(slotSeason) && slotSeason === season &&
    Number.isInteger(division) && division === 4 && groupsInDivision.has(division) &&
    Number.isInteger(group) && group >= 1 && group <= groupsInDivision.get(division) &&
    Number.isInteger(rank) && rank >= 1 && rank <= 8;
}

/** Validate the immutable rank-based round robin before registration mutates it. */
function validateRegistrationSchedule(matches, rank, botId, teamsPerGroup = 8) {
  if (!Array.isArray(matches) || matches.length !== teamsPerGroup * (teamsPerGroup - 1) ||
      !Number.isInteger(Number(rank)) || Number(rank) < 1 || Number(rank) > teamsPerGroup ||
      typeof botId !== 'string' || !botId) return false;
  const coordinates = new Set();
  const participantByRank = new Map();
  const appearances = new Map();
  for (const match of matches) {
    const homeId = String(match?.homeId || '');
    const awayId = String(match?.awayId || '');
    const homeRank = Number(match?.homeRank);
    const awayRank = Number(match?.awayRank);
    if (!homeId || !awayId || homeId === awayId || !Number.isInteger(homeRank) ||
        !Number.isInteger(awayRank) || homeRank < 1 || homeRank > teamsPerGroup ||
        awayRank < 1 || awayRank > teamsPerGroup || homeRank === awayRank) return false;
    const coordinate = `${homeRank}>${awayRank}`;
    if (coordinates.has(coordinate)) return false;
    coordinates.add(coordinate);
    for (const [id, teamRank] of [[homeId, homeRank], [awayId, awayRank]]) {
      if (participantByRank.has(teamRank) && participantByRank.get(teamRank) !== id) return false;
      participantByRank.set(teamRank, id);
      appearances.set(id, (appearances.get(id) || 0) + 1);
    }
  }
  return coordinates.size === teamsPerGroup * (teamsPerGroup - 1) &&
    participantByRank.size === teamsPerGroup && appearances.size === teamsPerGroup &&
    [...appearances.values()].every(count => count === 2 * (teamsPerGroup - 1)) &&
    participantByRank.get(Number(rank)) === botId;
}

module.exports = { isEligibleRegistrationSlot, validateRegistrationSchedule };
