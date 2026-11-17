import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const staff = readFileSync(new URL('../src/app/actions/foundation-staff.ts', import.meta.url), 'utf8');
const management = readFileSync(new URL('../src/app/actions/foundation-management.ts', import.meta.url), 'utf8');
const finances = readFileSync(new URL('../src/app/actions/finances-server.ts', import.meta.url), 'utf8');

test('foundation staff hiring validates stored credits before charging or writing staff', () => {
  assert.match(staff, /function readCreditsBalance\(value: unknown\)/);
  assert.match(staff, /!Number\.isSafeInteger\(balance\) \|\| balance < 0/);
  const start = staff.indexOf('export async function hireFoundationStaffAction');
  const action = staff.slice(start);
  assert.ok(action.indexOf('readCreditsBalance(data.credits)') < action.indexOf('t.update(managerRef'));
});

test('association treasury payment rejects fractional amounts and malformed balances before writes', () => {
  const start = management.indexOf('export async function associationTreasuryPaymentAction');
  const end = management.indexOf('export async function listFoundationAssociationTournamentsAction', start);
  const action = management.slice(start, end);
  assert.match(action, /typeof amount !== 'number' \|\| !Number\.isSafeInteger\(amount\) \|\| amount <= 0/);
  assert.match(action, /readCreditsBalance\(data.credits\)/);
  assert.match(action, /readTreasuryBalance\(assoc.treasury\)/);
  assert.match(action, /!Number\.isSafeInteger\(treasuryAfter\)/);
  assert.ok(action.indexOf('readTreasuryBalance(assoc.treasury)') < action.indexOf('t.update(managerRef'));
  assert.doesNotMatch(action, /Math\.round\(Number\(amount/);
  assert.doesNotMatch(action, /Math\.max\(0, Number\(data\.credits/);
});

test('generic financial operation rejects boolean, fractional and unsafe stored balances', () => {
  assert.match(finances, /function readFinancialBalance\(value: unknown\)/);
  assert.match(finances, /typeof value === 'number' \|\| typeof value === 'string/);
  assert.match(finances, /!Number\.isSafeInteger\(balance\) \|\| balance < 0/);
  assert.match(finances, /readFinancialBalance\(player\[type\]\)/);
});
