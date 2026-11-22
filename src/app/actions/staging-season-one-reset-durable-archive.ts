import { createHash } from 'crypto';

type ArchiveSource = { path: string; data: Record<string, any> };

function canonical(value: any): any {
  if (value === null || value === undefined) return value === undefined ? null : null;
  if (value instanceof Date) return { __type: 'Date', value: value.toISOString() };
  if (Buffer.isBuffer(value)) return { __type: 'Buffer', value: value.toString('base64') };
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value?.toMillis === 'function') return { __type: 'Timestamp', millis: value.toMillis() };
  if (typeof value?.path === 'string' && typeof value?.get === 'function') return { __type: 'DocumentReference', path: value.path };
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical(value[key]);
    return out;
  }
  return value;
}

function digest(value: any) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function isLeagueFixture(data: Record<string, any>) {
  const type = String(data.matchType || data.type || data.competitionType || '').toLowerCase();
  return Number(data.season) === 1 && Number(data.version) === 140 &&
    String(data.leagueId || '') === 'ALPHA' && !data.cupId && !data.tournamentId &&
    !data.isFriendly && !/(cup|tournament|friendly|scrim|association)/.test(type);
}

async function collectQuery(query: any, predicate: (doc: any) => boolean = () => true): Promise<ArchiveSource[]> {
  const snap = await query.get();
  return snap.docs.filter(predicate).map((doc: any) => ({ path: doc.ref.path, data: doc.data() || {} }));
}

async function collectExact(db: any, path: string): Promise<ArchiveSource[]> {
  const snap = await db.doc(path).get();
  return snap.exists ? [{ path, data: snap.data() || {} }] : [];
}

/**
 * Archives the exact documents that the reset deletes or overwrites. Each source
 * document is stored independently, then reread and hash-verified before the
 * manifest can become COMPLETE. Re-running the same resetId is idempotent.
 */
