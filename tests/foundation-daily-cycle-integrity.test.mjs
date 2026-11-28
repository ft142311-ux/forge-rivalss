import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  assertFoundationDailyEventRecord,
  assertFoundationDailyPayrollLedger,
} from '../src/game/foundation/daily-cycle-integrity.ts';

const cycle = readFileSync(new URL('../src/app/actions/foundation-cycle.ts', import.meta.url), 'utf8');
const advanced = readFileSync(new URL('../src/app/actions/foundation-advanced.ts', import.meta.url), 'utf8');
const management = readFileSync(new URL('../src/app/actions/foundation-management.ts', import.meta.url), 'utf8');

const unresolvedEvent = () => ({
  userId: 'manager-1',
  date: '2026-11-28',
  event: {
    id: 'team-morale',
    title: 'Team morale',
    description: 'The team morale improved.',
    effects: { form: 3, tilt: -3 },
  },
  applied: false,
  resolvedAt: null,
});

const validCycle = () => ({
  userId: 'manager-1',
  date: '2026-11-28',
  paid: 100,
  unpaid: 0,
  playerSalary: 80,
  staffSalary: 20,
  amountDue: 100,
  eventId: 'team-morale',
});

const validReceipt = () => ({
  userId: 'manager-1',
  periodKey: '2026-11-28',
  type: 'DAILY_SALARY',
  currency: 'credits',
  amount: -100,
  paid: 100,
  unpaid: 0,
  playerSalary: 80,
  staffSalary: 20,
  amountDue: 100,
  eventId: 'team-morale',
  balanceBefore: 500,
  balanceAfter: 400,
});

test('daily event validator accepts unresolved and consistently resolved event states', () => {
  assert.equal(assertFoundationDailyEventRecord(unresolvedEvent(), 'manager-1', '2026-11-28').applied, false);

  const accepted = {
    ...unresolvedEvent(),
    resolved: 'accept',
    applied: true,
    resolvedAt: new Date('2026-11-28T00:00:00.000Z'),
  };
  assert.equal(assertFoundationDailyEventRecord(accepted, 'manager-1', '2026-11-28').resolved, 'accept');

  const declined = {
    ...unresolvedEvent(),
    resolved: 'decline',
    applied: false,
    resolvedAt: new Date('2026-11-28T00:00:00.000Z'),
  };
  assert.equal(assertFoundationDailyEventRecord(declined, 'manager-1', '2026-11-28').applied, false);
});

test('daily event validator rejects ownership, payload and partial-resolution corruption', () => {
  const invalid = [
    { ...unresolvedEvent(), userId: 'another-manager' },
    { ...unresolvedEvent(), date: '2026-11-27' },
    { ...unresolvedEvent(), event: { ...unresolvedEvent().event, id: ' team-morale' } },
    { ...unresolvedEvent(), event: { ...unresolvedEvent().event, effects: { form: Number.NaN } } },
    { ...unresolvedEvent(), applied: true },
    { ...unresolvedEvent(), resolved: 'accept' },
    { ...unresolvedEvent(), resolvedAt: new Date('2026-11-28T00:00:00.000Z') },
    { ...unresolvedEvent(), resolved: 'accept', applied: false, resolvedAt: new Date('2026-11-28T00:00:00.000Z') },
    { ...unresolvedEvent(), resolved: 'decline', applied: true, resolvedAt: new Date('2026-11-28T00:00:00.000Z') },
  ];

  for (const record of invalid) {
    assert.throws(
      () => assertFoundationDailyEventRecord(record, 'manager-1', '2026-11-28'),
      /FOUNDATION_EVENT_RECORD_INVALID/,
    );
  }
});

test('daily payroll validator accepts a matching marker and receipt including balance delta', () => {
  assert.equal(
    assertFoundationDailyPayrollLedger(validCycle(), validReceipt(), 'manager-1', '2026-11-28'),
    true,
  );
});

