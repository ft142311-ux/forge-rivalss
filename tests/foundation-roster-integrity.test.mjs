import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  readFoundationRoster,
  readFoundationNonNegativeInteger,
  readFoundationStaff,
  readFoundationStaffMember,
  readFoundationStaffSalary,
} from '../src/game/foundation/guards.ts';

const root = new URL('../', import.meta.url);
const cycle = readFileSync(new URL('src/app/actions/foundation-cycle.ts', root), 'utf8');
const advanced = readFileSync(new URL('src/app/actions/foundation-advanced.ts', root), 'utf8');
const management = readFileSync(new URL('src/app/actions/foundation-management.ts', root), 'utf8');
const staff = readFileSync(new URL('src/app/actions/foundation-staff.ts', root), 'utf8');

function actionBlock(source, name) {
  const start = source.indexOf('export async function ' + name);
  assert.ok(start >= 0, 'missing action ' + name);
  const next = source.indexOf('\nexport async function ', start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

test('Foundation roster reader accepts empty, starter and bot rosters without rewriting them', () => {
  const empty = [];
  const starter = Array.from({ length: 10 }, (_, index) => ({ id: 'player-' + index }));
  const bots = Array.from({ length: 5 }, (_, index) => ({ id: 'bot-player-' + index }));
  assert.equal(readFoundationRoster(empty), empty);
  assert.equal(readFoundationRoster(starter), starter);
  assert.equal(readFoundationRoster(bots), bots);
});

test('Foundation roster reader rejects missing, malformed, duplicate and non-canonical player IDs', () => {
  for (const value of [undefined, null, {}, 'not-a-roster', [null], [[]], [{}],
    [{ id: '' }], [{ id: '   ' }], [{ id: ' player-1' }], [{ id: 'player-1 ' }],
    [{ id: 'player-1' }, { id: 'player-1' }], [{ id: 'player-1' }, { id: 2 }]]) {
    assert.throws(() => readFoundationRoster(value), /FOUNDATION_ROSTER_INVALID/);
  }
});

test('Foundation balance parser defaults only missing legacy values and rejects blank or unsafe balances', () => {
  assert.equal(readFoundationNonNegativeInteger(undefined, 'INVALID_BALANCE'), 0);
  assert.equal(readFoundationNonNegativeInteger(null, 'INVALID_BALANCE'), 0);
  assert.equal(readFoundationNonNegativeInteger(0, 'INVALID_BALANCE'), 0);
  assert.equal(readFoundationNonNegativeInteger('1250', 'INVALID_BALANCE'), 1250);
  for (const value of ['', ' ', '\t', true, {}, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => readFoundationNonNegativeInteger(value, 'INVALID_BALANCE'), /INVALID_BALANCE/);
  }
});

test('Foundation staff reader requires canonical identities, matching roles and positive payroll', () => {
  assert.deepEqual(readFoundationStaff(undefined), {});
  assert.deepEqual(readFoundationStaff(null), {});
  const analyst = { id: 'staff-analyst', role: 'analyst', salary: 1200 };
  assert.deepEqual(readFoundationStaff({ coach: null, analyst }), { coach: null, analyst });
  assert.deepEqual(readFoundationStaff({
    coach: null, analyst: null, scout: null, doctor: null, financier: null,
  }), { coach: null, analyst: null, scout: null, doctor: null, financier: null });

  for (const value of [
    'corrupt',
    [],
    { coach: 'not-a-staff-record' },
    { coach: [] },
    { coach: { id: 'staff-1', role: 'coach' } },
    { coach: { id: 'staff-1', role: 'coach', salary: 0 } },
    { coach: { id: 'staff-1', role: 'analyst', salary: 1200 } },
    { unknown: { id: 'staff-1', role: 'unknown', salary: 1200 } },
    { coach: { id: ' staff-1', role: 'coach', salary: 1200 } },
  ]) {
    assert.throws(() => readFoundationStaff(value), /FOUNDATION_STAFF_INVALID/);
  }

  // The aggregate reader preserves the more specific payroll error so callers
  // can distinguish corrupt salary data from an invalid staff shape.
  assert.throws(
    () => readFoundationStaff({ coach: { id: 'staff-1', role: 'coach', salary: ' ' } }),
    /FOUNDATION_SALARY_INVALID/,
  );

  const recruiterCandidate = { id: 'candidate-1', role: 'recruiter', salary: 5000 };
  assert.equal(readFoundationStaffMember(recruiterCandidate, 'recruiter'), recruiterCandidate);
  assert.throws(() => readFoundationStaffMember({ id: 'candidate-2', role: 'coach', salary: 5000 }, 'recruiter'), /FOUNDATION_STAFF_INVALID/);
  assert.throws(() => readFoundationStaffMember({ id: 'candidate-3', role: 'recruiter', salary: undefined }, 'recruiter'), /FOUNDATION_STAFF_INVALID/);

  assert.equal(readFoundationStaffSalary(undefined), 0);
  assert.equal(readFoundationStaffSalary(null), 0);
  assert.equal(readFoundationStaffSalary(1500), 1500);
  assert.equal(readFoundationStaffSalary('1500'), 1500);
  for (const value of ['', ' ', false, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => readFoundationStaffSalary(value), /FOUNDATION_SALARY_INVALID/);
  }
});

test('daily cycle and manual sync fail closed instead of replacing a corrupt roster with an empty array', () => {
  const processStart = cycle.indexOf('async function processManager');
  const processEnd = cycle.indexOf('\nexport async function runFoundationDailyCycle', processStart);
  const process = cycle.slice(processStart, processEnd);
  assert.match(process, /readFoundationRoster\(data\.ownedPlayers\)/);
  assert.ok(process.indexOf('readFoundationRoster(data.ownedPlayers)') < process.indexOf('t.update(ref, updates)'));
  const sync = actionBlock(cycle, 'syncFoundationForManager');
  assert.match(sync, /readFoundationRoster\(data\.ownedPlayers\)/);
  assert.ok(sync.indexOf('readFoundationRoster(data.ownedPlayers)') < sync.indexOf('t.update(ref'));
  assert.doesNotMatch(cycle, /Array\.isArray\(data\.ownedPlayers\)\s*\?\s*data\.ownedPlayers\s*:\s*\[\]/);
});

test('Foundation training, synergy, role and stats paths all use the canonical roster reader', () => {
  for (const name of [
    'setFoundationTrainingFocusAction',
    'completePlayerTrainingAction',
    'recalculateTeamSynergyAction',
    'changePlayerRoleAction',
    'getFoundationPlayerStatsAction',
  ]) {
    const action = actionBlock(management, name);
    assert.match(action, /readFoundationRoster\(/, name);
  }
  assert.doesNotMatch(management, /Array\.isArray\([^\n]*ownedPlayers[^\n]*\?[^\n]*\[\]/);
});

test('Foundation events and award scoring reject malformed rosters instead of silently skipping them', () => {
  const event = actionBlock(advanced, 'resolveFoundationEventAction');
  const award = actionBlock(advanced, 'resolveGoldenPlayerAwardAction');
  assert.match(event, /readFoundationRoster\(managerData\.ownedPlayers\)/);
  assert.ok(event.indexOf('readFoundationRoster(managerData.ownedPlayers)') < event.indexOf('t.update(managerRef'));
  assert.match(award, /readFoundationRoster\(managerData\.ownedPlayers\)/);
  assert.doesNotMatch(advanced, /Array\.isArray\([^\n]*ownedPlayers[^\n]*\?[^\n]*\[\]/);
});

test('Foundation staff and association debits share the strict persisted-balance parser', () => {
  assert.match(staff, /readFoundationNonNegativeInteger\(data\.credits, 'INVALID_BALANCE'\)/);
  assert.match(management, /readFoundationNonNegativeInteger\(data\.credits, 'INVALID_BALANCE'\)/);
  assert.match(management, /readFoundationNonNegativeInteger\(assoc\.treasury, 'INVALID_TREASURY_BALANCE'\)/);
});

test('daily cycle preserves an existing resolved event and never overwrites payroll receipts on a delayed retry', () => {
  const processStart = cycle.indexOf('async function processManager');
  const processEnd = cycle.indexOf('\nexport async function runFoundationDailyCycle', processStart);
  const process = cycle.slice(processStart, processEnd);
  const cycleRead = process.indexOf('t.get(cycleRef)');
  const eventRead = process.indexOf('t.get(eventRef)');
  const firstWrite = process.indexOf('t.update(ref, updates)');

  assert.ok(cycleRead >= 0 && cycleRead < firstWrite, 'cycle marker must be read before any writes');
  assert.ok(eventRead >= 0 && eventRead < firstWrite, 'existing event must be read before any writes');
  assert.doesNotMatch(process, /t\\.get\\((?:cycleRef|eventRef) as any\\)/, 'document references must retain DocumentSnapshot typing');
  assert.match(process, /const event = existingEventRecord\?\.event \|\| generatedEvent/);
  assert.match(process, /if \(event && !eventSnap\.exists\)\s*\{\s*t\.create\(eventRef/);
  assert.match(process, /t\.create\(cycleRef/);
  assert.match(process, /t\.create\(txRef/);
  assert.doesNotMatch(process, /t\.set\((?:cycleRef|txRef|eventRef)/);
  assert.doesNotMatch(process, /t\.set\(eventRef/);

  const resolver = actionBlock(advanced, 'resolveFoundationEventAction');
  assert.match(resolver, /if \(eventData\.resolvedAt\) return \{ alreadyResolved: true \}/);
  assert.match(resolver, /resolvedAt: FieldValue\.serverTimestamp\(\), applied: choice === 'accept'/);
});
