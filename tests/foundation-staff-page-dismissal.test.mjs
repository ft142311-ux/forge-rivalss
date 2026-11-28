import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../src/app/staff/page.tsx', import.meta.url), 'utf8');

test('staff page only dismisses the exact member shown and requires explicit confirmation', () => {
  assert.match(page, /dismissFoundationStaffAction/);
  assert.ok(page.includes('staffId: member.id'), 'confirmation captures the rendered staff ID');
  assert.ok(page.includes('dismissTarget.staffId'), 'server action receives the captured staff ID');
  assert.ok(page.includes('dismissTarget.role'), 'server action receives the captured role');
  assert.match(page, /Dialog open=\{!!dismissTarget\}/);
  assert.match(page, /variant="destructive"/);
  assert.ok(page.includes('setDismissTarget(null)'), 'cancel and successful dismissal close the dialog');
});

test('staff page uses canonical staff validation and HR capacity rules', () => {
  assert.match(page, /readFoundationStaff\(staff\)/);
  assert.match(page, /staffCapacity\(hq\)/);
  assert.match(page, /readFoundationNonNegativeInteger\(hq\?\.hrLevel/);
  assert.ok(page.includes('staffDataError ?'), 'corrupt staff or HR data disables the roster controls');
  assert.ok(page.includes('FOUNDATION_STAFF_INVALID'));
});
