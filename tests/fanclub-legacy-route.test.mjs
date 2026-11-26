import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/fanclub/page.tsx', import.meta.url), 'utf8');

test('legacy fanclub route redirects to the server-backed fans experience', () => {
  assert.match(source, /import \{ redirect \} from 'next\/navigation'/);
  assert.match(source, /redirect\('\/fans'\)/);
  assert.doesNotMatch(source, /setTimeout\(/);
  assert.doesNotMatch(source, /launchFanCampaign/);
  assert.doesNotMatch(source, /season_1/);
  assert.doesNotMatch(source, /leagues_v2/);
});
