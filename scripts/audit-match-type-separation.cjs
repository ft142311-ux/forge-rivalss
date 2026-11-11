'use strict';

/** Read-only audit of match type separation in the local Firestore Emulator. */
const admin = require('firebase-admin');
const { classifyMatch } = require('./match-type-classifier.cjs');
const PROJECT_ID = 'studio-2788872209-f7092';
const EXPECTED_HOST = '127.0.0.1:8080';

if (process.env.FIRESTORE_EMULATOR_HOST !== EXPECTED_HOST) {
  console.error(`[BLOCKED] Set FIRESTORE_EMULATOR_HOST=${EXPECTED_HOST}; got ${process.env.FIRESTORE_EMULATOR_HOST || '(unset)'}`);
  process.exit(2);
}
if ((process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== PROJECT_ID)
  || (process.env.GCP_PROJECT && process.env.GCP_PROJECT !== PROJECT_ID)
  || (process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_CLOUD_PROJECT !== PROJECT_ID)) {
  console.error('[BLOCKED] Unexpected Firebase project environment variable.');
  process.exit(2);
}

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

async function main() {
  const snap = await db.collection('matches_v2').get();
  const counts = { league: 0, cup: 0, tournament: 0, friendly: 0, trial: 0, unknown: 0 };
  const samples = { unknown: [] };
  for (const doc of snap.docs) {
    const kind = classifyMatch(doc.id, doc.data());
    counts[kind]++;
    if (kind === 'unknown' && samples.unknown.length < 50) {
      const d = doc.data();
      samples.unknown.push({ id: doc.id, type: d.type ?? null, matchType: d.matchType ?? null, source: d.source ?? null, season: d.season ?? null, version: d.version ?? null, leagueId: d.leagueId ?? null });
    }
  }

  const related = {};
  for (const name of ['league_tables_v2', 'league_slots_v1', 'cup_pyramid_v1', 'tournaments_v1', 'friendly_matches_v1']) {
    const result = await db.collection(name).count().get();
    related[name] = result.data().count;
  }
  console.log(JSON.stringify({
    mode: 'READ_ONLY_AUDIT', project: PROJECT_ID, emulator: EXPECTED_HOST,
    matches_v2: { total: snap.size, countsByType: counts, unresolvedSample: samples.unknown },
    relatedCollections: related,
    policy: 'No records were changed, moved, or deleted. Unknown records must be reviewed, not guessed.'
  }, null, 2));
}

main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
