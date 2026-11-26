import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/shop.ts', import.meta.url), 'utf8');

test('renaming a club to its current normalized name does not charge crystals', () => {
  assert.match(source, /String\(data\.clubName \|\| ''\)\.trim\(\)\.replace\(\/\\s\+\/g, ' '\)\.toLowerCase\(\) === clean\.toLowerCase\(\)/);
  assert.match(source, /return \{ success: true, unchanged: true, clubName:/);
});

test('changing to the current country code does not charge crystals', () => {
  assert.match(source, /String\(data\.countryCode \|\| ''\)\.toUpperCase\(\) === parsed\.code\.toUpperCase\(\)/);
  assert.match(source, /return \{ success: true, unchanged: true, country:/);
});
