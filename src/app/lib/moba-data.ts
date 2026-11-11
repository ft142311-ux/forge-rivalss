export type Role = 'Tank' | 'Carry' | 'Support' | 'Midlaner' | 'Jungler';

export interface Player {
  id: string;
  name: string;
  role: Role;
  baseStats: {
    attack: number;
    defense: number;
    health: number;
    abilityPower: number;
    speed: number;
  };
  overallRating: number;
  abilitiesFocus: string;
  image: string;
  description: string;
  price: number;
  marketValue?: number;
  baseAge: number; 
  hiredAt: string;
  birthDate?: string;
  age: number;
  ageDisplay?: string;
  ageSystemVersion?: number;
  salary: number;
  form: number; 
  fatigue: number; 
  country: { code: string; name: string; flag: string };
  isInjured: boolean;
  injuredUntil?: string | null; 
  isPro?: boolean; 
  careerEndAge?: number; 
  trainingFocus?: string | null;
  dailyTrainingFocus?: string | null;
  dailyTrainingFinishTime?: string | null;
  onTransferUntil?: string | null; 
  transferMarketId?: string | null; 
  proStats: {
    lastHitting: number;
    mapAwareness: number;
    positioning: number;
    reflexes: number;
    manaManagement: number;
    objectiveControl: number;
    communication: number;
    tiltResistance: number;
    versatility: number;
    ganking: number;
  };
  proTalents: {
    lastHitting: number;
    mapAwareness: number;
    positioning: number;
    reflexes: number;
    manaManagement: number;
    objectiveControl: number;
    communication: number;
    tiltResistance: number;
    versatility: number;
    ganking: number;
  };
  xpStats?: Record<string, number>; 
  matchesPlayedToday?: number; 
  lastMatchDateXP?: string; 
  totalMatchesPlayed?: number; 
  moral?: number;
  currentRole?: Role;
  tilt?: number;
  tiltUntil?: string | null;
  suspensionUntil?: string | null;
  warningCount?: number;
  chemistryMatches?: number;
  trainingPropensity?: number;
  physical?: number;
  resilience?: number;
  lineupMatches?: number;
  trainingProgress?: Record<string, number>;
  skillCaps?: Record<string, number>;
  skillInclinations?: Record<string, number>;
  titles?: {
    league: number;
    cup: number;
    friendly: number;
  };
  seasonStats?: { matches?: number; wins?: number; successfulActions?: number; warnings?: number; disqualifications?: number; kills?: number; deaths?: number; assists?: number; postMatchRating?: number; };
  isYouth?: boolean;
}

export type StaffRole = 'coach' | 'analyst' | 'scout' | 'doctor' | 'financier';

export interface StaffMember {
  id: string;
  firstName: string;
  lastName: string;
  role: StaffRole;
  baseAge: number;
  hiredAt: string;
  salary: number;
  image: string;
  skills: {
    primary: number;   
    secondary: number; 
  };
}

const COUNTRY_PHOTOS: Record<string, { flag: string, name: string, url: string }> = {
  'DE': { flag: '🇩🇪', name: 'Германия', url: 'https://i.postimg.cc/PPS3QFFM/de-1.jpg' },
  'CN': { flag: '🇨🇳', name: 'Китай', url: 'https://i.postimg.cc/wvzKxSYS/1755011442109.jpg' },
  'RU': { flag: '🇷🇺', name: 'Россия', url: 'https://i.postimg.cc/mg3yfqj5/rus-2.jpg' },
  'UA': { flag: '🇺🇦', name: 'Украина', url: 'https://i.postimg.cc/X7fs4pYn/ua-1.jpg' },
  'KR': { flag: '🇰🇷', name: 'Южная Корея', url: 'https://i.postimg.cc/43mv7dsH/kr-1.jpg' },
  'BR': { flag: '🇧🇷', name: 'Бразилия', url: 'https://i.postimg.cc/Z5906yvS/br-1.jpg' },
  'TR': { flag: '🇹🇷', name: 'Турция', url: 'https://i.postimg.cc/MHvbRpyd/tr-1.jpg' }
};

