import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

const helper = read('src/app/actions/foundation-manager-ref.ts');

test('foundation manager references use the canonical collection helper', () => {
  assert.match(helper, /db\.collection\(FOUNDATION_COLLECTIONS\.managers\)\.doc\(uid\)/);

  const modules = [
    ['src/app/actions/foundation-management.ts', 13],
    ['src/app/actions/foundation-staff.ts', 2],
    ['src/app/actions/foundation-cycle.ts', 1],
  ];

  for (const [path, expectedCalls] of modules) {
    const source = read(path);
    assert.match(
      source,
      /import\s*\{\s*getFoundationManagerRef\s*\}\s*from\s*['"]\.\/foundation-manager-ref['"]/
    );
    assert.equal(
      source.split('getFoundationManagerRef(db, uid)').length - 1,
      expectedCalls,
      `${path} should use the canonical helper at every manager-document access`
    );
    assert.doesNotMatch(
      source,
      /db\.collection\(FOUNDATION_COLLECTIONS\.managers\)\.doc\(uid\)/,
      `${path} must not construct manager document references directly`
    );
  }
});

test('foundation cycle paginates the complete manager collection', () => {
  const cycle = read('src/app/actions/foundation-cycle.ts');
  assert.match(cycle, /orderBy\(FieldPath\.documentId\(\)\)\.limit\(pageSize\)/);
  assert.match(cycle, /query\.startAfter\(cursor\)/);
  assert.match(cycle, /failed: errors\.length/);
});
