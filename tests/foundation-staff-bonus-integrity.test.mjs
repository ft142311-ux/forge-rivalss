import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { staffBonuses, staffCapacity } from '../src/game/foundation/staff.ts';

const emptyBonuses = {
  training: 0,
  match: 0,
  scouting: 0,
  youth: 0,
  injury: 0,
  recovery: 0,
  economy: 0,
};

const member = (id, role, salary = 1200) => ({ id, role, salary });

test('staff bonuses return zero for absent or explicitly vacant staff slots', () => {
  assert.deepEqual(staffBonuses(undefined), emptyBonuses);
  assert.deepEqual(staffBonuses(null), emptyBonuses);
  assert.deepEqual(staffBonuses({ coach: null, analyst: undefined }), emptyBonuses);
});

test('staff bonuses are granted only from validated hired staff records', () => {
  const staff = {
    recruiter: member('staff-recruiter', 'recruiter'),
    coach: member('staff-coach', 'coach'),
    analyst: member('staff-analyst', 'analyst'),
    scout: member('staff-scout', 'scout'),
    doctor: member('staff-doctor', 'doctor'),
    financier: member('staff-financier', 'financier'),
  };

  const bonuses = staffBonuses(staff);
  assert.equal(bonuses.scouting.toFixed(2), '0.15');
  assert.deepEqual({ ...bonuses, scouting: 0 }, {
    training: 0.08,
    match: 0.025,
    scouting: 0,
    youth: 0.08,
    injury: 0.12,
    recovery: 0.10,
    economy: 0.05,
  });
});

test('staff bonus calculation rejects malformed identities, role mismatches and payroll data', () => {
  for (const staff of [
    { coach: 'not-a-staff-record' },
    { coach: member('staff-1', 'analyst') },
    { coach: { id: 'staff-1', role: 'coach' } },
    { coach: { ...member('staff-1', 'coach'), salary: ' ' } },
    { unknown: member('staff-unknown', 'coach') },
    [],
  ]) {
    assert.throws(() => staffBonuses(staff), /FOUNDATION_(?:STAFF|SALARY)_INVALID/);
  }
});

test('staff capacity preserves legacy defaults and uses strict whole-number HR levels', () => {
  assert.equal(staffCapacity(undefined), 2);
  assert.equal(staffCapacity(null), 2);
  assert.equal(staffCapacity({}), 2);
  assert.equal(staffCapacity({ hrLevel: 0 }), 2);
  assert.equal(staffCapacity({ hrLevel: 1 }), 2);
  assert.equal(staffCapacity({ hrLevel: '3' }), 4);
});

test('staff capacity rejects malformed, fractional, negative and unsafe HR levels', () => {
  for (const hrLevel of ['', ' ', true, {}, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => staffCapacity({ hrLevel }),
      /FOUNDATION_HR_LEVEL_INVALID/,
      String(hrLevel),
    );
  }
});

const staffActionSource = readFileSync(new URL('../src/app/actions/foundation-staff.ts', import.meta.url), 'utf8');
const dailyCycleSource = readFileSync(new URL('../src/app/actions/foundation-cycle.ts', import.meta.url), 'utf8');

test('dismissal is identity-bound, transactional and idempotent without refunding credits', () => {
  const start = staffActionSource.indexOf('export async function dismissFoundationStaffAction');
  assert.ok(start >= 0, 'dismissal server action exists');
  const action = staffActionSource.slice(start);
  assert.match(action, /expectedStaffIdValue: string/);
  assert.match(action, /encodeURIComponent\(expectedStaffId\)/);
  assert.match(action, /history\.staffId !== expectedStaffId/);
  assert.match(action, /member\.id !== expectedStaffId\) throw new Error\('STAFF_CHANGED'\)/);
  assert.match(action, /if \(!current\) throw new Error\('STAFF_NOT_FOUND'\)/);
  assert.match(action, /alreadyDismissed:\s*true/);
  assert.match(action, /alreadyDismissed:\s*false/);
  assert.match(action, /salaryAtDismissal:\s*member\.salary/);
  assert.match(action, /event:\s*'dismissed'/);

  const fence = action.indexOf('assertStagingSeasonOneResetNotInProgress(t, db)');
  const managerRead = action.indexOf('t.get(managerRef)');
  const historyRead = action.indexOf('t.get(historyRef)');
  const historyWrite = action.indexOf('t.create(historyRef');
  const managerWrite = action.indexOf('t.update(managerRef');
  assert.ok(fence >= 0 && fence < managerRead);
  assert.ok(managerRead < managerWrite);
  assert.ok(historyRead < managerWrite, 'history is read before any write');
  assert.ok(managerWrite < historyWrite);
  assert.equal(action.includes('credits:'), false, 'dismissal does not alter the club balance');
});
test('a dismissed staff slot stops contributing bonuses, payroll and HR occupancy', () => {
  const before = {
    recruiter: member('staff-recruiter', 'recruiter'),
    coach: member('staff-coach', 'coach', 2400),
  };
  const after = { ...before, coach: null };
  const payroll = (value) => Object.values(value).reduce((sum, employee) => sum + (employee ? employee.salary : 0), 0);

  assert.equal(staffBonuses(before).training, 0.08);
  assert.equal(staffBonuses(after).training, 0);
  assert.equal(payroll(before), 3600);
  assert.equal(payroll(after), 1200);
  assert.equal(Object.values(before).filter(Boolean).length, 2);
  assert.equal(Object.values(after).filter(Boolean).length, 1);
  assert.match(dailyCycleSource, /if\s*\(!member\)\s*return sum/);
});

test('staff hiring and dismissal share the same canonical HR capacity calculation', () => {
  assert.match(staffActionSource, /import \{ staffCapacity \} from '@\/game\/foundation\/staff'/);
  assert.equal(staffActionSource.includes('function staffCapacity('), false);
  assert.match(staffActionSource, /staffCount\(staff\) >= staffCapacity\(data\.hq\)/);
});

