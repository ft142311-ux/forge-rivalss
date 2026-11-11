'use strict';

/** New clubs may claim any unoccupied D1-D4 slot in the active season. */
function isEligibleRegistrationSlot(slot, seasonNum) {
  return Boolean(slot) &&
    slot.status === 'FREE' &&
    !slot.occupantId &&
    Number(slot.season) === Number(seasonNum) &&
    Number.isInteger(Number(slot.division)) && Number(slot.division) >= 1 && Number(slot.division) <= 4;
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
