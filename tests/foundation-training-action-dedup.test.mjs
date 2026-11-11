import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const advanced = readFileSync(resolve(root, 'src/app/actions/foundation-advanced.ts'), 'utf8');
const management = readFileSync(resolve(root, 'src/app/actions/foundation-management.ts'), 'utf8');

test('foundation-advanced keeps its legacy action export but delegates to the canonical action', () => {
  assert.match(
    advanced,
    /import\s*\{\s*setFoundationTrainingFocusAction\s+as\s+setFoundationTrainingFocusActionCanonical\s*\}\s*from\s*['"]\.\/foundation-management['"]/
  );
  assert.match(
    advanced,
    /export\s+async\s+function\s+setFoundationTrainingFocusAction\s*\([^)]*\)\s*\{\s*return\s+setFoundationTrainingFocusActionCanonical\(idToken,\s*playerId,\s*skill\);\s*\}/
  );
  assert.doesNotMatch(
    advanced,
    /export\s+async\s+function\s+setFoundationTrainingFocusAction[\s\S]*?\.update\(\{\s*ownedPlayers/
  );
});

test('canonical foundation training action validates input and writes transactionally', () => {
  const actionStart = management.indexOf('export async function setFoundationTrainingFocusAction');
  const actionEnd = management.indexOf('\nexport async function ', actionStart + 1);
  assert.notEqual(actionStart, -1, 'canonical action export must exist');

  const action = management.slice(actionStart, actionEnd === -1 ? undefined : actionEnd);
  assert.match(action, /isFoundationSkill\(skill\)/);
  assert.match(action, /db\.runTransaction\(async\s+t\s*=>/);
  assert.match(action, /t\.update\(ref,\s*\{\s*ownedPlayers/);
});
