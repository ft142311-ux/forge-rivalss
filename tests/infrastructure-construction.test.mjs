import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getConstructionStartBlocker,
  getNextConstructionLevel,
  resolveConstructionFinalization,
} from '../src/app/lib/infrastructure-construction.ts';

const nowMs = 1_800_000_000_000;

test('valid due facility construction finalizes exactly one level', () => {
  const result = resolveConstructionFinalization({
    section: 'arena',
    id: 'cafeLevel',
    finish: new Date(nowMs - 1).toISOString(),
    currentValue: 2,
    targetValue: 3,
    nowMs,
  });
  assert.deepEqual(result, { due: true, target: 3 });
});

test('future facility construction remains pending after its state is validated', () => {
  const result = resolveConstructionFinalization({
    section: 'academy',
    id: 'youthBootcampLevel',
    finish: new Date(nowMs + 60_000).toISOString(),
    currentValue: 0,
    targetValue: 1,
    nowMs,
  });
  assert.deepEqual(result, { due: false, target: 1 });
});

test('malformed construction timestamps fail closed instead of completing immediately', () => {
  assert.throws(() => resolveConstructionFinalization({
    section: 'arena',
    id: 'cafeLevel',
    finish: 'not-a-date',
    currentValue: 2,
    targetValue: 3,
    nowMs,
  }), /INVALID_CONSTRUCTION_STATE/);
});

test('a corrupted target level cannot skip or roll back an upgrade', () => {
  for (const targetValue of [2, 4, -1, 1.5, '']) {
    assert.throws(() => resolveConstructionFinalization({
      section: 'arena',
      id: 'cafeLevel',
      finish: new Date(nowMs - 1).toISOString(),
      currentValue: 2,
      targetValue,
      nowMs,
    }), /INVALID_CONSTRUCTION_STATE/);
  }
});

test('legacy arena capacity can finish a valid 500-seat expansion', () => {
  const result = resolveConstructionFinalization({
    section: 'arena',
    id: 'capacity',
    finish: new Date(nowMs - 1).toISOString(),
    currentValue: 3000,
    targetValue: 3500,
    nowMs,
  });
  assert.deepEqual(result, { due: true, target: 3500 });
});

test('capacity finalization rejects invalid seat increments and missing targets', () => {
  for (const targetValue of [3550, 3000, 55500, null]) {
    assert.throws(() => resolveConstructionFinalization({
      section: 'arena',
      id: 'capacity',
      finish: new Date(nowMs - 1).toISOString(),
      currentValue: 5000,
      targetValue,
      nowMs,
    }), /INVALID_CONSTRUCTION_STATE/);
  }
});

test('unknown infrastructure fields are never finalized into player state', () => {
  assert.throws(() => resolveConstructionFinalization({
    section: 'arena',
    id: 'credits',
    finish: new Date(nowMs - 1).toISOString(),
    currentValue: 100,
    targetValue: 101,
    nowMs,
  }), /INVALID_CONSTRUCTION_STATE/);
});

test('finalization accepts Firestore-style timestamp objects', () => {
  const result = resolveConstructionFinalization({
    section: 'medical',
    id: 'massageLevel',
    finish: { toDate: () => new Date(nowMs - 1) },
    currentValue: 0,
    targetValue: undefined,
    nowMs,
  });
  assert.deepEqual(result, { due: true, target: 1 });
});

test('arena UI uses the canonical baseline for missing capacity values', async () => {
  const { readFile } = await import('node:fs/promises');
  const page = await readFile(new URL('../src/app/training/arena/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /arena\?\.capacity \?\? ARENA_BASE_CAPACITY/);
  assert.match(page, /currentArenaCapacity\.toLocaleString\(\)/);
  assert.doesNotMatch(page, /arena\?\.capacity \|\| 3000/);
});

test('exact maximum arena expansion remains valid at 50,000 additional seats', () => {
  const result = resolveConstructionFinalization({
    section: 'arena',
    id: 'capacity',
    finish: new Date(nowMs - 1).toISOString(),
    currentValue: 5000,
    targetValue: 55000,
    nowMs,
  });
  assert.deepEqual(result, { due: true, target: 55000 });
});

test('new construction is blocked until an expired project has been finalized', () => {
  assert.equal(getConstructionStartBlocker({}, nowMs), null);
  assert.equal(
    getConstructionStartBlocker({ cafeLevel: new Date(nowMs + 1000).toISOString() }, nowMs),
    'CONSTRUCTION_ALREADY_IN_PROGRESS',
  );
  assert.equal(
    getConstructionStartBlocker({ cafeLevel: new Date(nowMs - 1000).toISOString() }, nowMs),
    'CONSTRUCTION_COMPLETION_PENDING',
  );
  assert.throws(
    () => getConstructionStartBlocker({ cafeLevel: 'invalid' }, nowMs),
    /INVALID_CONSTRUCTION_STATE/,
  );
});

test('construction start validates current level before calculating a charge', () => {
  assert.equal(getNextConstructionLevel(undefined), 1);
  assert.equal(getNextConstructionLevel(2), 3);
  for (const current of [-1, 1.5, Number.NaN, '', Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => getNextConstructionLevel(current), /INVALID_CONSTRUCTION_STATE/);
  }
});

test('expired or malformed construction cannot be accelerated for crystals', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/app/actions/infrastructure.ts', import.meta.url), 'utf8');
  assert.match(source, /if \(resolution\.due\) throw new Error\('CONSTRUCTION_COMPLETION_PENDING'\)/);
  assert.match(source, /getConstructionFinishMillis\(finish\) - now/);
  assert.match(source, /getConstructionStartBlocker\(finishes, now\)/);
});
