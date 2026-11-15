import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sourceUrl = new URL('../src/app/actions/season-calendar.ts', import.meta.url);

test('normal season publication and activation remain bound to the completed source archive', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const helperStart = source.indexOf('async function inspectRolloverPlanSourceArchive');
  const helperEnd = source.indexOf('function isPlanBoundToValidatedSourceArchive', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helper = source.slice(helperStart, helperEnd);
  assert.ok(helper.includes("plan?.mode === 'recovery_carry_forward'"));
  assert.ok(helper.includes('isCompletedSeasonArchive(archive)'));
  assert.ok(helper.includes('isSeasonArchiveReadyToComplete(archive, matches, plan)'));

  const publishStart = source.indexOf('export async function publishPreparedSeason');
  const activateStart = source.indexOf('export async function activatePublishedSeason');
  assert.ok(publishStart >= 0 && activateStart > publishStart);
  const publish = source.slice(publishStart, activateStart);
  assert.ok(publish.includes('await inspectRolloverPlanSourceArchive(db, plan)'));
  assert.ok(publish.includes('sourceArchiveValidation.valid'));
  assert.ok(publish.includes('isPlanBoundToValidatedSourceArchive(sourceArchiveValidation, candidate)'));
  assert.ok(publish.indexOf('sourceArchiveValidation.valid') < publish.indexOf('commitSeasonCalendarPublication'));

  const activate = source.slice(activateStart);
  assert.ok(activate.includes('await inspectRolloverPlanSourceArchive(db, activationPlan)'));
  assert.ok(activate.includes('sourceArchiveValidation.valid'));
  assert.ok(activate.includes('isPlanBoundToValidatedSourceArchive(sourceArchiveValidation, plan)'));
  assert.ok(activate.indexOf('sourceArchiveValidation.valid') < activate.indexOf('commitSeasonActivation'));
});
