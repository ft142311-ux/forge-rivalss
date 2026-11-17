import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cycle = readFileSync(new URL('../src/app/actions/foundation-cycle.ts', import.meta.url), 'utf8');
const economy = readFileSync(new URL('../src/game/foundation/economy.ts', import.meta.url), 'utf8');

test('daily player salary accepts only safe non-negative integer amounts and totals', () => {
  assert.match(economy, /Number\.isSafeInteger\(salary\) \|\| salary < 0/);
  assert.match(economy, /Number\.isSafeInteger\(total\)/);
  assert.match(economy, /FOUNDATION_SALARY_INVALID/);
});

test('daily foundation cycle validates staff salary and aggregate due before transaction writes', () => {
  const start = cycle.indexOf('const grossPlayerSalary = calculateDailyPlayerSalary(players)');
  const action = cycle.slice(start);
  const staffGuard = action.indexOf("throw new Error('FOUNDATION_SALARY_INVALID')");
  const totalGuard = action.indexOf("if (!Number.isSafeInteger(totalDue) || totalDue < 0)");
  const balanceGuard = action.indexOf("throw new Error('FOUNDATION_BALANCE_INVALID')");
  const firstWrite = action.indexOf('t.update(ref, updates)');
  assert.ok(staffGuard >= 0 && totalGuard > staffGuard && balanceGuard > totalGuard && firstWrite > balanceGuard);
  assert.match(action, /Number\.isSafeInteger\(salary\) \|\| salary < 0/);
  assert.match(action, /Number\.isSafeInteger\(before\) \|\| before < 0/);
});

test('foundation player salary normalization does not preserve fractional legacy salaries', () => {
  assert.match(cycle, /Number\.isSafeInteger\(salary\) && salary > 0 \? salary : calculateSalary\(normalized\)/);
});
