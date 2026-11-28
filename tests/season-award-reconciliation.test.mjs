import test from 'node:test';
import assert from 'node:assert/strict';
import { applySeasonAwardRecipients, classifySeasonAwardState } from '../src/app/actions/season-award-reconciliation.ts';

test('classifies award and ledger as consistent', () => {
  assert.equal(classifySeasonAwardState({ prize: 100 }, { amount: 100 }), 'AWARD_AND_LEDGER');
});

test('classifies award without ledger without performing repair', () => {
  assert.equal(classifySeasonAwardState({ prize: 100 }, null), 'AWARD_WITHOUT_LEDGER');
});

test('classifies ledger without award without retrying payout', () => {
  assert.equal(classifySeasonAwardState(null, { amount: 100 }), 'LEDGER_WITHOUT_AWARD');
});

test('classifies absence of both markers', () => {
  assert.equal(classifySeasonAwardState(null, null), 'NEITHER');
});


test('partial reward failure retries without double credit and reports stable season totals', async () => {
  const recipients = [
    { uid: 'club-a', prize: 400, trophy: true },
    { uid: 'club-b', prize: 300, trophy: false },
    { uid: 'club-c', prize: 200, trophy: false },
  ];
  const wallet = new Map(recipients.map(item => [item.uid, { credits: 1000, award: false, ledger: false }]));
  let successfulWritesBeforeFailure = 2;
  let injectFailure = true;

  const applyRecipient = async recipient => {
    if (injectFailure && successfulWritesBeforeFailure === 0) {
      injectFailure = false;
      throw new Error('injected process interruption');
    }
    const current = wallet.get(recipient.uid);
    if (current.ledger || current.award) {
      return { settled: true, prize: recipient.prize, trophy: recipient.trophy };
    }
    current.credits += recipient.prize;
    current.award = true;
    current.ledger = true;
    if (injectFailure) successfulWritesBeforeFailure--;
    return { settled: true, prize: recipient.prize, trophy: recipient.trophy };
  };

  await assert.rejects(
    () => applySeasonAwardRecipients(recipients, applyRecipient),
    /injected process interruption/,
  );
  assert.equal(wallet.get('club-a').credits, 1400);
  assert.equal(wallet.get('club-b').credits, 1300);
  assert.equal(wallet.get('club-c').credits, 1000);

  const retried = await applySeasonAwardRecipients(recipients, applyRecipient);
  assert.deepEqual(retried, {
    ready: true,
    rewardedClubs: 3,
    totalCredits: 900,
    trophiesAwarded: 1,
  });
  assert.equal(wallet.get('club-a').credits, 1400);
  assert.equal(wallet.get('club-b').credits, 1300);
  assert.equal(wallet.get('club-c').credits, 1200);
  assert.equal([...wallet.values()].filter(item => item.ledger).length, 3);
});

test('missing recipient profile blocks reward publication without losing prior settlements', async () => {
  const recipients = [
    { uid: 'club-paid', prize: 500 },
    { uid: 'club-missing', prize: 250 },
  ];
  const result = await applySeasonAwardRecipients(recipients, async recipient => {
    if (recipient.uid === 'club-missing') return { settled: false, prize: recipient.prize, missingProfile: true };
    return { settled: true, prize: recipient.prize };
  });
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'SEASON_AWARD_PLAYER_PROFILE_MISSING');
  assert.equal(result.rewardedClubs, 1);
  assert.equal(result.totalCredits, 500);
  assert.deepEqual(result.missingProfileUids, ['club-missing']);
});


test('production rollover delegates per-recipient settlement to retry-stable accounting', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/app/actions/season-rollover.ts', import.meta.url), 'utf8');
  assert.ok(source.includes("import { applySeasonAwardRecipients } from './season-award-reconciliation'"));
  assert.ok(source.includes('return applySeasonAwardRecipients(recipients, async recipient =>'));
  assert.ok(source.includes("if (recipientState === 'ALREADY_APPLIED')"));
  assert.ok(source.includes('return { settled: true, prize, trophy: Boolean(isChampion || isPyramidWinner) }'));
  assert.ok(source.includes('return { settled: false, prize, trophy: false, missingProfile: true }'));
});

