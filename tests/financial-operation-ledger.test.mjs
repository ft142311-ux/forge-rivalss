import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../src/app/', import.meta.url);
const finance = readFileSync(new URL('actions/finances-server.ts', root), 'utf8');
const staff = readFileSync(new URL('actions/foundation-staff.ts', root), 'utf8');
const management = readFileSync(new URL('actions/foundation-management.ts', root), 'utf8');
const schemas = readFileSync(new URL('lib/validation-schemas.ts', root), 'utf8');

test('generic financial operation scopes permanent idempotency and ledger to the user', () => {
  assert.match(finance, /financial_op_\$\{userId\}_\$\{idempotencyKey\}/);
  assert.match(finance, /financial_\$\{userId\}_\$\{idempotencyKey\}/);
  assert.match(finance, /transaction\.create\(ledgerRef/);
  assert.match(finance, /transaction\.create\(receiptRef/);
  assert.match(finance, /balanceBefore,[\s\S]*balanceAfter/);
  assert.doesNotMatch(finance, /expiresAt|Timestamp\.fromDate/);
  assert.match(schemas, /idempotencyKey: z\.string\(\)\.min\(10\)\.max\(128\)\.regex/);
});

test('foundation staff hire ledger captures balances for the atomic debit', () => {
  assert.match(staff, /type: 'STAFF_HIRE',[\s\S]*balanceBefore: balance,[\s\S]*balanceAfter: balance - cost/);
});

test('association treasury payment ledger captures balances for the atomic debit', () => {
  assert.match(management, /type: 'ASSOCIATION_PAYMENT',[\s\S]*balanceBefore: balance,[\s\S]*balanceAfter: balance - payment/);
});
