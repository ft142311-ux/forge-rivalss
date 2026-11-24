import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const route = readFileSync(new URL('../src/app/api/league/table/route.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/app/rankings/page.tsx', import.meta.url), 'utf8');

test('league standings server read requires a verified active Firebase actor', () => {
  assert.match(route, /requireServerActor\(match\[1\]\)/);
  assert.match(route, /verify|requireServerActor/);
  assert.match(route, /export async function POST/);
});

test('league standings server read validates league coordinates and returns only public fields', () => {
  assert.match(route, /getGroupsCountInLevel\(level\)/);
  assert.match(route, /level > MAX_LEVELS/);
  assert.match(route, /const publicFields = \['id', 'name', 'clubLogo', 'rank', 'matchesPlayed', 'wins', 'draws', 'losses', 'points', 'diff'\]/);
  assert.doesNotMatch(route, /roster|tactics|credits|salary|privateKey/i);
});

test('rankings page no longer reads league standings directly under Firestore client rules', () => {
  assert.match(page, /fetch\('\/api\/league\/table'/);
  assert.doesNotMatch(page, /doc\(db, ['"]league_tables_v2['"]/);
});
