const admin = require("firebase-admin");

if (process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8081") {
  throw new Error("Safety stop: expected backup emulator at 127.0.0.1:8081");
}
if (process.env.GCLOUD_PROJECT !== "demo-forge-rivals") {
  throw new Error("Safety stop: unexpected project");
}

admin.initializeApp({ projectId: "demo-forge-rivals" });
const db = admin.firestore();

async function main() {
  const tableId = "table_v140_S1_LALPHA_V1_G1";

  const [tableSnap, matchesSnap] = await Promise.all([
    db.collection("league_tables_v2").doc(tableId).get(),
    db.collection("matches_v2")
      .where("season", "==", 1)
      .where("version", "==", 140)
      .get()
  ]);

  if (!tableSnap.exists) throw new Error(`Missing table ${tableId}`);

  const table = tableSnap.data();
  const stats = table.stats || table.teams || {};
  const fixtures = matchesSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(m =>
      String(m.leagueId || "ALPHA") === "ALPHA" &&
      Number(m.level || 4) === 1 &&
      Number(m.groupId || 1) === 1 &&
      String(m.id || "").includes("_S1_LALPHA_V1_G1_")
    );

  console.log("Table:", tableId);
  console.log("Source rows:", Object.keys(stats).length);
  console.log("Canonical fixtures found:", fixtures.length);

  const { calculateGroupStandings } =
    await import("../src/app/actions/season-rollover-standings.ts");

  const standings = calculateGroupStandings(stats, fixtures, 8);

  console.log("\nCalculated standings:");
  console.table(standings.map((r, i) => ({
    place: i + 1,
    id: r.id,
    name: r.name,
    bot: Boolean(r.isBot),
    matches: r.matchesPlayed,
    wins: r.wins,
    draws: r.draws,
    losses: r.losses,
    points: r.points,
    diff: r.diff,
    rankField: r.rank
  })));

  const ids = standings.map(r => String(r.id));
  const ranks = standings.map(r => Number(r.rank));
  const report = {
    fixtureCount: fixtures.length,
    standingsCount: standings.length,
    uniqueParticipants: new Set(fixtures.flatMap(m => [
      String(m.homeId), String(m.awayId)
    ])).size,
    duplicateOutputIds: ids.length !== new Set(ids).size,
    duplicateRankFields: ranks.length !== new Set(ranks).size,
    staleBotPresent: ids.includes("BOT_ALPHA_L1_G1_R5"),
    ggselPresent: ids.includes("LZJW7Nz5Gf75u6dtvIJle6arp2Ba"),
    allHave14Matches: standings.every(r => Number(r.matchesPlayed) === 14),
    totalPoints: standings.reduce((n, r) => n + Number(r.points || 0), 0)
  };

  console.log("\nValidation:", JSON.stringify(report, null, 2));
  console.log("\nREAD ONLY: no Firestore writes were performed.");

  if (fixtures.length !== 56 || standings.length !== 8) {
    process.exitCode = 2;
  }
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await admin.app().delete();
  });
