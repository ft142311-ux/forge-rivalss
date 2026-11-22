import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const storage = readFileSync(new URL('../src/app/lib/match-storage.ts', import.meta.url), 'utf8');
const reportPage = readFileSync(new URL('../src/app/reports/page.tsx', import.meta.url), 'utf8');
const reportAction = readFileSync(new URL('../src/app/actions/match-report.ts', import.meta.url), 'utf8');

test('Pyramid Cup matches remain part of the global Match Overview report pipeline', () => {
  assert.match(storage, /cup: 'cup_matches'/);
  assert.match(storage, /MATCH_COLLECTIONS\.cup,/);
  assert.match(reportAction, /MATCH_REPORT_COLLECTIONS/);
  assert.match(reportPage, /collection\(db, 'cup_matches'\)/);
  assert.match(reportPage, /m\?\.type === 'cup' && m\?\.source === 'pyramid-cup'/);
  assert.match(reportPage, /const cup = personal/);
  assert.match(reportPage, /\.\.\.cup/);
});
