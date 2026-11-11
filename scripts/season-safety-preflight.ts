import { getAdminDb } from '../src/lib/firebase-admin';
import { diagnoseSeasonRolloverPreflight } from '../src/app/actions/season-rollover';
import { calculateGroupStandings } from '../src/app/actions/season-rollover-standings';
import { classifySeasonAwardState } from '../src/app/actions/season-award-reconciliation';

const LEAGUE_ID = 'ALPHA';
const EXPECTED_MATCHES_PER_GROUP = 56;
const PRIZES: Record<number, number[]> = {
  1: [4_000_000, 3_600_000, 3_200_000, 2_800_000, 2_600_000, 2_400_000, 2_200_000, 2_000_000],
  2: [1_800_000, 1_650_000, 1_500_000, 1_350_000, 1_250_000, 1_150_000, 1_075_000, 1_000_000],
  3: [900_000, 800_000, 700_000, 600_000, 550_000, 500_000, 450_000, 400_000],
  4: [350_000, 300_000, 250_000, 200_000, 175_000, 150_000, 125_000, 100_000],
};

async function main() {
  const db = getAdminDb();
  const configSnap = await db.doc('system_v1/season_config').get();
  const config = configSnap.exists ? configSnap.data() || {} : {};
  const [strictPreflight, recoveryPreflight] = await Promise.all([
    diagnoseSeasonRolloverPreflight(db, 1, false),
    diagnoseSeasonRolloverPreflight(db, 1, true),
  ]);

  const [season1Matches, season1Tables, season1Archive, season1Plan] = await Promise.all([
    db.collection('matches_v2').where('season', '==', 1).where('version', '==', 140).get(),
    db.collection('league_tables_v2').where('season', '==', 1).where('version', '==', 140).get(),
    db.doc('league_season_archives_v1/S1').get(),
    db.doc('league_season_rollovers_v1/S2').get(),
  ]);

  const standings: Record<string, any[]> = {};
  const groups: any[] = [];
  const participantLocations = new Map<string, { level: number; group: number; rank: number; prize: number }>();
  for (let level = 1; level <= 4; level++) {
    for (let group = 1; group <= 2 ** (level - 1); group++) {
      const table = season1Tables.docs.find(doc => {
        const data = doc.data() || {};
        return Number(data.level) === level && Number(data.group) === group && String(data.leagueId || LEAGUE_ID) === LEAGUE_ID;
      });
      const fixtures = season1Matches.docs.map(doc => ({ ...doc.data(), matchId: doc.id })).filter(match => {
        const type = String(match.type || match.matchType || match.competitionType || '').toLowerCase();
        return !/(cup|tournament|friendly|scrim|pyramid)/.test(type) &&
          Number(match.level || match.division || 0) === level &&
          Number(match.groupId || match.group || 0) === group &&
          (!match.leagueId || String(match.leagueId) === LEAGUE_ID);
      });
      const rows = calculateGroupStandings(table?.data()?.stats || {}, fixtures, 8);
      const ranked = rows.map((row, index) => ({ ...row, rank: index + 1 }));
      standings[`D${level}-G${group}`] = ranked;
      for (const row of ranked) {
        if (row.id && !String(row.id).startsWith('BOT_')) {
          participantLocations.set(String(row.id), { level, group, rank: row.rank, prize: PRIZES[level]?.[row.rank - 1] || 0 });
        }
      }
      groups.push({
        group: `D${level}-G${group}`,
        tableExists: Boolean(table),
        fixtureCount: fixtures.length,
        finishedCount: fixtures.filter(match => match.isFinished === true && String(match.status || '').toLowerCase() === 'finished').length,
        validStandings: rows.length === 8,
        finalRanks: ranked.map(row => ({ id: row.id, rank: row.rank, points: row.points, diff: row.diff })),
      });
    }
  }

  const season2PlanSnap = await db.doc('league_season_rollovers_v1/S2').get();
  const season2Plan = season2PlanSnap.exists ? season2PlanSnap.data() || {} : {};
  const expectedPlacements: Record<string, Array<{ id: string; rank: number }>> = {};
  for (let level = 1; level <= 4; level++) {
    for (let group = 1; group <= 2 ** (level - 1); group++) {
      const key = `D${level}-G${group}`;
      const own = standings[key] || [];
      const incoming: any[] = [];
      if (level > 1) {
        const parent = standings[`D${level - 1}-G${Math.ceil(group / 2)}`] || [];
        incoming.push(parent[group % 2 === 1 ? 6 : 7]);
      }
      if (level < 4) {
        incoming.push(standings[`D${level + 1}-G${group * 2 - 1}`]?.[0]);
        incoming.push(standings[`D${level + 1}-G${group * 2}`]?.[0]);
      }
      const retained = level === 1 ? own.slice(0, 6) : level === 4 ? own.slice(1, 8) : own.slice(1, 6);
      const unique = new Map<string, any>();
      for (const team of [...retained, ...incoming].filter(Boolean)) unique.set(String(team.id), team);
      expectedPlacements[key] = [...unique.values()].slice(0, 8).map((team, index) => ({ id: String(team.id), rank: index + 1 }));
    }
  }
  const promotionPlanMismatches: any[] = [];
  const allPlannedTeamIds = new Set<string>();
  for (const [group, expected] of Object.entries(expectedPlacements)) {
    const saved = Array.isArray(season2Plan.groups?.[group]) ? season2Plan.groups[group] : [];
    if (expected.length !== 8 || saved.length !== 8) {
      promotionPlanMismatches.push({ group, expectedTeams: expected.length, savedTeams: saved.length });
      continue;
    }
    for (let index = 0; index < 8; index++) {
      const expectedTeam = expected[index];
      const savedTeam = saved[index] || {};
      if (String(savedTeam.id || '') !== expectedTeam.id || Number(savedTeam.rank) !== expectedTeam.rank) {
        promotionPlanMismatches.push({ group, rank: index + 1, expected: expectedTeam, saved: { id: savedTeam.id || null, rank: savedTeam.rank ?? null } });
      }
      const id = String(savedTeam.id || '');
      if (id) allPlannedTeamIds.add(id);
    }
  }

  const awardStates: Record<string, number> = {
    AWARD_AND_LEDGER: 0,
    AWARD_WITHOUT_LEDGER: 0,
    LEDGER_WITHOUT_AWARD: 0,
    NEITHER: 0,
  };
  const awardMismatches: any[] = [];
  let missingPlayerProfiles = 0;
  for (const [uid, placement] of participantLocations) {
    const [playerSnap, ledgerSnap] = await Promise.all([
      db.collection('players_v14').doc(uid).get(),
      db.collection('economy_transactions').doc(`season_1_${uid}`).get(),
    ]);
    if (!playerSnap.exists) {
      missingPlayerProfiles++;
      continue;
    }
    const player = playerSnap.data() || {};
    const award = player.seasonAwards?.S1;
    const ledger = ledgerSnap.exists ? ledgerSnap.data() || {} : null;
    const state = classifySeasonAwardState(award, ledger);
    awardStates[state]++;
    if (award && (
      Number(award.season) !== 1 || Number(award.division) !== placement.level ||
      Number(award.group) !== placement.group || Number(award.rank) !== placement.rank ||
      Number(award.prize) !== placement.prize
    )) {
      awardMismatches.push({ uid, issue: 'AWARD_PLACEMENT_OR_AMOUNT_MISMATCH', award, expected: placement });
    }
    if (ledger && (
      Number(ledger.amount) !== placement.prize || ledger.referenceId !== 'S1' ||
      ledger.type !== 'LEAGUE_SEASON_REWARD' || Number(ledger.division) !== placement.level ||
      Number(ledger.group) !== placement.group || Number(ledger.rank) !== placement.rank
    )) {
      awardMismatches.push({ uid, issue: 'LEDGER_PLACEMENT_OR_AMOUNT_MISMATCH', ledger, expected: placement });
    }
  }

  const seasons: Record<number, any> = {};
  for (let season = 1; season <= 4; season++) {
    const [archive, plan, matches, tables, slots] = await Promise.all([
      db.doc(`league_season_archives_v1/S${season}`).get(),
      db.doc(`league_season_rollovers_v1/S${season + 1}`).get(),
      db.collection('matches_v2').where('season', '==', season).where('version', '==', 140).get(),
      db.collection('league_tables_v2').where('season', '==', season).where('version', '==', 140).get(),
      db.collection('league_slots_v1').where('season', '==', season).where('leagueId', '==', LEAGUE_ID).get(),
    ]);
    seasons[season] = {
      archiveExists: archive.exists,
      archiveStatus: archive.exists ? archive.data()?.status || null : null,
      archiveFinishedMatches: archive.exists ? archive.data()?.finishedMatches ?? null : null,
      rolloverPlanExists: plan.exists,
      rolloverPlanReady: plan.exists ? plan.data()?.ready === true : false,
      matchDocuments: matches.size,
      tableDocuments: tables.size,
      slotDocuments: slots.size,
    };
  }

  console.log(JSON.stringify({
    readOnly: true,
    writesPerformed: 0,
    currentSeasonConfig: {
      activeSeasonNumber: config.activeSeasonNumber ?? null,
      phase: config.phase ?? null,
      worldReady: config.worldReady ?? null,
      seasonStart: config.seasonStart ?? null,
      nextSeasonNumber: config.nextSeasonNumber ?? null,
      nextSeasonStart: config.nextSeasonStart ?? null,
    },
    sourceSeason1: {
      tables: season1Tables.size,
      matchDocuments: season1Matches.size,
      expectedMatchDocuments: 15 * EXPECTED_MATCHES_PER_GROUP,
      archiveExists: season1Archive.exists,
      archiveStatus: season1Archive.exists ? season1Archive.data()?.status || null : null,
      nextSeasonPlanExists: season1Plan.exists,
      promotionPlanValidation: {
        exists: season2PlanSnap.exists,
        ready: season2Plan.ready === true,
        groups: Object.keys(season2Plan.groups || {}).length,
        distinctTeamIds: allPlannedTeamIds.size,
        placementMismatches: promotionPlanMismatches,
      },
      strictPreflight: {
        ready: strictPreflight.ready,
        reason: strictPreflight.reason,
        failedGroups: strictPreflight.failedGroups,
        diagnostics: strictPreflight.diagnostics,
        observedTables: strictPreflight.observedTables,
        observedMatches: strictPreflight.observedMatches,
      },
      deterministicRecoveryPreflight: {
        ready: recoveryPreflight.ready,
        reason: recoveryPreflight.reason,
        failedGroups: recoveryPreflight.failedGroups,
        diagnostics: recoveryPreflight.diagnostics,
        observedTables: recoveryPreflight.observedTables,
        observedMatches: recoveryPreflight.observedMatches,
      },
      awardStates,
      awardMismatches,
      missingPlayerProfiles,
      groups: groups.map(group => ({
        group: group.group,
        tableExists: group.tableExists,
        fixtureCount: group.fixtureCount,
        finishedCount: group.finishedCount,
        validStandings: group.validStandings,
        humanFinalRanks: group.finalRanks.filter((row: any) => !String(row.id).startsWith('BOT_')),
      })),
    },
    seasons,
  }, null, 2));
  await db.terminate();
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
