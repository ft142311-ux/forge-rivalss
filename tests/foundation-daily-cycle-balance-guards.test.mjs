import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cycle = readFileSync(new URL('../src/app/actions/foundation-cycle.ts', import.meta.url), 'utf8');
const economy = readFileSync(new URL('../src/game/foundation/economy.ts', import.meta.url), 'utf8');
const guards = readFileSync(new URL('../src/game/foundation/guards.ts', import.meta.url), 'utf8');

test('daily player salary accepts only safe non-negative integer amounts and totals', () => {
  assert.match(economy, /Number\.isSafeInteger\(salary\) \|\| salary < 0/);
  assert.match(economy, /Number\.isSafeInteger\(total\)/);
  assert.match(economy, /FOUNDATION_SALARY_INVALID/);
});

test('daily foundation cycle validates roster, staff payroll and balances before transaction writes', () => {
  const start = cycle.indexOf('const grossPlayerSalary = calculateDailyPlayerSalary(players)');
  const action = cycle.slice(start);
  const staffRead = action.indexOf('readFoundationStaff(data.staff)');
  const staffSalaryRead = action.indexOf('readFoundationStaffSalary(member.salary)');
  const totalGuard = action.indexOf("if (!Number.isSafeInteger(totalDue) || totalDue < 0)");
  const balanceRead = action.indexOf("readFoundationNonNegativeInteger(data.credits, 'FOUNDATION_BALANCE_INVALID')");
  const firstWrite = action.indexOf('t.update(ref, updates)');
  assert.ok(staffRead >= 0 && staffSalaryRead > staffRead && totalGuard > staffSalaryRead &&
    balanceRead > totalGuard && firstWrite > balanceRead);
  assert.match(action, /readFoundationRoster\(data\.ownedPlayers\)/);
  assert.match(action, /readFoundationNonNegativeInteger\(data\.crystals, 'FOUNDATION_BALANCE_INVALID'\)/);
  assert.match(guards, /Number\.isSafeInteger\(parsed\) \|\| parsed < 0/);
  assert.match(guards, /value\.trim\(\)\.length === 0/);
});

test('foundation player salary normalization does not preserve fractional legacy salaries', () => {
  assert.match(cycle, /Number\.isSafeInteger\(salary\) && salary > 0 \? salary : calculateSalary\(normalized\)/);
});
