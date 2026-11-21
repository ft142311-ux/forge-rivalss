import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const action = readFileSync(new URL('../src/app/actions/global-chat.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../src/app/chats/global/page.tsx', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

test('global chat identity and club branding are derived from the authenticated server profile', () => {
  assert.match(action, /requireServerActor\(idToken\)/);
  assert.match(action, /collection\('players_v14'\)\.doc\(actor\.uid\)/);
  assert.match(action, /userId:\s*actor\.uid/);
  assert.match(action, /userName:\s*displayName/);
  assert.match(action, /clubName,/);
  assert.match(action, /clubLogo,/);
  assert.match(action, /isPremium,/);
  assert.match(action, /createdAt\s*=\s*new Date\(\)\.toISOString\(\)/);
});

test('global chat client sends only message text through the server action', () => {
  assert.match(page, /sendGlobalChatMessageAction\(await user\.getIdToken\(\), message\)/);
  assert.doesNotMatch(page, /addDoc\(collection\(db,\s*'global_chat_v2'/);
});

test('Firestore blocks all client-side global chat writes', () => {
  const start = rules.indexOf('match /global_chat_v2/{msgId}');
  const end = rules.indexOf('\n    }', start);
  assert.ok(start >= 0 && end > start);
  const block = rules.slice(start, end);
  assert.match(block, /allow read: if signedIn\(\)/);
  assert.match(block, /allow create, update, delete: if false/);
  assert.doesNotMatch(block, /allow create: if signedIn/);
});
