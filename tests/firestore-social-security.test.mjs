import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

test('retiring and retired accounts fail the shared Firestore signed-in gate', () => {
  const signedInRule = rules.match(/function signedIn\\(\\)\\s*\\{([\\s\\S]*?)\\n    \\}/);
  assert.ok(signedInRule, 'shared signed-in rule exists');
  assert.match(signedInRule[1], /inactive_club_retirements_v1/);
  assert.match(signedInRule[1], /inactive_clubs_v1/);
  assert.match(signedInRule[1], /!exists\\(/);
});

test('global chat Premium flag must match the authenticated manager profile', () => {
  const chatRule = rules.match(/match \/global_chat_v2\/{msgId}\s*\{([\s\S]*?)\n    \}/);
  assert.ok(chatRule, 'global chat rule exists');
  assert.match(chatRule[1], /request\.resource\.data\.isPremium\s*==\s*\([\s\S]*?players_v14\/\$\(request\.auth\.uid\)[\s\S]*?data\.isPremium\s*==\s*true/);
});

test('only the friend-request recipient can accept a pending request', () => {
  const friendRule = rules.match(/match \/friend_requests_v4\/{reqId}\s*\{([\s\S]*?)\n    \}/);
  assert.ok(friendRule, 'friend request rule exists');
  const updateRule = friendRule[1].match(/allow update: if([\s\S]*?);/);
  assert.ok(updateRule, 'friend request update rule exists');
  assert.match(updateRule[1], /request\.auth\.uid\s*==\s*resource\.data\.toId/);
  assert.match(updateRule[1], /request\.resource\.data\.status\s*==\s*'accepted'/);
  assert.doesNotMatch(updateRule[1], /request\.auth\.uid\s*==\s*resource\.data\.fromId/);
});

test('notifications are readable only by their recipient and never client-writable', () => {
  const notificationRule = rules.match(/match \/notifications_v7\/{notificationId}\s*\{([\s\S]*?)\n    \}/);
  assert.ok(notificationRule, 'notification rule exists');
  assert.match(notificationRule[1], /allow read: if signedIn\(\)\s*&&\s*resource\.data\.userId\s*==\s*request\.auth\.uid/);
  assert.match(notificationRule[1], /allow create, update, delete: if false/);
});
