import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/api/cron/tournaments/route.ts', import.meta.url), 'utf8');

test('tournament cron response reflects failures from both tournament engines', () => {
  assert.match(source, /const success = result\?\.success !== false && pyramidCup\?\.success !== false/);
  assert.match(source, /status: success \? 200 : 207/);
  assert.match(source, /\{ timestamp: new Date\(\)\.toISOString\(\), \.\.\.result, pyramidCup, success \}/);
});
