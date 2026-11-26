const admin = require("firebase-admin");

if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8081" ||
    process.env.GCLOUD_PROJECT !== "demo-forge-rivals") {
  throw new Error("Safety stop: wrong Firestore target");
}

admin.initializeApp({ projectId: "demo-forge-rivals" });
const db = admin.firestore();

async function main() {
  const { calculateGroupStandings } =
    await import("../src/app/actions/season-rollover-standings.ts");

  const [matchesSnap, tablesSnap] = await Promise.all([
    db.collection("matches_v2")
      .where("season", "==", 1)
      .where("version", "==", 140)
      .get(),
    db.collection("league_tables_v2").get()
  ]);

  const matches = matchesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const tables = new Map(tablesSnap.docs.map(d => [d.id, d.data()]));
  const report = [];
  const errors = [];

  for (const [level, groupCount] of [[1, 1], [2, 2], [3, 4], [4, 8]]) {
    for (let group = 1; group <= groupCount; group++) {
      const key = `V${level}_G${group}`;
      const tableId = `table_v140_S1_LALPHA_${key}`;
      const table = tables.get(tableId);
      const fixtures = matches.filter(m =>
        String(m.leagueId || "ALPHA") === "ALPHA" &&
        Number(m.level || 4) === level &&
        Number(m.groupId || 1) === group &&
        String(m.id || "").includes(`_S1_LALPHA_${key}_`)
      );

      const stats = table?.stats || table?.teams || {};
      const standings = table
        ? calculateGroupStandings(stats, fixtures, 8)
        : [];

      const participants = new Set(fixtures.flatMap(m => [
        String(m.homeId || ""),
        String(m.awayId || "")
      ]));
      const ids = standings.map(r => String(r.id));
      const matchCountsOK = standings.every(r => Number(r.matchesPlayed) === 14);
      const completeFixtures = fixtures.every(m =>
        m.isFinished === true &&
        (m.status == null || m.status === "finished") &&
        Number.isInteger(Number(m.score?.home ?? m.seriesScore?.home ?? m.scoreA)) &&
        Number.isInteger(Number(m.score?.away ?? m.seriesScore?.away ?? m.scoreB))
      );

      const problems = [];
      if (!table) problems.push("TABLE_MISSING");
      if (fixtures.length !== 56) problems.push(`FIXTURES_${fixtures.length}_OF_56`);
      if (participants.size !== 8) problems.push(`PARTICIPANTS_${participants.size}_OF_8`);
      if (!completeFixtures) problems.push("INCOMPLETE_FIXTURES");
      if (standings.length !== 8) problems.push(`STANDINGS_${standings.length}_OF_8`);
      if (new Set(ids).size !== ids.length) problems.push("DUPLICATE_IDS");
      if (!matchCountsOK) problems.push("TEAM_MATCH_COUNT_NOT_14");
      if (standings.some(r => !r.id || !Number.isFinite(Number(r.points)))) {
        problems.push("INVALID_STANDINGS_ROW");
      }

      report.push({
        group: key,
        fixtures: fixtures.length,
        participants: participants.size,
        standings: standings.length,
        matches14: matchCountsOK,
        result: problems.length ? "CHECK" : "PASS",
        problems: problems.join(", ")
      });

      for (const problem of problems) errors.push(`${key}: ${problem}`);
    }
  }

  console.table(report);
  console.log("\nSummary:", JSON.stringify({
    groupsChecked: report.length,
    passed: report.filter(r => r.result === "PASS").length,
    failed: report.filter(r => r.result !== "PASS").length,
    errors
  }, null, 2));
  console.log("\nREAD ONLY: no Firestore writes were performed.");

  if (report.length !== 15 || errors.length) process.exitCode = 2;
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await admin.app().delete();
  });
