'use strict';

const { isEligibleRegistrationSlot } = require('./league-integrity');

/**
 * Shared registration primitives. This module lives inside the Firebase
 * Functions source directory so the local emulator can use it and a future
 * Blaze deployment packages every required file with functions/index.js.
 */

function generateStartingSquad() {
  const roles = ['Carry', 'Midlaner', 'Tank', 'Jungler', 'Support', 'Carry', 'Midlaner', 'Tank', 'Jungler', 'Support'];
  const countries = [
    { code: 'RU', name: 'Россия', flag: '🇷🇺', url: 'https://i.postimg.cc/mg3yfqj5/rus-2.jpg' },
    { code: 'CN', name: 'Китай', flag: '🇨🇳', url: 'https://i.postimg.cc/wvzKxSYS/1755011442109.jpg' },
    { code: 'KR', name: 'Южная Корея', flag: '🇰🇷', url: 'https://i.postimg.cc/43mv7dsH/kr-1.jpg' },
    { code: 'UA', name: 'Украина', flag: '🇺🇦', url: 'https://i.postimg.cc/X7fs4pYn/ua-1.jpg' },
    { code: 'BR', name: 'Бразилия', flag: '🇧🇷', url: 'https://i.postimg.cc/Z5906yvS/br-1.jpg' }
  ];

  return roles.map((role, i) => {
    const country = countries[i % countries.length];
    const ovr = 28 + Math.floor(Math.random() * 10);
    const skillBase = Math.floor(ovr * 0.25);
    const ageYears = 18 + Math.floor(Math.random() * 13);
    const ageMonth = Math.floor(Math.random() * 13);
    const ageMs = (ageYears * 7 * 24 * 60 * 60 * 1000) +
      (ageMonth * (7 * 24 * 60 * 60 * 1000 / 12));
    const birthDate = new Date(Date.now() - ageMs).toISOString();

    return {
      id: `p_init_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`,
      name: `Cadet_${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      role,
      overallRating: ovr,
      image: country.url,
      country: { code: country.code, name: country.name, flag: country.flag },
      age: ageYears,
      ageDisplay: `${ageYears}.${ageMonth}`,
      birthDate,
      hiredAt: new Date().toISOString(),
      salary: 2500,
      form: 80,
      fatigue: 100,
      isInjured: false,
      isPro: false,
      isYouth: false,
      proStats: {
        lastHitting: skillBase, mapAwareness: skillBase, positioning: skillBase,
        reflexes: skillBase, manaManagement: skillBase, objectiveControl: skillBase,
        communication: skillBase, tiltResistance: skillBase, versatility: skillBase, ganking: skillBase
      },
      proTalents: {
        lastHitting: 40, mapAwareness: 40, positioning: 40, reflexes: 40,
        manaManagement: 40, objectiveControl: 40, communication: 40,
        tiltResistance: 40, versatility: 40, ganking: 40
      }
    };
  });
}

function isCompletedMatch(match) {
  const status = String(match && match.status || '').toLowerCase();
  return Boolean(match && match.isFinished === true) ||
    status === 'finished' ||
    status === 'completed';
}

function timestampToMillis(value) {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return Date.parse(value);
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date ? date.getTime() : NaN;
  }
  if (value && Number.isFinite(Number(value.seconds))) {
    return Number(value.seconds) * 1000 + Number(value.nanoseconds || 0) / 1e6;
  }
  return NaN;
}

/**
 * Validate the full rank-based round robin while allowing completed fixtures
 * to retain the identity that actually played them. Only unfinished fixtures
 * must agree on the current participant for each rank.
 */
function validateRegistrationSchedule(matches, rank, currentBotId, teamsPerGroup = 8) {
  if (!Array.isArray(matches) || matches.length !== teamsPerGroup * (teamsPerGroup - 1) ||
      !Number.isInteger(Number(rank)) || Number(rank) < 1 || Number(rank) > teamsPerGroup ||
      typeof currentBotId !== 'string' || !currentBotId) return false;

  const coordinates = new Set();
  const appearancesByRank = new Map();
  const currentParticipantByRank = new Map();

  for (const match of matches) {
    const homeId = String(match && match.homeId || '');
    const awayId = String(match && match.awayId || '');
    const homeRank = Number(match && match.homeRank);
    const awayRank = Number(match && match.awayRank);

    if (!homeId || !awayId || homeId === awayId ||
        !Number.isInteger(homeRank) || !Number.isInteger(awayRank) ||
        homeRank < 1 || homeRank > teamsPerGroup ||
        awayRank < 1 || awayRank > teamsPerGroup ||
        homeRank === awayRank) return false;

    const coordinate = `${homeRank}>${awayRank}`;
    if (coordinates.has(coordinate)) return false;
    coordinates.add(coordinate);

    for (const teamRank of [homeRank, awayRank]) {
      appearancesByRank.set(teamRank, (appearancesByRank.get(teamRank) || 0) + 1);
    }

    if (isCompletedMatch(match)) continue;

    for (const [id, teamRank] of [[homeId, homeRank], [awayId, awayRank]]) {
      if (currentParticipantByRank.has(teamRank) && currentParticipantByRank.get(teamRank) !== id) {
        return false;
      }
      currentParticipantByRank.set(teamRank, id);
    }
  }

  const currentIds = [...currentParticipantByRank.values()];
  return coordinates.size === teamsPerGroup * (teamsPerGroup - 1) &&
    appearancesByRank.size === teamsPerGroup &&
    [...appearancesByRank.values()].every(count => count === 2 * (teamsPerGroup - 1)) &&
    currentParticipantByRank.get(Number(rank)) === currentBotId &&
    new Set(currentIds).size === currentIds.length;
}

/**
 * Move the existing standings row from the temporary bot identity to the new
 * user identity without resetting any season-to-date sporting statistics.
 */
function transferBotStandingToUser(stats, botId, userId, clubName, rank) {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats) ||
      !botId || !userId || botId === userId || Object.prototype.hasOwnProperty.call(stats, userId)) {
    return { ok: false, reason: 'LEAGUE_TABLE_SLOT_CONFLICT' };
  }

  const botRow = stats[botId];
  const rowsAtRank = Object.entries(stats).filter(([, row]) => Number(row && row.rank) === Number(rank));
  if (!botRow || botRow.isBot !== true || Number(botRow.rank) !== Number(rank) ||
      rowsAtRank.length !== 1 || rowsAtRank[0][0] !== botId) {
    return { ok: false, reason: 'LEAGUE_TABLE_SLOT_CONFLICT' };
  }

  const nextStats = { ...stats };
  delete nextStats[botId];
  nextStats[userId] = {
    ...botRow,
    id: userId,
    name: clubName,
    rank: Number(rank),
    isBot: false,
  };
  return { ok: true, stats: nextStats, transferredRow: { ...botRow } };
}

/**
 * Prepare only future fixture rewrites. A completed match is historical evidence
 * and is never changed. A due or processing fixture blocks registration until
 * the canonical match resolver has settled it.
 */
function buildRegistrationMatchPlan(matches, botId, userId, clubName, nowMs = Date.now()) {
  if (!Array.isArray(matches) || !Number.isFinite(nowMs)) {
    return { ok: false, reason: 'LEAGUE_SCHEDULE_SLOT_CONFLICT', updates: [] };
  }

  const updates = [];
  for (const match of matches) {
    if (isCompletedMatch(match)) continue;

    const involvesBot = match && (match.homeId === botId || match.awayId === botId);
    if (!involvesBot) continue;

    const status = String(match.status || '').toLowerCase();
    if (match.isProcessing === true || match.startedAt || match.processingStartedAt ||
        ['in_progress', 'in-progress', 'processing', 'resolving', 'running', 'live'].includes(status)) {
      return { ok: false, reason: 'SLOT_MATCH_IN_PROGRESS', matchId: match.id, updates: [] };
    }

    const startValue = match.startTime ?? match.scheduledStartAt;
    const startMs = timestampToMillis(startValue);
    if (startValue == null || !Number.isFinite(startMs)) {
      return { ok: false, reason: 'SLOT_MATCH_TIME_UNKNOWN', matchId: match.id, updates: [] };
    }
    if (startMs <= nowMs) {
      return { ok: false, reason: 'SLOT_MATCH_DUE', matchId: match.id, updates: [] };
    }

    const patch = {};
    if (match.homeId === botId) {
      patch.homeId = userId;
      patch.homeName = clubName;
      patch.homeLogo = null;
    }
    if (match.awayId === botId) {
      patch.awayId = userId;
      patch.awayName = clubName;
      patch.awayLogo = null;
    }
    if (Object.keys(patch).length) {
      updates.push({ matchId: match.id || null, patch });
    }
  }

  if (updates.length === 0) {
    return { ok: false, reason: 'NO_UPCOMING_FIXTURES_FOR_SLOT', updates: [] };
  }
  return { ok: true, updates };
}

module.exports = {
  isEligibleRegistrationSlot,
  validateRegistrationSchedule,
  generateStartingSquad,
  isCompletedMatch,
  timestampToMillis,
  transferBotStandingToUser,
  buildRegistrationMatchPlan,
};
