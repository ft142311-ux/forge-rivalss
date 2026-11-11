'use strict';

/**
 * Shared registration invariants used by the legacy emulator callable and
 * the hosted Next.js registration endpoint.
 */

function isEligibleRegistrationSlot(slot, seasonNum) {
  return Boolean(slot) &&
    slot.status === 'FREE' &&
    !slot.occupantId &&
    Number(slot.season) === Number(seasonNum) &&
    Number.isInteger(Number(slot.division)) &&
    Number(slot.division) >= 1 &&
    Number(slot.division) <= 4;
}

function validateRegistrationSchedule(matches, rank, botId, teamsPerGroup = 8) {
  if (!Array.isArray(matches) ||
      matches.length !== teamsPerGroup * (teamsPerGroup - 1) ||
      !Number.isInteger(Number(rank)) ||
      Number(rank) < 1 ||
      Number(rank) > teamsPerGroup ||
      typeof botId !== 'string' ||
      !botId) return false;

  const coordinates = new Set();
  const participantByRank = new Map();
  const appearances = new Map();

  for (const match of matches) {
    const homeId = String(match?.homeId || '');
    const awayId = String(match?.awayId || '');
    const homeRank = Number(match?.homeRank);
    const awayRank = Number(match?.awayRank);

    if (!homeId || !awayId || homeId === awayId ||
        !Number.isInteger(homeRank) || !Number.isInteger(awayRank) ||
        homeRank < 1 || homeRank > teamsPerGroup ||
        awayRank < 1 || awayRank > teamsPerGroup ||
        homeRank === awayRank) return false;

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
    participantByRank.size === teamsPerGroup &&
    appearances.size === teamsPerGroup &&
    [...appearances.values()].every(count => count === 2 * (teamsPerGroup - 1)) &&
    participantByRank.get(Number(rank)) === botId;
}

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

module.exports = {
  isEligibleRegistrationSlot,
  validateRegistrationSchedule,
  generateStartingSquad,
};
