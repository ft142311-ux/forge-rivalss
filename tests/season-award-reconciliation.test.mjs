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
  let failAt = 3;

  const applyRecipient = async recipient => {
    if (failAt === 0) throw new Error('injected process interruption');
    const current = wallet.get(recipient.uid);
    if (current.ledger || current.award) {
      return { settled: true, prize: recipient.prize, trophy: recipient.trophy };
    }
    current.credits += recipient.prize;
    current.award = true;
    current.ledger = true;
    failAt--;
    return { settled: true, prize: recipient.prize, trophy: recipient.trophy };
  };

  await assert.rejects(
    () => applySeasonAwardRecipients(recipients, applyRecipient),
    /injected process interruption/,
  );
  assert.equal(wallet.get('club-a').credits, 1400);
  assert.equal(wallet.get('club-b').credits, 1300);
  assert.equal(wallet.get('club-c').credits, 1000);

  failAt = 0;
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
