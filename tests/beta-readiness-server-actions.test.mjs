import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const store = read('../src/app/lib/store.tsx');
const trialAction = read('../src/app/actions/trial-match-resolver.ts');
const proPage = read('../src/app/transfers/pro/page.tsx');
const youthTransferPage = read('../src/app/youth-academy/transfers/page.tsx');
const youthSquadPage = read('../src/app/youth-academy/squad/page.tsx');
const specialMarketAction = read('../src/app/actions/pro-market.ts');
const settlement = read('../src/app/actions/autonomous-cycle.ts');

function blockBetween(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `missing block start: ${start}`);
  const to = source.indexOf(end, from);
  assert.notEqual(to, -1, `missing block end: ${end}`);
  return source.slice(from, to);
}

test('trial match creation is server-authoritative and the client no longer queries all managers', () => {
  const clientTrial = blockBetween(store, 'const runTrialMatch = useCallback', '// Keep world-sync callbacks');
  assert.match(clientTrial, /createTrialMatchAction\(idToken\)/);
  assert.doesNotMatch(clientTrial, /getDocs\(|setDoc\(|collection\(db, 'players_v14'\)/);
  assert.match(trialAction, /export async function createTrialMatchAction/);
  assert.match(trialAction, /tx\.create\(matchRef/);
  assert.match(trialAction, /requireServerActor\(idToken\)/);
});

test('PRO and youth market mutations are routed through authenticated server actions', () => {
  assert.match(proPage, /placeProMarketBidAction/);
  assert.match(proPage, /ensureProMarketDailyDropAction/);
  assert.doesNotMatch(proPage, /setDoc\(doc\(db, 'market_v7'/);
  assert.match(youthTransferPage, /placeYouthMarketBidAction/);
  assert.doesNotMatch(youthTransferPage, /updateDoc\(doc\(db, 'market_v7'/);
  assert.match(youthSquadPage, /listYouthPlayerOnMarketAction/);
  assert.doesNotMatch(youthSquadPage, /setDoc\(doc\(db, 'market_v7'/);
});

test('special market server actions validate market type and authoritative balance', () => {
  assert.match(specialMarketAction, /lot\.isPro === true && lot\.currency === 'crystals'/);
  assert.match(specialMarketAction, /lot\.isYouth === true/);
  assert.match(specialMarketAction, /bidder\[currency\]/);
  assert.match(specialMarketAction, /SPECIAL_AUCTION_BID_ESCROW/);
  assert.match(specialMarketAction, /SPECIAL_AUCTION_OUTBID_REFUND/);
  assert.match(specialMarketAction, /AUCTION_ESCROW_MISMATCH/);
  assert.match(specialMarketAction, /requireServerActor\(idToken\)/);
});

test('auction settlement supports system PRO lots and youth player arrays', () => {
  assert.match(settlement, /isSystemAuctionSeller\(sellerId, lot\.isSystem\)/);
  assert.match(settlement, /resolveAuctionCurrency\(lot\.currency\)/);
  assert.match(settlement, /lot\.isYouth === true \? 'youthAcademyPlayers' : 'ownedPlayers'/);
  assert.match(settlement, /hasValidEscrow/);
  assert.match(settlement, /SPECIAL_AUCTION_SETTLEMENT_REFUND/);
});

test('legacy tournament routes redirect to the canonical daily tournament catalog', () => {
  for (const route of ['iron-kettle', 'iron-brick', 'iron-globe']) {
    const source = read(`../src/app/tournaments/${route}/page.tsx`);
    assert.match(source, /redirect\('\/tournaments\/open'\)/);
  }
});