const PLAYER_NAMES = [
  "Shadow", "Nova", "Cipher", "Apex", "Viper", "Echo", "Ghost", "Raptor", 
  "Titan", "Oracle", "Zenith", "Blaze", "Frost", "Static", "Wraith", 
  "Hunter", "Siren", "Falcon", "Grim", "Pulse", "Onyx", "Rogue", "Aero",
  "Blast", "Drift", "Flux", "Glint", "Haze", "Jolt", "Kite", "Lume", "Mist"
];

const FIRST_NAMES = ["James", "Robert", "John", "Michael", "David", "William", "Richard", "Joseph", "Thomas", "Charles", "Viktor", "Dmitry", "Hans", "Lee", "Chen", "Artyom"];
const LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Ivanov", "Petrov", "Schmidt", "Wang", "Kim", "Park", "Sokolov"];

const BOT_TEAM_NAMES = [
  "Neon Phantoms", "Cyber Guard", "Iron Titans", "Global Blitz", "Static Wraiths",
  "Delta Force", "Apex Hunters", "Void Walkers", "Cyber Synapse", "Rogue Unit"
];

class SeededRandom {
  private seed: number;
  constructor(seed: string | number) {
    if (typeof seed === 'string') {
      let hash = 0;
      for (let i = 0; i < seed.length; i++) {
        hash = ((hash << 5) - hash) + seed.charCodeAt(i);
        hash = hash & hash;
      }
      this.seed = Math.abs(hash);
    } else {
      this.seed = Math.abs(seed);
    }
  }
  next() {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }
  range(min: number, max: number) {
    const val = this.next();
    return Math.floor(val * (max - min + 1)) + min;
  }
}