export async function createOrVerifyDurableSeasonOneArchive(
  db: any,
  resetId: string,
  originalConfig: Record<string, any>,
  assertOwnership?: () => Promise<void>,
) {
  if (!resetId || !originalConfig || typeof originalConfig !== 'object') {
    throw new Error('SEASON_ONE_ARCHIVE_INPUT_INVALID');
  }

  const archiveRef = db.collection('staging_season_one_reset_archives_v1').doc(resetId);
  const documentsRef = archiveRef.collection('documents');
  const existingManifestSnap = await archiveRef.get();
  const existingManifest = existingManifestSnap.exists ? existingManifestSnap.data() || {} : {};
  if (existingManifest.status === 'COMPLETE') {
    const existingDocs = await documentsRef.get();
    if (existingDocs.size !== Number(existingManifest.sourceCount) ||
        existingDocs.size !== Number(existingManifest.persistedCount)) {
      throw new Error('SEASON_ONE_ARCHIVE_COMPLETED_DOCUMENT_COUNT_INVALID');
    }
    const restoredManifest = existingDocs.docs.map((doc: any) => {
      const item = doc.data() || {};
      if (!item.sourcePath || digest(item.data) !== item.sourceSha256) {
        throw new Error('SEASON_ONE_ARCHIVE_COMPLETED_CHECKSUM_INVALID');
      }
      return { path: String(item.sourcePath), sha256: String(item.sourceSha256) };
    }).sort((left: any, right: any) => left.path.localeCompare(right.path));
    if (new Set(restoredManifest.map((item: any) => item.path)).size !== restoredManifest.length ||
        digest(restoredManifest) !== existingManifest.archiveSha256) {
      throw new Error('SEASON_ONE_ARCHIVE_COMPLETED_MANIFEST_INVALID');
    }
    return {
      archiveDocuments: existingDocs.size,
      archiveSha256: existingManifest.archiveSha256,
      archiveStatus: 'COMPLETE',
      reusedCompletedArchive: true,
    };
  }

  const [tables, slots, matches, cupMatches, cupSnapshots, archiveMatches, slotHistory,
    effectsLeague, effectsCup, economyLeague, economyCup, economySeason, economyCupRewards,
    consequencesLeague, consequencesCup] = await Promise.all([
    collectQuery(db.collection('league_tables_v2').where('season', '==', 1).where('version', '==', 140)),
    collectQuery(db.collection('league_slots_v1').where('season', '==', 1).where('leagueId', '==', 'ALPHA')),
    collectQuery(db.collection('matches_v2').where('season', '==', 1), (doc: any) => {
      const data = doc.data() || {};
      return isLeagueFixture(data) || data.cupId === 'cup_s1_lALPHA' || doc.id.startsWith('cup_S1_');
    }),
    collectQuery(db.collection('cup_matches').where('cupId', '==', 'cup_s1_lALPHA')),
    collectQuery(db.collection('cup_participant_snapshots_v1').doc('cup_s1_lALPHA').collection('teams')),
    collectQuery(db.collection('league_season_archives_v1').doc('S1').collection('matches')),
    collectQuery(db.collection('league_slot_history_v1').where('season', '==', 1).where('leagueId', '==', 'ALPHA')),
    collectQuery(db.collection('match_player_effects_v1').where('matchId', '>=', 'match_v140_S1_LALPHA_').where('matchId', '<', 'match_v140_S1_LALPHA_\uf8ff')),
    collectQuery(db.collection('match_player_effects_v1').where('matchId', '>=', 'cup_S1_').where('matchId', '<', 'cup_S1_\uf8ff')),
    collectQuery(db.collection('economy_transactions').where('referenceId', '>=', 'match_v140_S1_LALPHA_').where('referenceId', '<', 'match_v140_S1_LALPHA_\uf8ff')),
    collectQuery(db.collection('economy_transactions').where('referenceId', '>=', 'cup_S1_').where('referenceId', '<', 'cup_S1_\uf8ff')),
    collectQuery(db.collection('economy_transactions').where('referenceId', '==', 'S1'), (doc: any) => doc.data()?.type === 'LEAGUE_SEASON_REWARD'),
    collectQuery(db.collection('economy_transactions').where('referenceId', '==', 'cup_s1_lALPHA'), (doc: any) =>
      ['PYRAMID_CUP_CHAMPION_REWARD', 'PYRAMID_CUP_FINALIST_REWARD'].includes(String(doc.data()?.type || ''))),
    collectQuery(db.collection('match_consequence_receipts').where('matchId', '>=', 'match_v140_S1_LALPHA_').where('matchId', '<', 'match_v140_S1_LALPHA_\uf8ff')),
    collectQuery(db.collection('match_consequence_receipts').where('matchId', '>=', 'cup_S1_').where('matchId', '<', 'cup_S1_\uf8ff')),
  ]);

  const profileIds = new Set<string>();
  for (const table of tables) {
    for (const [key, row] of Object.entries(table.data.stats || {}) as Array<[string, any]>) {
      profileIds.add(String(row?.id || key));
    }
  }
  const profiles = profileIds.size
    ? (await db.getAll(...[...profileIds].map(id => db.collection('players_v14').doc(id))))
        .filter((snap: any) => snap.exists)
        .map((snap: any) => ({ path: snap.ref.path, data: snap.data() || {} }))
    : [];

  if (tables.length !== 15 || slots.length !== 120 || profileIds.size !== 120 || profiles.length !== 120) {
    throw new Error('SEASON_ONE_ARCHIVE_CORE_WORLD_INCOMPLETE');
  }

  const exact = await Promise.all([
    collectExact(db, 'system_v1/season_config'),
    collectExact(db, 'cup_pyramid_v1/cup_s1_lALPHA'),
    collectExact(db, 'league_season_archives_v1/S1'),
    collectExact(db, 'league_season_rollovers_v1/S2'),
    collectExact(db, 'league_season_history_v1/S1'),
  ]);

  const unique = new Map<string, ArchiveSource>();
  for (const source of [
    ...tables, ...slots, ...profiles, ...matches, ...cupMatches, ...cupSnapshots,
    ...archiveMatches, ...slotHistory, ...effectsLeague, ...effectsCup,
    ...economyLeague, ...economyCup, ...economySeason, ...economyCupRewards,
    ...consequencesLeague, ...consequencesCup, ...exact.flat().filter(source => source.path !== 'system_v1/season_config'),
    { path: 'system_v1/season_config', data: originalConfig },
  ]) unique.set(source.path, source);
  const sources = [...unique.values()].sort((a, b) => a.path.localeCompare(b.path));
  if (!sources.some(source => source.path === 'system_v1/season_config')) {
    throw new Error('SEASON_ONE_ARCHIVE_CONFIG_MISSING');
  }

  const manifestRef = archiveRef;
  const sourceManifest = sources.map(source => ({ path: source.path, sha256: digest(source.data) }));
  const archiveDigest = digest(sourceManifest);
  const initialManifest = {
    schemaVersion: 1, resetId, status: 'WRITING',
    sourceCount: sources.length, persistedCount: 0,
    archiveSha256: archiveDigest, createdAt: new Date().toISOString(),
  };
  await assertOwnership?.();
  await manifestRef.set(initialManifest, { merge: true });

  for (let offset = 0; offset < sources.length; offset += 350) {
    await assertOwnership?.();
    const batch = db.batch();
    for (const source of sources.slice(offset, offset + 350)) {
      const id = createHash('sha256').update(source.path).digest('hex');
      batch.set(documentsRef.doc(id), {
        sourcePath: source.path,
        sourceSha256: digest(source.data),
        data: source.data,
      });
    }
    await batch.commit();
    await manifestRef.set({ persistedCount: Math.min(offset + 350, sources.length), status: 'WRITING' }, { merge: true });
  }

  const archived = await documentsRef.get();
  if (archived.size !== sources.length) throw new Error('SEASON_ONE_ARCHIVE_DOCUMENT_COUNT_MISMATCH');
  const archivedByPath = new Map<string, any>();
  for (const doc of archived.docs) {
    const item = doc.data() || {};
    if (!item.sourcePath || archivedByPath.has(item.sourcePath) || digest(item.data) !== item.sourceSha256) {
      throw new Error('SEASON_ONE_ARCHIVE_DOCUMENT_CHECKSUM_INVALID');
    }
    archivedByPath.set(item.sourcePath, item);
  }
  const verifiedManifest = sources.map(source => {
    const item = archivedByPath.get(source.path);
    if (!item || item.sourceSha256 !== digest(source.data)) {
      throw new Error('SEASON_ONE_ARCHIVE_READBACK_MISMATCH');
    }
    return { path: source.path, sha256: item.sourceSha256 };
  });
  if (digest(verifiedManifest) !== archiveDigest) throw new Error('SEASON_ONE_ARCHIVE_MANIFEST_CHECKSUM_INVALID');

  await assertOwnership?.();
  const complete = {
    schemaVersion: 1, resetId, status: 'COMPLETE',
    sourceCount: sources.length, persistedCount: archived.size,
    archiveSha256: archiveDigest, completedAt: new Date().toISOString(),
  };
  await manifestRef.set(complete, { merge: true });
  const finalManifest = (await manifestRef.get()).data() || {};
  if (finalManifest.status !== 'COMPLETE' || Number(finalManifest.sourceCount) !== sources.length ||
      Number(finalManifest.persistedCount) !== sources.length || finalManifest.archiveSha256 !== archiveDigest) {
    throw new Error('SEASON_ONE_ARCHIVE_COMPLETION_NOT_DURABLE');
  }
  return { archiveDocuments: sources.length, archiveSha256: archiveDigest, archiveStatus: 'COMPLETE' };
}


