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


test('staff candidate and hiring actions reject malformed persisted staff before writes', () => {
  const candidateStart = staff.indexOf('export async function getFoundationStaffCandidatesAction');
  const candidateEnd = staff.indexOf('export async function hireFoundationStaffAction', candidateStart);
  const candidateAction = staff.slice(candidateStart, candidateEnd);
  assert.match(candidateAction, /readFoundationStaff\(data\.staff\)/);
  assert.ok(candidateAction.indexOf('readFoundationStaff(data.staff)') < candidateAction.indexOf('t.create(candidateRef'));

  const hireStart = staff.indexOf('export async function hireFoundationStaffAction');
  const hireAction = staff.slice(hireStart);
  assert.match(hireAction, /readFoundationStaff\(data\.staff\)/);
  assert.ok(hireAction.indexOf('readFoundationStaff(data.staff)') < hireAction.indexOf('t.update(managerRef'));
});

test('Foundation role changes narrow external role strings to the canonical role union', () => {
  const start = management.indexOf('export async function changePlayerRoleAction');
  const end = management.indexOf('export async function getFoundationDailyEventAction', start);
  const action = management.slice(start, end);
  assert.match(management, /function parseFoundationRole\(value: unknown\): FoundationRole/);
  assert.match(action, /const role = parseFoundationRole\(roleValue\)/);
  assert.match(action, /currentRole: role/);
});


test('Foundation staff candidates are validated before being returned or hired', () => {
  const candidateStart = staff.indexOf('export async function getFoundationStaffCandidatesAction');
  const candidateEnd = staff.indexOf('export async function hireFoundationStaffAction', candidateStart);
  const candidateAction = staff.slice(candidateStart, candidateEnd);
  assert.match(candidateAction, /readFoundationStaffMember\(\s*\{ \.\.\.generateStaffMember/);
  assert.match(candidateAction, /readFoundationStaffMember\(existing\.candidate, role\)/);
  assert.ok(candidateAction.indexOf('readFoundationStaffMember(existing.candidate, role)') < candidateAction.indexOf('return { success: true'));

  const hireAction = staff.slice(candidateEnd);
  assert.match(hireAction, /readFoundationStaffMember\(candidateData\.candidate, role\)/);
  assert.ok(hireAction.indexOf('readFoundationStaffMember(candidateData.candidate, role)') < hireAction.indexOf('t.update(managerRef'));
  assert.match(hireAction, /candidateData\.userId !== uid \|\| candidateData\.role !== role \|\| candidateData\.day !== today/);
  assert.ok(hireAction.includes("doc('staff_hire_' + uid + '_' + today + '_' + role)"));
  assert.match(hireAction, /t\.create\(txRef/);
});

test('Foundation staff capacity and building gates reject malformed stored levels', () => {
  assert.match(staff, /readFoundationNonNegativeInteger\(rawLevel, 'FOUNDATION_HR_LEVEL_INVALID'\)/);
  assert.match(staff, /FOUNDATION_BUILDING_LEVEL_INVALID/);
});

test('player training validates persisted staff before granting the coach bonus', () => {
  const start = management.indexOf('export async function completePlayerTrainingAction');
  const end = management.indexOf('\nexport async function recalculateTeamSynergyAction', start);
  const action = management.slice(start, end);
  assert.match(action, /const staff = readFoundationStaff\(data\.staff\)/);
  assert.ok(action.indexOf('readFoundationStaff(data.staff)') < action.indexOf('const staffBonus = staff.coach'));
});