function getRandomStat(min: number, max: number, rng?: SeededRandom) {
  if (rng) return rng.range(min, max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}


const PLAYER_GAME_YEAR_DAYS = 7;
const PLAYER_GAME_MONTHS = 12;
const PLAYER_GAME_YEAR_MS = PLAYER_GAME_YEAR_DAYS * 24 * 60 * 60 * 1000;
const PLAYER_GAME_MONTH_MS = PLAYER_GAME_YEAR_MS / PLAYER_GAME_MONTHS;

/** Random starting age in the game's month-based age format. */
function randomGameAge(minYears: number, maxYears: number, rng?: SeededRandom) {
  const years = getRandomStat(minYears, maxYears, rng);
  const month = getRandomStat(0, 12, rng);
  return { years, month, numeric: years + month / PLAYER_GAME_MONTHS, display: `${years}.${month}` };
}

/** Converts a game age into a birth timestamp so the age can advance from server time. */
function birthDateForGameAge(years: number, month: number, nowMs = Date.now()) {
  const ageMs = (years * PLAYER_GAME_YEAR_MS) + (month * PLAYER_GAME_MONTH_MS);
  return new Date(nowMs - ageMs).toISOString();
}


/** Canonical indicative market value. Actual transfer price is determined by the auction. */
export function calculatePlayerMarketValue(player: Pick<Player, 'overallRating' | 'proStats' | 'form' | 'fatigue' | 'role'> | any): number {
  const stats = player?.proStats && typeof player.proStats === 'object' ? Object.values(player.proStats).map(Number).filter(Number.isFinite) : [];
  const skillAverage = stats.length ? stats.reduce((a, b) => a + b, 0) / stats.length : Number(player?.overallRating || 0);
  const ovr = Math.max(0, Math.min(100, Number(player?.overallRating || skillAverage || 0)));
  const skillComponent = Math.max(0, Math.min(100, skillAverage));
  return Math.max(0, Math.round(ovr * 1200 + skillComponent * 800 + 40000));
}

export function generateVtunePlayer(seed?: string): Player {
  const rng = new SeededRandom(seed || Date.now());
  const startAge = randomGameAge(18, 30, rng);
  const age = startAge.numeric;
  const careerEnd = rng.range(30, 35);
  const birthDate = birthDateForGameAge(startAge.years, startAge.month);

  return {
    id: 'legend_vtune',
    name: 'V-Tune',
    role: 'Carry',
    baseStats: { attack: 15, defense: 5, health: 600, abilityPower: 10, speed: 320 },
    overallRating: 60,
    abilitiesFocus: 'Balanced',
    image: 'https://iili.io/CnasKk7.md.jpg',
    description: "Элитный украинский Керри. Легендарная сила на профессиональной арене.",
    price: 0,
    baseAge: age,
    hiredAt: new Date().toISOString(),
    birthDate,
    age: age,
    ageDisplay: startAge.display,
    ageSystemVersion: 5,
    careerEndAge: careerEnd,
    salary: 45000,
    form: 95,
    fatigue: 95,
    country: { code: 'UA', name: 'Украина', flag: '🇺🇦' },
    isInjured: false,
    isPro: true,
    isYouth: false,
    proStats: {
      lastHitting: 8, positioning: 7, reflexes: 8, tiltResistance: 7, versatility: 6,
      mapAwareness: 3, manaManagement: 2, objectiveControl: 4, communication: 3, ganking: 4,
    },
    proTalents: {
      lastHitting: 8, positioning: 7, reflexes: 8, tiltResistance: 7, versatility: 6,
      mapAwareness: 3, manaManagement: 2, objectiveControl: 4, communication: 3, ganking: 4
    },
    xpStats: {}, moral: 70, titles: { league: 0, cup: 0, friendly: 0 }
  };
}

export function generateUniquePlayer(role: Role, index: number, isStarter: boolean = false, seed?: string, isPro: boolean = false): Player {
  const rng = seed ? new SeededRandom(seed) : undefined;
  const codes = Object.keys(COUNTRY_PHOTOS);
  const codeIdx = rng ? rng.range(0, codes.length - 1) : Math.floor(Math.random() * codes.length);
  const code = codes[codeIdx] || 'RU';
  const country = COUNTRY_PHOTOS[code] || COUNTRY_PHOTOS['RU'];
  const nameIdx = rng ? rng.range(0, PLAYER_NAMES.length - 1) : Math.floor(Math.random() * PLAYER_NAMES.length);
  const name = `${PLAYER_NAMES[nameIdx]} ${index + 1}`;
  
  // Adult/first-team players start randomly at 18.0–30.12.
  const startAge = randomGameAge(18, 30, rng);
  const playerId = seed ? `p_det_${seed}` : `player_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 5)}`;

  // Принудительный диапазон 28-37 для стартового состава
  const baseOvr = isStarter ? getRandomStat(28, 37, rng) : 15;

  return {
    id: playerId,
    name,
    role,
    baseStats: { attack: 30, defense: 30, health: 800, abilityPower: 30, speed: 320 },
    overallRating: isPro ? 60 : baseOvr, 
    abilitiesFocus: 'Balanced',
    image: country.url,
    description: `Уникальный талант из страны: ${country.name}.`,
    price: 0,
    baseAge: startAge.numeric,
    hiredAt: new Date().toISOString(),
    birthDate: birthDateForGameAge(startAge.years, startAge.month),
    age: startAge.numeric,
    ageDisplay: startAge.display,
    ageSystemVersion: 5,
    careerEndAge: isPro ? 35 : 38,
    salary: isPro ? 25000 : 2500,
    form: isStarter ? 75 : 90,
    fatigue: isStarter ? 75 : 100,
    country: { code, name: country.name, flag: country.flag },
    isInjured: false,
    isYouth: false,
    proStats: {
      lastHitting: getRandomStat(10, 20, rng), mapAwareness: getRandomStat(10, 20, rng),
      positioning: getRandomStat(10, 20, rng), reflexes: getRandomStat(10, 20, rng),
      manaManagement: getRandomStat(10, 20, rng), objectiveControl: getRandomStat(10, 20, rng),
      communication: getRandomStat(10, 20, rng), tiltResistance: getRandomStat(10, 20, rng),
      versatility: getRandomStat(10, 20, rng), ganking: getRandomStat(10, 20, rng),
    },
    proTalents: {
      lastHitting: getRandomStat(35, 55, rng), mapAwareness: getRandomStat(35, 55, rng),
      positioning: getRandomStat(35, 55, rng), reflexes: getRandomStat(35, 55, rng),
      manaManagement: getRandomStat(35, 55, rng), objectiveControl: getRandomStat(35, 55, rng),
      communication: getRandomStat(35, 55, rng), tiltResistance: getRandomStat(35, 55, rng),
      versatility: getRandomStat(35, 55, rng), ganking: getRandomStat(35, 55, rng),
    },
    trainingProgress: {},
    skillCaps: {},
    skillInclinations: {},
    chemistryMatches: 0,
    lineupMatches: 0,
    tilt: 0,
    suspensionUntil: null,
    warningCount: 0
  };
}

export function generateScoutedPlayer(index: number, scoutLevel: number, seed?: string): Player {
  const rng = new SeededRandom(seed || `scout_v7_${Date.now()}_${index}`);
  const roles: Role[] = ['Tank', 'Carry', 'Midlaner', 'Jungler', 'Support'];
  const role = roles[rng.range(0, roles.length - 1)];
  const player = generateUniquePlayer(role, index, false, seed);
  const startAge = randomGameAge(14, 16, rng);
  player.baseAge = startAge.numeric;
  player.age = startAge.numeric;
  player.ageDisplay = startAge.display;
  player.ageSystemVersion = 5;
  player.birthDate = birthDateForGameAge(startAge.years, startAge.month);
  player.isYouth = true;
  return player;
}

export function generateStaffMember(role: StaffRole): StaffMember {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return {
    id: `staff_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
    firstName: first,
    lastName: last,
    role,
    baseAge: Math.floor(Math.random() * 30) + 25,
    hiredAt: new Date().toISOString(),
    salary: 5000 + Math.floor(Math.random() * 10000),
    image: `https://picsum.photos/seed/${Math.random()}/200/200`,
    skills: {
      primary: 10 + Math.floor(Math.random() * 20),
      secondary: 10 + Math.floor(Math.random() * 20)
    }
  };
}

export function generateBotSquad(targetOvr: number = 25): any[] {
  const roles: Role[] = ['Carry', 'Midlaner', 'Tank', 'Jungler', 'Support'];
  const countryCodes = Object.keys(COUNTRY_PHOTOS);

  return roles.map((role, idx) => {
    const val = Math.max(23, Math.min(27, Math.floor(targetOvr - 1 + Math.random() * 3))); 
    const nameSeed = Math.floor(Math.random() * PLAYER_NAMES.length);
    const countryIdx = Math.floor(Math.random() * countryCodes.length);
    const countryCode = countryCodes[countryIdx];
    
    const name = PLAYER_NAMES[nameSeed];
    const image = COUNTRY_PHOTOS[countryCode].url;
    
    const skillBase = Math.max(20, Math.min(27, val + Math.floor(Math.random() * 5) - 2));

    return {
      name: name,
      role: role,
      overallRating: val,
      image: image,
      proStats: { 
        lastHitting: skillBase, 
        mapAwareness: skillBase, 
        positioning: skillBase, 
        reflexes: skillBase, 
        manaManagement: skillBase, 
        objectiveControl: skillBase, 
        communication: skillBase, 
        tiltResistance: skillBase, 
        versatility: skillBase, 
        ganking: skillBase 
      },
      isSub: false
    };
  });
}

export function getRandomBotTeamName(): string {
  return BOT_TEAM_NAMES[Math.floor(Math.random() * BOT_TEAM_NAMES.length)];
}

/**
 * Генерирует сбалансированный стартовый состав из 10 игроков.
 * По 2 игрока на каждую роль для обеспечения основного состава и запаса.
 */
export function getRandomStartingSquad(): Player[] {
  const roles: Role[] = [
    'Carry', 'Midlaner', 'Tank', 'Jungler', 'Support', // 1-я пятерка
    'Carry', 'Midlaner', 'Tank', 'Jungler', 'Support'  // 2-я пятерка (дублеры)
  ];
  return roles.map((role, i) => generateUniquePlayer(role, i, true, `starter_${Date.now()}_${i}`));
}