async function deleteArchiveQuery(db: any, query: any) {
  const snap = await query.get();
  for (let offset = 0; offset < snap.docs.length; offset += 350) {
    const batch = db.batch();
    snap.docs.slice(offset, offset + 350).forEach((doc: any) => batch.delete(doc.ref));
    await batch.commit();
  }
  return snap.docs.length;
}

/**
 * Restores the exact allowlisted source documents from a verified archive.
 * This is an explicit rollback primitive, not part of the normal reset path.
 */
export async function restoreSeasonOneFromDurableArchive(
  db: any,
  resetId: string,
  confirmation: string,
  assertOwnership?: () => Promise<void>,
) {
  if (confirmation !== 'RESTORE_BETA_SEASON_ONE_ARCHIVE') {
    throw new Error('SEASON_ONE_ARCHIVE_RESTORE_CONFIRMATION_REQUIRED');
  }
  if (!resetId) throw new Error('SEASON_ONE_ARCHIVE_RESET_ID_REQUIRED');
  const archiveRef = db.collection('staging_season_one_reset_archives_v1').doc(resetId);
  const manifestSnap = await archiveRef.get();
  const manifest = manifestSnap.exists ? manifestSnap.data() || {} : {};
  if (manifest.status !== 'COMPLETE') throw new Error('SEASON_ONE_ARCHIVE_NOT_COMPLETE');
  const docsSnap = await archiveRef.collection('documents').get();
  if (docsSnap.size !== Number(manifest.sourceCount) ||
      docsSnap.size !== Number(manifest.persistedCount)) {
    throw new Error('SEASON_ONE_ARCHIVE_RESTORE_DOCUMENT_COUNT_INVALID');
  }

  const restored = docsSnap.docs.map((doc: any) => {
    const item = doc.data() || {};
    if (!item.sourcePath || typeof item.sourcePath !== 'string' ||
        !item.data || typeof item.data !== 'object' ||
        digest(item.data) !== item.sourceSha256) {
      throw new Error('SEASON_ONE_ARCHIVE_RESTORE_CHECKSUM_INVALID');
    }
    return { path: item.sourcePath, data: item.data, sha256: item.sourceSha256 };
  }).sort((left: any, right: any) => left.path.localeCompare(right.path));
  if (new Set(restored.map((item: any) => item.path)).size !== restored.length ||
      digest(restored.map((item: any) => ({ path: item.path, sha256: item.sha256 }))) !== manifest.archiveSha256) {
    throw new Error('SEASON_ONE_ARCHIVE_RESTORE_MANIFEST_INVALID');
  }
  const configIndex = restored.findIndex((item: any) => item.path === 'system_v1/season_config');
  if (configIndex < 0) throw new Error('SEASON_ONE_ARCHIVE_RESTORE_CONFIG_MISSING');

  await assertOwnership?.();
  const currentMatches = await db.collection('matches_v2').where('season', '==', 1).get();
  const disposableMatches = currentMatches.docs.filter((doc: any) => {
    const data = doc.data() || {};
    return isLeagueFixture(data) || data.cupId === 'cup_s1_lALPHA' || doc.id.startsWith('cup_S1_');
  });
  for (let offset = 0; offset < disposableMatches.length; offset += 350) {
    await assertOwnership?.();
    const batch = db.batch();
    disposableMatches.slice(offset, offset + 350).forEach((doc: any) => batch.delete(doc.ref));
    await batch.commit();
  }
  const cleanupQueries = [
    db.collection('cup_matches').where('cupId', '==', 'cup_s1_lALPHA'),
    db.collection('cup_participant_snapshots_v1').doc('cup_s1_lALPHA').collection('teams'),
    db.collection('league_season_archives_v1').doc('S1').collection('matches'),
    db.collection('league_slot_history_v1').where('season', '==', 1).where('leagueId', '==', 'ALPHA'),
    db.collection('match_player_effects_v1').where('matchId', '>=', 'match_v140_S1_LALPHA_').where('matchId', '<', 'match_v140_S1_LALPHA_\uf8ff'),
    db.collection('match_player_effects_v1').where('matchId', '>=', 'cup_S1_').where('matchId', '<', 'cup_S1_\uf8ff'),
    db.collection('economy_transactions').where('referenceId', '>=', 'match_v140_S1_LALPHA_').where('referenceId', '<', 'match_v140_S1_LALPHA_\uf8ff'),
    db.collection('economy_transactions').where('referenceId', '>=', 'cup_S1_').where('referenceId', '<', 'cup_S1_\uf8ff'),
    db.collection('match_consequence_receipts').where('matchId', '>=', 'match_v140_S1_LALPHA_').where('matchId', '<', 'match_v140_S1_LALPHA_\uf8ff'),
    db.collection('match_consequence_receipts').where('matchId', '>=', 'cup_S1_').where('matchId', '<', 'cup_S1_\uf8ff'),
  ];
  for (const query of cleanupQueries) {
    await assertOwnership?.();
    await deleteArchiveQuery(db, query);
  }
  const seasonRewards = await db.collection('economy_transactions').where('referenceId', '==', 'S1').get();
  const cupRewards = await db.collection('economy_transactions').where('referenceId', '==', 'cup_s1_lALPHA').get();
  const rewardDocs = [
    ...seasonRewards.docs.filter((doc: any) => doc.data()?.type === 'LEAGUE_SEASON_REWARD'),
    ...cupRewards.docs.filter((doc: any) =>
      ['PYRAMID_CUP_CHAMPION_REWARD', 'PYRAMID_CUP_FINALIST_REWARD'].includes(String(doc.data()?.type || ''))),
  ];
  for (let offset = 0; offset < rewardDocs.length; offset += 350) {
    await assertOwnership?.();
    const batch = db.batch();
    rewardDocs.slice(offset, offset + 350).forEach((doc: any) => batch.delete(doc.ref));
    await batch.commit();
  }
  for (const [collection, document] of [
    ['cup_pyramid_v1', 'cup_s1_lALPHA'],
    ['league_season_archives_v1', 'S1'],
    ['league_season_rollovers_v1', 'S2'],
    ['league_season_history_v1', 'S1'],
  ]) {
    await assertOwnership?.();
    await db.collection(collection).doc(document).delete().catch((error: any) => {
      if (error?.code !== 5) throw error;
    });
  }

  const nonConfig = restored.filter((item: any) => item.path !== 'system_v1/season_config');
  for (let offset = 0; offset < nonConfig.length; offset += 350) {
    await assertOwnership?.();
    const batch = db.batch();
    for (const item of nonConfig.slice(offset, offset + 350)) batch.set(db.doc(item.path), item.data);
    await batch.commit();
  }
  await assertOwnership?.();
  await db.doc('system_v1/season_config').set(restored[configIndex].data);

  for (const item of restored) {
    const snap = await db.doc(item.path).get();
    if (!snap.exists || digest(snap.data()) !== item.sha256) {
      throw new Error('SEASON_ONE_ARCHIVE_RESTORE_READBACK_MISMATCH');
    }
  }
  return { success: true, restoredDocuments: restored.length, archiveSha256: manifest.archiveSha256 };
}
