/**
 * Canonical stadium expansion pricing and duration for Forge-Rivals Beta.
 * A single project may add 500..50,000 seats in 500-seat increments.
 */
export const ARENA_BASE_CAPACITY = 3000;
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
const TIME_GROWTH = 1.0189100421169643;

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
  if (!Number.isSafeInteger(currentCapacity) || currentCapacity < ARENA_BASE_CAPACITY) {
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
    durationHours = Math.round(34 + 10 * geometricSum(TIME_GROWTH, terms));
  }

  return {
    seats,
    cost,
    durationHours,
    durationMs: durationHours * 60 * 60 * 1000,
    targetCapacity: currentCapacity + seats,
  };
}