test('daily payroll validator rejects missing, mismatched or financially inconsistent pairs', () => {
  assert.throws(
    () => assertFoundationDailyPayrollLedger(validCycle(), null, 'manager-1', '2026-11-28'),
    /FOUNDATION_PAYROLL_LEDGER_MISMATCH/,
  );

  const invalidPairs = [
    [ { ...validCycle(), userId: 'another-manager' }, validReceipt() ],
    [ validCycle(), { ...validReceipt(), periodKey: '2026-11-27' } ],
    [ validCycle(), { ...validReceipt(), type: 'TRANSFER' } ],
    [ validCycle(), { ...validReceipt(), amount: -99 } ],
    [ validCycle(), { ...validReceipt(), balanceAfter: 401 } ],
    [ validCycle(), { ...validReceipt(), balanceBefore: 99 } ],
    [ validCycle(), { ...validReceipt(), amountDue: 101 } ],
    [ validCycle(), { ...validReceipt(), unpaid: 1 } ],
    [ { ...validCycle(), paid: 99 }, validReceipt() ],
    [ { ...validCycle(), eventId: 'another-event' }, validReceipt() ],
    [ validCycle(), { ...validReceipt(), playerSalary: Number.MAX_SAFE_INTEGER } ],
  ];

  for (const [marker, receipt] of invalidPairs) {
    assert.throws(
      () => assertFoundationDailyPayrollLedger(marker, receipt, 'manager-1', '2026-11-28'),
      /FOUNDATION_PAYROLL_LEDGER_MISMATCH/,
    );
  }
});

test('daily cycle verifies marker, receipt and event before treating a retry as complete', () => {
  const start = cycle.indexOf('async function processManager');
  const end = cycle.indexOf('\nexport async function runFoundationDailyCycle', start);
  const process = cycle.slice(start, end);
  const firstWrite = process.search(/\bt\.(?:update|set|create|delete)\s*\(/);

  assert.match(process, /const \[cycleSnap, eventSnap, txSnap\]/);
  for (const read of ['t.get(cycleRef)', 't.get(eventRef)', 't.get(txRef)']) {
    assert.ok(process.indexOf(read) >= 0 && process.indexOf(read) < firstWrite, read + ' must precede writes');
  }
  assert.match(process, /if \(cycleSnap\.exists \|\| txSnap\.exists\)/);
  assert.match(process, /if \(!cycleSnap\.exists \|\| !txSnap\.exists\)/);
  assert.match(process, /assertFoundationDailyPayrollLedger\(cycleRecord, payrollRecord, ref\.id, periodKey\)/);
  assert.match(process, /FOUNDATION_DAILY_EVENT_LEDGER_MISMATCH/);
  assert.match(process, /assertFoundationDailyEventRecord\(eventSnap\.data\(\) \|\| \{\}, ref\.id, periodKey\)/);
  assert.match(process, /t\.create\(cycleRef/);
  assert.match(process, /t\.create\(txRef/);
});

test('event reads and resolutions reject malformed state before returning or applying effects', () => {
  const resolverStart = advanced.indexOf('export async function resolveFoundationEventAction');
  const resolverEnd = advanced.indexOf('\nexport async function foundationFanAction', resolverStart);
  const resolver = advanced.slice(resolverStart, resolverEnd);
  const validation = resolver.indexOf('assertFoundationDailyEventRecord(');
  const appliedEffects = resolver.indexOf('const effects = choice ===');
  assert.ok(validation >= 0 && validation < appliedEffects);
  assert.match(resolver, /eventData\.resolvedAt !== undefined && eventData\.resolvedAt !== null/);

  const getterStart = management.indexOf('export async function getFoundationDailyEventAction');
  const getterEnd = management.indexOf('\nexport async function getFoundationPlayerStatsAction', getterStart);
  const getter = management.slice(getterStart, getterEnd);
  assert.match(getter, /assertFoundationDailyEventRecord\(snap\.data\(\) \|\| \{\}, uid, period\)/);
});
