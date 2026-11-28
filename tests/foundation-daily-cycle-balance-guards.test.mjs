import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  calculateDailyPlayerSalary,
  resolveFoundationPlayerSalary,
} from '../src/game/foundation/economy.ts';
import { calculateSalary } from '../src/game/foundation/player-system.ts';

const cycle = readFileSync(new URL('../src/app/actions/foundation-cycle.ts', import.meta.url), 'utf8');
const guards = readFileSync(new URL('../src/game/foundation/guards.ts', import.meta.url), 'utf8');

const player = (salary, overrides = {}) => ({
  id: 'player-1',
  role: 'Support',
  currentRole: 'Support',
  age: 20,
  form: 100,
  fatigue: 100,
  salary,
  proStats: {},
  proTalents: {},
  ...overrides,
});

test('daily player salary accepts canonical safe integer amounts and totals', () => {
  assert.equal(resolveFoundationPlayerSalary(player(1200)), 1200);
  assert.equal(resolveFoundationPlayerSalary(player('1250')), 1250);
  assert.equal(calculateDailyPlayerSalary([player(1200), player(1300)]), 2500);
  assert.equal(calculateDailyPlayerSalary([player('1200'), player('1300')]), 2500);

  for (const salary of [undefined, null, 0, '0']) {
    assert.equal(
      resolveFoundationPlayerSalary(player(salary)),
      calculateSalary(player(undefined)),
    );
  }
});

test('daily player salary rejects corrupt values and unsafe aggregate totals', () => {
  for (const salary of [
    '', ' ', ' 1200', '1200 ', '-1', '1.5', -1, 1.5, true, {},
    Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.throws(
      () => resolveFoundationPlayerSalary(player(salary)),
      /FOUNDATION_SALARY_INVALID/,
      String(salary),
    );
  }

  assert.throws(
    () => calculateDailyPlayerSalary([player(Number.MAX_SAFE_INTEGER), player(1)]),
    /FOUNDATION_SALARY_INVALID/,
  );
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
  assert.match(cycle, /readFoundationRoster\(data\.ownedPlayers\)/);
  assert.match(action, /readFoundationNonNegativeInteger\(data\.crystals, 'FOUNDATION_BALANCE_INVALID'\)/);
  assert.match(guards, /Number\.isSafeInteger\(parsed\) \|\| parsed < 0/);
  assert.match(guards, /value\.trim\(\)\.length === 0/);
});

test('daily player normalization uses the strict salary resolver instead of repairing corrupt values', () => {
  const start = cycle.indexOf('function normalizePlayers');
  const end = cycle.indexOf('async function processManager', start);
  const normalize = cycle.slice(start, end);
  assert.ok(normalize.includes('resolveFoundationPlayerSalary(normalized as any)'));
  assert.ok(!normalize.includes('calculateSalary(normalized)'));
});
