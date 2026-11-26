import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ageFromBirthDate,
  birthDateFromLegacyAge,
  resolvePlayerBirthDate,
} from '../src/app/lib/player-lifecycle-utils.ts';

const action = readFileSync(new URL('../src/app/actions/player-lifecycle.ts', import.meta.url), 'utf8');
const nowMs = Date.parse('2026-11-27T00:00:00.000Z');

test('current-version players retain a valid persisted birth date', () => {
  const birthDate = '2026-11-20T00:00:00.000Z';
  assert.equal(resolvePlayerBirthDate({ birthDate }, 18, nowMs, false), birthDate);
  assert.equal(ageFromBirthDate(birthDate, nowMs).numeric, 1);
});

test('invalid birth dates are repaired from legacy age even when the age-system version is current', () => {
  const repaired = resolvePlayerBirthDate({ birthDate: 'not-a-date' }, 18.5, nowMs, false);
  assert.notEqual(repaired, 'not-a-date');
  assert.equal(ageFromBirthDate(repaired, nowMs).numeric, 18.5);
});

test('missing and future birth dates are repaired instead of becoming epoch-age players', () => {
  const missing = resolvePlayerBirthDate({}, 21, nowMs, false);
  const future = resolvePlayerBirthDate({ birthDate: '2027-01-01T00:00:00.000Z' }, 21, nowMs, false);
  assert.equal(ageFromBirthDate(missing, nowMs).numeric, 21);
  assert.equal(ageFromBirthDate(future, nowMs).numeric, 21);
});

test('explicit age-system migrations continue to derive birth date from legacy age', () => {
  const legacyBirthDate = '2020-01-01T00:00:00.000Z';
  const migrated = resolvePlayerBirthDate({ birthDate: legacyBirthDate }, 19.25, nowMs, true);
  assert.notEqual(migrated, legacyBirthDate);
  assert.equal(ageFromBirthDate(migrated, nowMs).numeric, 19.25);
});

test('legacy age conversion defaults malformed ages safely and returns a valid ISO date', () => {
  const birthDate = birthDateFromLegacyAge(Number.NaN, nowMs);
  assert.equal(ageFromBirthDate(birthDate, nowMs).numeric, 18);
});

test('age calculation fails closed for invalid or future dates', () => {
  assert.throws(() => ageFromBirthDate('invalid', nowMs), /INVALID_PLAYER_BIRTH_DATE/);
  assert.throws(() => ageFromBirthDate('2027-01-01T00:00:00.000Z', nowMs), /INVALID_PLAYER_BIRTH_DATE/);
});

test('player lifecycle action repairs malformed birth dates before computing age', () => {
  assert.match(action, /resolvePlayerBirthDate\(player, currentAge, nowMs, needsMigration\)/);
  assert.match(action, /ageFromBirthDate\(birthDate, nowMs\)/);
});
