import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/api/league/cup/route.ts', import.meta.url), 'utf8');

test('Pyramid Cup API accepts any nonempty bearer token without excluding token characters', () => {
  assert.ok(source.includes("authorization.match(/^Bearer\\s+(\\S+)$/i)"));
  assert.doesNotMatch(source, /\[\^\\\\s\]/);

  const token = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.segment.with.s.lowercase.signature';
  const match = ('Bearer ' + token).match(/^Bearer\s+(\S+)$/i);
  assert.equal(match?.[1], token);
});

test('Pyramid Cup API authenticates the actor before reading the Cup document', () => {
  const auth = source.indexOf('await requireServerActor(token)');
  const database = source.indexOf('const db = getAdminDb()');
  assert.ok(auth >= 0 && database > auth);
  assert.match(source, /Cache-Control': 'no-store, max-age=0'/);
});