test('split reward markers block completion and identify affected clubs without retrying payment', async () => {
  const recipients = [
    { uid: 'club-consistent', prize: 500 },
    { uid: 'club-award-only', prize: 250 },
    { uid: 'club-ledger-only', prize: 100 },
  ];
  const states = {
    'club-consistent': { award: true, ledger: true },
    'club-award-only': { award: true, ledger: false },
    'club-ledger-only': { award: false, ledger: true },
  };
  const calls = [];
  const result = await applySeasonAwardRecipients(recipients, async recipient => {
    calls.push(recipient.uid);
    const state = states[recipient.uid];
    if (state.award !== state.ledger) {
      return { settled: false, prize: recipient.prize, accountingConflict: true };
    }
    return { settled: true, prize: recipient.prize };
  });

  assert.equal(result.ready, false);
  assert.equal(result.reason, 'SEASON_AWARD_LEDGER_CONFLICT');
  assert.equal(result.accountingConflictCount, 2);
  assert.deepEqual(result.accountingConflictUids, ['club-award-only', 'club-ledger-only']);
  assert.equal(result.rewardedClubs, 1);
  assert.equal(result.totalCredits, 500);
  assert.deepEqual(calls, recipients.map(item => item.uid));
});

test('every production award settlement path blocks rollover plan publication on accounting conflicts', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/app/actions/season-rollover.ts', import.meta.url), 'utf8');
  const calls = [...source.matchAll(/const awards = await applySeasonAwards\(db,[^;]+;/g)];
  assert.equal(calls.length, 4, 'all archive creation and recovery paths must use the same award gate');

  for (const call of calls) {
    const tail = source.slice(call.index + call[0].length, call.index + call[0].length + 350);
    assert.match(tail, /if \(!awards\.ready\)\s*\{\s*return \{ ready: false, reason: awards\.reason/);
    assert.match(tail, /awards/);
  }
});


test('production season awards reject unsafe balances and repair trophy data without replaying credits', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/app/actions/season-rollover.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('resolveSeasonAwardBalance(player.credits, prize)'));
  assert.ok(source.includes('if (!balance)'));
  assert.ok(source.includes('credits: balance.balanceAfter'));
  assert.ok(source.includes('balanceBefore: balance.balanceBefore'));
  assert.ok(source.includes('balanceAfter: balance.balanceAfter'));
  assert.ok(source.includes('resolveSeasonAwardTrophyState('));
  assert.ok(source.includes('if (recipientState === \'ALREADY_APPLIED\')'));
  const replayStart = source.indexOf("if (recipientState === 'ALREADY_APPLIED')");
  const replayEnd = source.indexOf('const balance = resolveSeasonAwardBalance', replayStart);
  const replay = source.slice(replayStart, replayEnd);
  assert.match(replay, /if \(persistTrophies\)/);
  assert.match(replay, /t\.update\(playerRef, \{ trophies,/);
  assert.doesNotMatch(replay, /credits:/);
});

test('season award trophy collection corruption blocks settlement rather than replacing trophies with an empty array', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/app/actions/season-rollover.ts', import.meta.url), 'utf8');
  assert.match(source, /const trophyState = resolveSeasonAwardTrophyState\([\s\S]*?if \(!trophyState\)\s*\{\s*return \{ settled: false, prize, trophy: false, accountingConflict: true \};/);
  assert.doesNotMatch(source, /Array\.isArray\(player\.trophies\) \? player\.trophies : \[\]/);
});

test('season award replay with a ledger but deleted player profile does not attempt a profile update', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/app/actions/season-rollover.ts', import.meta.url), 'utf8');
  assert.match(source, /recipientState === 'ALREADY_APPLIED' && !playerSnap\.exists/);
  const start = source.indexOf("if (recipientState === 'ALREADY_APPLIED' && !playerSnap.exists)");
  const end = source.indexOf('const trophyState = resolveSeasonAwardTrophyState', start);
  const missingProfileReplay = source.slice(start, end);
  assert.match(missingProfileReplay, /return \{ settled: true, prize, trophy:/);
  assert.doesNotMatch(missingProfileReplay, /t\.update\(playerRef/);
});
