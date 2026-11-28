import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/trial-match-resolver.ts', import.meta.url), 'utf8');

test('every trial match write transaction is fenced against the Season 1 reset marker', () => {
  const transactions = (source.match(/runTransaction\(async/g) || []).length;
  const fences = (source.match(/await assertStagingSeasonOneResetNotInProgress\(/g) || []).length;

  assert.equal(transactions, 4, 'review the expected trial-match transaction count');
  assert.equal(fences, transactions, 'every trial-match transaction must read the reset marker');
  assert.match(source, /assertStagingSeasonOneResetNotInProgress.*staging-season-one-write-fence/);
});

test('trial match creation revalidates the authoritative profile inside its write transaction', () => {
  assert.match(source, /tx\.get\(profileRef\)/);
  assert.match(source, /TRIAL_PROFILE_CHANGED_RETRY/);
  assert.match(source, /JSON\.stringify\(currentProfile\.ownedPlayers/);
});
