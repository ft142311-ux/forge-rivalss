import test from 'node:test';
import assert from 'node:assert/strict';
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
