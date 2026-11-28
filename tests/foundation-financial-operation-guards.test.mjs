import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const staff = readFileSync(new URL('../src/app/actions/foundation-staff.ts', import.meta.url), 'utf8');
const management = readFileSync(new URL('../src/app/actions/foundation-management.ts', import.meta.url), 'utf8');
const finances = readFileSync(new URL('../src/app/actions/finances-server.ts', import.meta.url), 'utf8');
const guards = readFileSync(new URL('../src/game/foundation/guards.ts', import.meta.url), 'utf8');

test('foundation staff hiring validates stored credits before charging or writing staff', () => {
  const start = staff.indexOf('export async function hireFoundationStaffAction');
  const action = staff.slice(start);
  const balanceRead = action.indexOf("readFoundationNonNegativeInteger(data.credits, 'INVALID_BALANCE')");
  assert.ok(balanceRead >= 0 && balanceRead < action.indexOf('t.update(managerRef'));
  assert.match(guards, /export function readFoundationNonNegativeInteger/);
});

test('association treasury payment rejects fractional amounts and malformed balances before writes', () => {
  const start = management.indexOf('export async function associationTreasuryPaymentAction');
  const end = management.indexOf('export async function listFoundationAssociationTournamentsAction', start);
  const action = management.slice(start, end);
  assert.match(action, /typeof amount !== 'number' \|\| !Number\.isSafeInteger\(amount\) \|\| amount <= 0/);
  assert.match(action, /readFoundationNonNegativeInteger\(data\.credits, 'INVALID_BALANCE'\)/);
  assert.match(action, /readFoundationNonNegativeInteger\(assoc\.treasury, 'INVALID_TREASURY_BALANCE'\)/);
  assert.match(action, /!Number\.isSafeInteger\(treasuryAfter\)/);
  assert.ok(action.indexOf("readFoundationNonNegativeInteger(assoc.treasury, 'INVALID_TREASURY_BALANCE')") < action.indexOf('t.update(managerRef'));
  assert.doesNotMatch(action, /Math\.round\(Number\(amount/);
  assert.doesNotMatch(action, /Math\.max\(0, Number\(data\.credits/);
});

test('generic financial operation rejects boolean, fractional and unsafe stored balances', () => {
  assert.match(finances, /function readFinancialBalance\(value: unknown\)/);
  assert.match(finances, /typeof value === 'number' \|\| typeof value === 'string'/);
  assert.match(finances, /!Number\.isSafeInteger\(balance\) \|\| balance < 0/);
  assert.match(finances, /readFinancialBalance\(player\[type\]\)/);
});
