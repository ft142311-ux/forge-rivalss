const admin = require('../functions/node_modules/firebase-admin');

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'studio-2788872209-f7092';
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST;

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const SEASON = 1;
const LEAGUE = 'ALPHA';
const LEVEL = 4;
const GROUP = 1;
const TEAMS_PER_GROUP = 8;
const TABLE_ID = `table_v140_S${SEASON}_L${LEAGUE}_V${LEVEL}_G${GROUP}`;

function botId(rank) {
  return `BOT_${LEAGUE}_L${LEVEL}_G${GROUP}_R${rank}`;
}
function botName(rank) {
  return `Bot01${LEVEL}${String(GROUP).padStart(3, '0')}${String(rank).padStart(2, '0')}`;
}
function matchBelongsToGroup(data, id) {
  if (Number(data.level || data.division) === LEVEL &&
      Number(data.groupId || data.group) === GROUP) return true;
  return new RegExp(`_V${LEVEL}_G${GROUP}_T`).test(id);
}

async function main() {
  const apply = process.argv.includes('--apply');
  console.log(`\n[GROUP 4.1 REPAIR] ${apply ? 'APPLY MODE' : 'DRY RUN'}`);
  console.log(`[GROUP 4.1 REPAIR] Emulator: ${EMULATOR_HOST}`);
  console.log(`[GROUP 4.1 REPAIR] Table: ${TABLE_ID}\n`);

  const slots = {};
  for (let rank = 1; rank <= TEAMS_PER_GROUP; rank++) {
    const id = `S${SEASON}_L${LEAGUE}_D${LEVEL}_G${GROUP}_R${rank}`;
    const snap = await db.collection('league_slots_v1').doc(id).get();
    if (!snap.exists) throw new Error(`Missing authoritative slot: ${id}`);
    const d = snap.data() || {};
    slots[rank] = {
      id, rank,
      status: d.status || 'FREE',
      occupantId: d.occupantId || null
    };
  }

  console.log('[1/4] Authoritative slots:');
  for (let rank = 1; rank <= 8; rank++) {
    console.log(`  R${rank}: ${slots[rank].status}` +
      (slots[rank].occupantId ? ` -> ${slots[rank].occupantId}` : ' -> BOT'));
  }

  const tableRef = db.collection('league_tables_v2').doc(TABLE_ID);
  const tableSnap = await tableRef.get();
  if (!tableSnap.exists) throw new Error(`Missing table: ${TABLE_ID}`);
  const oldStats = tableSnap.data().stats || {};
  console.log(`\n[2/4] Existing table contains ${Object.keys(oldStats).length} stats entries.`);

  const matchesSnap = await db.collection('matches_v2')
    .where('season', '==', SEASON)
    .where('leagueId', '==', LEAGUE)
    .where('version', '==', 140)
    .where('isFinished', '==', true)
    .get();

  const statsByRank = {};
  for (let rank = 1; rank <= 8; rank++) {
    statsByRank[rank] = {
      matchesPlayed: 0, wins: 0, draws: 0, losses: 0, points: 0, diff: 0
    };
  }

  let usedMatches = 0;
  for (const doc of matchesSnap.docs) {
    const m = doc.data() || {};
    if (!matchBelongsToGroup(m, doc.id)) continue;

    const homeRank = Number(m.homeRank);
    const awayRank = Number(m.awayRank);
    if (![homeRank, awayRank].every(n => Number.isInteger(n) && n >= 1 && n <= 8) ||
        homeRank === awayRank) continue;

    const scoreA = Number(m.scoreA || 0);
    const scoreB = Number(m.scoreB || 0);
    const home = statsByRank[homeRank];
    const away = statsByRank[awayRank];

    home.matchesPlayed++; away.matchesPlayed++;
    home.diff += scoreA - scoreB; away.diff += scoreB - scoreA;

    if (scoreA > scoreB) {
      home.wins++; home.points += 3; away.losses++;
    } else if (scoreA < scoreB) {
      away.wins++; away.points += 3; home.losses++;
    } else {
      home.draws++; away.draws++; home.points++; away.points++;
    }
    usedMatches++;
  }

  console.log(`[3/4] Finished matches used: ${usedMatches}`);

  const rebuilt = {};
  for (let rank = 1; rank <= 8; rank++) {
    const slot = slots[rank];

    if (slot.status === 'OCCUPIED' && slot.occupantId) {
      const playerSnap = await db.collection('players_v14').doc(slot.occupantId).get();
      const player = playerSnap.exists ? (playerSnap.data() || {}) : {};
      rebuilt[slot.occupantId] = {
        id: slot.occupantId,
        name: player.clubName || player.displayName || oldStats[slot.occupantId]?.name || `Club R${rank}`,
        rank,
        ...statsByRank[rank],
        isBot: false,
        clubLogo: player.clubLogo || null
      };
    } else {
      const id = botId(rank);
      rebuilt[id] = {
        id, name: botName(rank), rank,
        ...statsByRank[rank],
        isBot: true, clubLogo: null
      };
    }
  }

  console.log(`\nCanonical result contains ${Object.keys(rebuilt).length} entries:`);
  for (const entry of Object.values(rebuilt)) {
    console.log(`  R${entry.rank} | ${entry.isBot ? 'BOT' : 'CLUB'} | ${entry.id} | ${entry.name} | ` +
      `${entry.matchesPlayed} ${entry.wins}-${entry.draws}-${entry.losses} | ${entry.points} pts`);
  }

  if (!apply) {
    console.log('\nDRY RUN ONLY. No Firestore data was changed.');
    console.log('If correct, run the same command with --apply.');
    return;
  }

  await tableRef.update({
    stats: rebuilt,
    updatedAt: FieldValue.serverTimestamp()
  });

  console.log(`\n[4/4] REPAIR APPLIED. ${TABLE_ID} now contains exactly 8 teams.`);
}

main().catch(err => {
  console.error('\n[GROUP 4.1 REPAIR] FAILED:', err);
  process.exit(1);
});
