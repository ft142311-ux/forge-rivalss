'use strict';

const {
  isEligibleRegistrationSlot,
  validateRegistrationSchedule,
} = require('./league-integrity');

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

module.exports = {
  isEligibleRegistrationSlot,
  validateRegistrationSchedule,
  generateStartingSquad,
};
