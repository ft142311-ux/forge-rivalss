import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'src/app/actions/autonomous-cycle.ts'), 'utf8');

test('salary sweep paginates the complete club collection by stable document ID', () => {
  assert.match(source, /const pageSize = 200;/);
  assert.match(source, /while\s*\(true\)\s*\{\s*let query = db\.collection\('players_v14'\)\s*\.orderBy\(FieldPath\.documentId\(\)\)\s*\.limit\(pageSize\);/);
  assert.match(source, /if \(cursor\) query = query\.startAfter\(cursor\);/);
  assert.match(source, /cursor = snap\.docs\[snap\.docs\.length - 1\];\s*if \(snap\.size < pageSize\) break;/);
  assert.doesNotMatch(source, /players_v14'\)\.limit\(500\)\.get\(\)/);
});

test('salary settlement keeps a deterministic per-club period ledger and transaction ID', () => {
  assert.match(source, /salary_\$\{playerDoc\.id\}_\$\{periodKey\}/);
  assert.match(source, /if \(txSnap\.exists\) return false;/);
  assert.match(source, /lastPaidAt: paidAt/);
});
