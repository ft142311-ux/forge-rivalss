import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { getTournamentRegistrationCapacity, getTournamentRegistrationWindow, isTournamentRegistrationOpen, normalizeTournamentRegisteredIds } from '../src/app/lib/tournament-registration-window.ts';

const window = {
  status: 'registration',
  registrationOpenAt: 1_000,
  registrationCloseAt: 2_000,
};

test('tournament registration opens inclusively at registrationOpenAt', () => {
  assert.equal(isTournamentRegistrationOpen(window, 999), false);
  assert.equal(isTournamentRegistrationOpen(window, 1_000), true);
  assert.equal(isTournamentRegistrationOpen(window, 1_999), true);
});

test('tournament registration closes exclusively at registrationCloseAt', () => {
  assert.equal(isTournamentRegistrationOpen(window, 2_000), false);
  assert.equal(isTournamentRegistrationOpen({ ...window, status: 'initializing' }, 1_500), false);
});

test('invalid registration window data fails closed', () => {
  for (const invalid of [
    { ...window, registrationOpenAt: undefined },
    { ...window, registrationOpenAt: null },
    { ...window, registrationOpenAt: '' },
    { ...window, registrationOpenAt: '   ' },
    { ...window, registrationOpenAt: 'invalid' },
    { ...window, registrationOpenAt: true },
    { ...window, registrationCloseAt: undefined },
    { ...window, registrationCloseAt: null },
    { ...window, registrationCloseAt: '' },
    { ...window, registrationCloseAt: 'invalid' },
    { ...window, registrationCloseAt: 1_000 },
  ]) {
    assert.equal(isTournamentRegistrationOpen(invalid, 1_500), false);
  }
});

test('registration window parser rejects absent and non-increasing timestamps', () => {
  assert.equal(getTournamentRegistrationWindow({ ...window, registrationOpenAt: null }), null);
  assert.equal(getTournamentRegistrationWindow({ ...window, registrationCloseAt: '' }), null);
  assert.equal(getTournamentRegistrationWindow({ ...window, registrationOpenAt: 2_000 }), null);
  assert.deepEqual(getTournamentRegistrationWindow(window), { opensAt: 1_000, closesAt: 2_000 });
});

test('server registration enforces both opening and closing boundaries inside its transaction', () => {
  const source = readFileSync(new URL('../src/app/actions/tournament-system.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export async function registerForTournamentAction');
  const end = source.indexOf('export async function unregisterFromTournamentAction', start);
  assert.ok(start >= 0 && end > start);
  const action = source.slice(start, end);
  assert.ok(action.includes('getTournamentRegistrationWindow(data)'));
  assert.ok(action.includes('getTournamentRegistrationCapacity(data.maxParticipants)'));
  assert.ok(action.includes('normalizeTournamentRegisteredIds(data.registeredIds)'));
  assert.ok(action.includes("if (!capacity) throw new Error('INVALID_TOURNAMENT_CAPACITY')"));
  assert.ok(action.includes('if (ids.length >= capacity) throw new Error(\'TOURNAMENT_FULL\')'));
  assert.ok(action.includes("if (!registrationWindow) throw new Error('REGISTRATION_WINDOW_INVALID')"));
  assert.ok(action.includes("if (now < registrationWindow.opensAt) throw new Error('REGISTRATION_NOT_OPEN')"));
  assert.ok(action.includes("if (now >= registrationWindow.closesAt) throw new Error('REGISTRATION_CLOSED')"));
});

test('server unregistration validates the shared window and closes at its deadline', () => {
  const source = readFileSync(new URL('../src/app/actions/tournament-system.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export async function unregisterFromTournamentAction');
  const end = source.indexOf('async function initializeTournament', start);
  assert.ok(start >= 0 && end > start);
  const action = source.slice(start, end);
  assert.ok(action.includes('getTournamentRegistrationWindow(data)'));
  assert.ok(action.includes("if (!registrationWindow) throw new Error('REGISTRATION_WINDOW_INVALID')"));
  assert.ok(action.includes("if (Date.now() >= registrationWindow.closesAt) throw new Error('REGISTRATION_CLOSED')"));
});

test('open tournament catalog uses the validated registration window for visibility and badge state', () => {
  const source = readFileSync(new URL('../src/app/tournaments/open/page.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('getTournamentRegistrationWindow, isTournamentRegistrationOpen'));
  assert.ok(source.includes('window !== null && now < window.closesAt'));
  assert.ok(source.includes('const registrationOpen=isTournamentRegistrationOpen(t)'));
});

test('tournament detail page uses the same registration window helper', () => {
  const source = readFileSync(new URL('../src/app/tournaments/[id]/page.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes("import { isTournamentRegistrationOpen } from '@/app/lib/tournament-registration-window'"));
  assert.ok(source.includes('const registrationOpen=isTournamentRegistrationOpen(tournament)'));
});

test('tournament registration capacity accepts only supported numeric capacities', () => {
  assert.equal(getTournamentRegistrationCapacity(16), 16);
  assert.equal(getTournamentRegistrationCapacity(32), 32);
  for (const invalid of [undefined, null, '', '16', 0, 15, 17, 31, 33, 16.5, NaN, Infinity, true]) {
    assert.equal(getTournamentRegistrationCapacity(invalid), null);
  }
});

test('registered tournament IDs are trimmed, unique, and reject malformed entries', () => {
  assert.deepEqual(
    normalizeTournamentRegisteredIds([' manager-a ', 'manager-a', '', '  ', null, 7, 'manager-b']),
    ['manager-a', 'manager-b'],
  );
  assert.deepEqual(normalizeTournamentRegisteredIds(null), []);
  assert.deepEqual(normalizeTournamentRegisteredIds('manager-a'), []);
});

test('server unregistration normalizes participant IDs before removing the manager', () => {
  const source = readFileSync(new URL('../src/app/actions/tournament-system.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export async function unregisterFromTournamentAction');
  const end = source.indexOf('async function initializeTournament', start);
  const action = source.slice(start, end);
  assert.ok(action.includes('normalizeTournamentRegisteredIds(data.registeredIds)'));
});

test('tournament initialization rejects invalid capacities and over-capacity rosters without truncation', () => {
  const source = readFileSync(new URL('../src/app/actions/tournament-system.ts', import.meta.url), 'utf8');
  const start = source.indexOf('async function initializeTournament');
  const end = source.indexOf('async function participantSnapshot', start);
  assert.ok(start >= 0 && end > start);
  const initialization = source.slice(start, end);
  assert.ok(initialization.includes('getTournamentRegistrationCapacity(tournament.maxParticipants)'));
  assert.ok(initialization.includes('if (!maxParticipants) throw new Error(\'INVALID_TOURNAMENT_CAPACITY\')'));
  assert.ok(initialization.includes('normalizeTournamentRegisteredIds(tournament.registeredIds)'));
  assert.ok(initialization.includes('if (registeredIds.length > maxParticipants)'));
  assert.doesNotMatch(initialization, /registeredIds\s*=.*\.slice\(0,\s*maxParticipants\)/);
});
