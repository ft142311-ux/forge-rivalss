/**
 * Canonical stadium expansion pricing and duration for Forge-Rivals Beta.
 * A single project may add 500..50,000 seats in 500-seat increments.
 */
export const ARENA_BASE_CAPACITY = 5000;
// Existing clubs created before the 5,000-seat baseline remain expandable without migration.
export const ARENA_MIN_SUPPORTED_CAPACITY = 3000;
export const ARENA_EXPANSION_STEP = 500;
export const ARENA_MAX_EXPANSION = 50000;

const INITIAL_STEPS = [
  { seats: 500, cost: 125000, hours: 6 },
  { seats: 1000, cost: 250000, hours: 12 },
  { seats: 1500, cost: 375000, hours: 18 },
  { seats: 2000, cost: 500000, hours: 24 },
  { seats: 2500, cost: 687500, hours: 34 },
] as const;

// Geometric progression calibrated to the approved 50,000-seat endpoint.
const PRICE_GROWTH = 1.039479044216737;
// Approved duration schedule for every 500-seat tier above the initial 2,500-seat range.
const EXTENDED_DURATION_HOURS = [
  44, 54, 64, 74, 85, 95, 106, 117, 128, 140,
  151, 163, 175, 188, 200, 213, 226, 240, 253, 267,
  281, 296, 311, 326, 341, 357, 373, 389, 405, 422,
  439, 457, 475, 493, 512, 531, 550, 570, 590, 610,
  631, 652, 674, 696, 719, 742, 765, 789, 813, 838,
  864, 889, 916, 943, 970, 998, 1026, 1055, 1085, 1115,
  1146, 1177, 1209, 1242, 1275, 1309, 1343, 1379, 1415, 1451,
  1488, 1527, 1565, 1605, 1645, 1686, 1728, 1771, 1815, 1859,
  1904, 1951, 1998, 2046, 2095, 2145, 2195, 2247, 2300, 2354,
  2409, 2465, 2522, 2581, 2640,
];

function geometricSum(ratio: number, terms: number): number {
  if (terms <= 0) return 0;
  return (Math.pow(ratio, terms) - 1) / (ratio - 1);
}

export type ArenaExpansionQuote = {
  seats: number;
  cost: number;
  durationHours: number;
  durationMs: number;
  targetCapacity: number;
};

export function getArenaExpansionQuote(seats: number, currentCapacity = ARENA_BASE_CAPACITY): ArenaExpansionQuote {
  if (!Number.isSafeInteger(seats) || seats < ARENA_EXPANSION_STEP || seats > ARENA_MAX_EXPANSION || seats % ARENA_EXPANSION_STEP !== 0) {
    throw new Error('INVALID_ARENA_EXPANSION_SIZE');
  }
  if (!Number.isSafeInteger(currentCapacity) || currentCapacity < ARENA_MIN_SUPPORTED_CAPACITY) {
    throw new Error('INVALID_ARENA_CAPACITY');
  }

  const initial = INITIAL_STEPS.find((step) => step.seats === seats);
  let cost: number;
  let durationHours: number;

  if (initial) {
    cost = initial.cost;
    durationHours = initial.hours;
  } else {
    const terms = seats / ARENA_EXPANSION_STEP - INITIAL_STEPS.length;
    cost = Math.round(687500 + 187500 * geometricSum(PRICE_GROWTH, terms));
    durationHours = EXTENDED_DURATION_HOURS[terms - 1];
  }

  return {
    seats,
    cost,
    durationHours,
    durationMs: durationHours * 60 * 60 * 1000,
    targetCapacity: currentCapacity + seats,
  };
}
