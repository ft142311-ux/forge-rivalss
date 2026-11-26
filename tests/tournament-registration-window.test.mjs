import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { getTournamentRegistrationWindow, isTournamentRegistrationOpen } from '../src/app/lib/tournament-registration-window.ts';

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

test('tournament detail page uses the same registration window helper', () => {
  const source = readFileSync(new URL('../src/app/tournaments/[id]/page.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes("import { isTournamentRegistrationOpen } from '@/app/lib/tournament-registration-window'"));
  assert.ok(source.includes('const registrationOpen=isTournamentRegistrationOpen(tournament)'));
});
