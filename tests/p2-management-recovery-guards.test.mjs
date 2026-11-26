import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/app/actions/p2-management.ts', import.meta.url), 'utf8');

test('fatigue recovery refuses to charge when the player is already fully rested', () => {
  const creditsStart = source.indexOf('export async function recoverPlayerFatigueCreditsAction');
  const crystalsStart = source.indexOf('export async function recoverPlayerFatigueCrystalsAction');
  const formStart = source.indexOf('export async function boostPlayerFormAction');
  const credits = source.slice(creditsStart, crystalsStart);
  const crystals = source.slice(crystalsStart, formStart);
  assert.match(credits, /FATIGUE_ALREADY_FULL/);
  assert.match(crystals, /FATIGUE_ALREADY_FULL/);
  assert.ok(credits.indexOf('FATIGUE_ALREADY_FULL') < credits.indexOf('manager: { credits: balance - PLAYER_ACTION_COSTS.fatigueCredits }'));
  assert.ok(crystals.indexOf('FATIGUE_ALREADY_FULL') < crystals.indexOf('manager: { crystals: balance - PLAYER_ACTION_COSTS.fatigueCrystals }'));
});

test('form boost refuses to charge once the player has reached the form cap', () => {
  const start = source.indexOf('export async function boostPlayerFormAction');
  const end = source.indexOf('export async function healPlayerAction', start);
  const action = source.slice(start, end);
  assert.match(action, /FORM_ALREADY_MAX/);
  assert.ok(action.indexOf('FORM_ALREADY_MAX') < action.indexOf('manager: { credits: balance - PLAYER_ACTION_COSTS.formCredits }'));
});
