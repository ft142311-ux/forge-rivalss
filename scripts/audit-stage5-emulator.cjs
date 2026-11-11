const admin = require('firebase-admin');

const projectId = process.env.GCLOUD_PROJECT || 'studio-2788872209-f7092';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
if (!admin.apps.length) admin.initializeApp({ projectId });
const db = admin.firestore();

function fail(msg) { console.error(`FAIL: ${msg}`); process.exitCode = 1; }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

(async () => {
  const matches = await db.collection('matches_v2').where('season','==',1).where('version','==',140).get();
  const finished = matches.docs.filter(d => d.data().isFinished === true);
  let badSimulation = 0;
  let badScore = 0;
  for (const d of finished) {
    const m = d.data() || {};
    const a = num(m.scoreA), b = num(m.scoreB);
    if (![0,1,2].includes(a) || ![0,1,2].includes(b) || a + b !== 2) badScore++;
    if (m.sportingEngine === 'stage5-match-engine-2') {
      const games = Array.isArray(m.simulation?.games) ? m.simulation.games : [];
      if (games.length !== 2 || games.some(g => !['home','away'].includes(g.winner === m.homeId ? 'home' : g.winner === m.awayId ? 'away' : 'invalid'))) badSimulation++;
    }
  }

  const clubs = await db.collection('players_v14').get();
  let botCount = 0, badBots = 0;
  for (const d of clubs.docs) {
    const c = d.data() || {};
    if (!String(d.id).startsWith('BOT_')) continue;
    botCount++;
    const players = Array.isArray(c.ownedPlayers) ? c.ownedPlayers : [];
    const roles = new Set(players.map(p => String(p.role || '')));
    const valid = players.length === 5 && roles.size === 5 &&
      ['Carry','Midlaner','Tank','Jungler','Support'].every(r => roles.has(r)) &&
      players.every(p => {
        const o = num(p.overallRating ?? p.ovr);
        return o !== null && o >= 23 && o <= 27 && p.proStats && typeof p.proStats === 'object';
      });
    if (!valid) badBots++;
  }

  console.log(JSON.stringify({
    season: 1,
    totalMatches: matches.size,
    finishedMatches: finished.length,
    badFinishedScores: badScore,
    badStage5Simulations: badSimulation,
    botClubs: botCount,
    invalidBotClubs: badBots
  }, null, 2));

  if (badScore || badSimulation || badBots) fail('Stage 5 audit found invalid records');
  else console.log('PASS: Stage 5 match/bot audit');
})().catch(err => { console.error(err); process.exitCode = 1; });
