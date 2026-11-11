import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const page = fs.readFileSync(new URL('src/app/associations/page.tsx', root), 'utf8');
const actions = fs.readFileSync(new URL('src/app/actions/associations.ts', root), 'utf8');
const rules = fs.readFileSync(new URL('firestore.rules', root), 'utf8');

test('association page routes every mutation through authenticated server actions', () => {
  assert.match(page, /createAssociationAction/);
  assert.match(page, /requestAssociationMembershipAction/);
  assert.match(page, /processAssociationRequestAction/);
  assert.match(page, /leaveAssociationAction/);
  assert.match(page, /kickAssociationMemberAction/);
  assert.match(page, /setAssociationDeputyAction/);
  assert.match(page, /disbandAssociationAction/);
  assert.doesNotMatch(page, /updateDocumentNonBlocking|setDocumentNonBlocking|writeBatch|arrayUnion|arrayRemove/);
});

test('association actions verify the authenticated actor and use Firestore transactions', () => {
  assert.match(actions, /requireServerActor/);
  assert.match(actions, /runTransaction/);
  assert.match(actions, /ownerId !== uid/);
  assert.match(actions, /deputyId !== uid/);
  assert.match(actions, /ASSOCIATION_JOIN_COOLDOWN/);
  assert.match(actions, /ASSOCIATION_LEAVE_COOLDOWN/);
  assert.match(actions, /INSUFFICIENT_CRYSTALS/);
});

test('association directory is signed-in readable but never client writable', () => {
  const match = rules.match(/match \/associations_v4\/\{associationId\} \{([\s\S]*?)\n    \}/);
  assert.ok(match, 'associations_v4 rule block exists');
  assert.match(match[1], /allow read: if signedIn\(\)/);
  assert.match(match[1], /allow create, update, delete: if false/);
});
