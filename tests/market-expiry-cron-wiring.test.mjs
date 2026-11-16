import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('five-minute Firebase schedule invokes the protected market-expiry route', () => {
  const functions = read('../functions/index.js');
  const scheduler = read('../functions/season-orchestrator-scheduler.js');
  const route = read('../src/app/api/cron/market-expiry/route.ts');

  const scheduledStart = functions.indexOf('exports.runMarketExpirySweep = functions');
  assert.notEqual(scheduledStart, -1);
  const scheduledBlock = functions.slice(scheduledStart);
  assert.match(scheduledBlock, /\.schedule\('every 5 minutes'\)/);
  assert.match(scheduledBlock, /invokeMarketExpirySweep\(/);
  assert.match(scheduledBlock, /process\.env\.SEASON_ORCHESTRATOR_URL/);
  assert.match(scheduledBlock, /process\.env\.CRON_SECRET/);

  assert.match(scheduler, /endpoint\.pathname = '\/api\/cron\/market-expiry'/);
  assert.match(route, /isCronAuthorized\(request\)/);
  assert.match(route, /runTransferMarketExpirySweep\(\)/);
  assert.match(route, /status: 503/);
});

test('auction settlement compatibility entry point delegates to the same idempotent sweep', () => {
  const actions = read('../src/app/actions/autonomous-cycle.ts');
  const settlementCore = read('../src/app/lib/auction-expiry-sweep.ts');
  const bidCore = read('../src/app/lib/auction-bid.ts');
  assert.match(
    actions,
    /export async function runPlayerAuctionSettlementSweep\(\)\s*\{\s*return runTransferMarketExpirySweep\(\);\s*\}/,
  );
  assert.match(actions, /export async function runTransferMarketExpirySweep\(\)/);
  assert.match(settlementCore, /export async function runTransferMarketExpirySweepWithDb\(db: any\)/);
  assert.match(bidCore, /export async function placeSpecialMarketBidWithDb\(/);
});

test('market expiry route fails closed when the sweep reports partial errors', () => {
  const route = read('../src/app/api/cron/market-expiry/route.ts');
  assert.match(route, /if \(result\.success === false\)/);
  assert.match(route, /NextResponse\.json\(\{ \.\.\.result, timestamp: new Date\(\)\.toISOString\(\) \}, \{ status: 503 \}\)/);
  assert.match(route, /catch \(error: any\)/);
  assert.match(route, /status: 500/);
});
