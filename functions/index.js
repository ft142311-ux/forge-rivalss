const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { isEligibleRegistrationSlot, validateRegistrationSchedule, generateStartingSquad } = require('../src/lib/registration/registration-core');

/**
 * @fileOverview Р•РґРёРЅРѕРµ СЃРµСЂРІРµСЂРЅРѕРµ СЏРґСЂРѕ СЂРµРіРёСЃС‚СЂР°С†РёРё v165.
 * Р РµР°Р»РёР·СѓРµС‚ Р°С‚РѕРјР°СЂРЅСѓСЋ СЂРµРіРёСЃС‚СЂР°С†РёСЋ, СЃРµСЂРІРµСЂРЅСѓСЋ РіРµРЅРµСЂР°С†РёСЋ СЃРѕСЃС‚Р°РІР° Рё РіР»СѓР±РѕРєСѓСЋ РґРёР°РіРЅРѕСЃС‚РёРєСѓ.
 */

admin.initializeApp();
const db = admin.firestore();
const serverTimestamp = () => new Date();

const REGISTRATION_VERSION = '169';

// ============ Р“Р•РќР•Р РђР¦РРЇ РЎРћРЎРўРђР’Рђ (SERVER-SIDE) ============


// ============ Р Р•Р“РРЎРўР РђР¦РРЇ (CALLABLE v165) ============

exports.initializeClub = functions.region('us-central1').https.onCall(async (data, context) => {
  console.log('[INIT] Start v' + REGISTRATION_VERSION);
  
  if (!context.auth) {
    console.error('[INIT] AUTH FAILED: No context');
    throw new functions.https.HttpsError('unauthenticated', 'AUTHENTICATION_REQUIRED');
  }

  const userId = context.auth.uid;
  const email = context.auth.token.email;
  const leagueId = 'ALPHA';
  console.log('[INIT] AUTH OK. UID:', userId, 'League:', leagueId);
  
  if (!email) {
    console.error('[INIT] EMAIL FAILED: Missing in token');
    throw new functions.https.HttpsError('failed-precondition', 'EMAIL_REQUIRED');
  }

  const rawClubName = typeof data?.clubName === 'string' ? data.clubName.trim() : '';
  const clubName = rawClubName.substring(0, 25) || `Commander_${userId.slice(0, 4)}`;

  try {
    // Registration is intentionally read-only with respect to the league world:
    // it may only claim an already-prebuilt slot. No tables, slots or matches
    // are generated here.
    const playerRef = db.collection('players_v14').doc(userId);
    const configRef = db.collection('system_v1').doc('season_config');
    const statsRef = db.collection('system_v1').doc('global_stats');

    return await db.runTransaction(async (t) => {
      // --- 1. Р’РЎР• Р§РўР•РќРРЇ (READS) ---
      console.log('[INIT] Transaction: Starting READS');
      
      const pSnap = await t.get(playerRef);
      if (pSnap.exists) {
        const d = pSnap.data();
        console.log('[INIT] SUCCESS: Player already exists');
        return { 
          success: true, 
          version: 'v' + REGISTRATION_VERSION,
          clubName: d.clubName, 
          tier: d.leagueLevel, 
          group: d.groupId, 
          rank: d.rank,
          numericId: d.numericId
        };
      }

      const configSnap = await t.get(configRef);
      if (!configSnap.exists) {
        console.error('[INIT] CONFIG READ FAILED: season_config missing');
        throw new functions.https.HttpsError('failed-precondition', 'SEASON_CONFIG_MISSING');
      }
      const config = configSnap.data();
      const seasonNum = Number(config.activeSeasonNumber || 1);
      const phase = config.phase || 'UNKNOWN';
      console.log('[INIT] CONFIG READ OK. Season:', seasonNum, 'Phase:', phase);

      if (config.worldReady !== true) {
        console.warn('[INIT] WORLD NOT READY:', { seasonNum, worldReady: config.worldReady });
        throw new functions.https.HttpsError('failed-precondition', 'WORLD_INITIALIZING');
      }

      if (phase !== 'REGULAR_SEASON' && phase !== 'ACTIVE') {
        console.warn('[INIT] PHASE RESTRICTED:', phase);
        throw new functions.https.HttpsError('failed-precondition', 'SEASON_TRANSITION_IN_PROGRESS');
      }

      console.log('[INIT] GLOBAL STATS READ...');
      const globalStatsSnap = await t.get(statsRef);

      console.log('[INIT] SLOT QUERY: searching all divisions D1-D4...');
      // Single-field query keeps registration independent of extra composite
      // indexes. The world builder has already created all 120 slots.
      const slotsQuery = db.collection('league_slots_v1')
        .where('season', '==', seasonNum);

      const slotsSnap = await t.get(slotsQuery);
      const allLeagueSlots = slotsSnap.docs.filter((doc) => {
        const slot = doc.data() || {};
        return slot.leagueId === leagueId && Number(slot.season) === seasonNum;
      });
      if (allLeagueSlots.length !== 120) {
        console.error('[INIT] WORLD INCOMPLETE: expected 120 slots, got', allLeagueSlots.length);
        throw new functions.https.HttpsError('failed-precondition', 'WORLD_NOT_READY');
      }

      const freeSlots = allLeagueSlots.filter((doc) =>
        isEligibleRegistrationSlot(doc.data() || {}, seasonNum)
      );

      if (freeSlots.length === 0) {
        console.error('[INIT] SLOT FAILED: No free slots in D1-D4');
        throw new functions.https.HttpsError('resource-exhausted', 'NO_FREE_SLOTS_IN_LEAGUE');
      }

      // Randomly select one free slot from the complete active-season D1-D4 pool.
      const slotDoc = freeSlots[Math.floor(Math.random() * freeSlots.length)];
      const slot = slotDoc.data();
      console.log('[INIT] SLOT FOUND:', slotDoc.id, 'Division:', slot.division, 'Group:', slot.group, 'Rank:', slot.rank);

      // Р’Р°Р»РёРґР°С†РёСЏ СЃР»РѕС‚Р°
      if (slot.status !== 'FREE' || slot.occupantId || Number(slot.season) !== seasonNum) {
         console.error('[INIT] SLOT INVALID:', slot);
         throw new functions.https.HttpsError('failed-precondition', 'INVALID_LEAGUE_SLOT');
      }

      const tableId = `table_v140_S${seasonNum}_L${leagueId}_V${slot.division}_G${slot.group}`;
      console.log('[INIT] TABLE READ:', tableId);
      const tableRef = db.collection('league_tables_v2').doc(tableId);
      const tableSnap = await t.get(tableRef);

      if (!tableSnap.exists) {
        console.error('[INIT] TABLE FAILED: Table missing', tableId);
        throw new functions.https.HttpsError('failed-precondition', 'LEAGUE_TABLE_MISSING');
      }

      const tableData = tableSnap.data();
      
      // РџСЂРѕРІРµСЂРєР° РєРѕРЅСЃРёСЃС‚РµРЅС‚РЅРѕСЃС‚Рё С‚Р°Р±Р»РёС†С‹
      if (Number(tableData.level) !== Number(slot.division) || Number(tableData.group) !== Number(slot.group) || Number(tableData.season) !== seasonNum) {
        console.error('[INIT] TABLE MISMATCH:', { table: tableData, slot: slot });
        throw new functions.https.HttpsError('failed-precondition', 'LEAGUE_TABLE_MISMATCH');
      }

      const stats = tableData.stats || {};
      const botId = Object.keys(stats).find(id => {
        const team = stats[id];
        return Number(team.rank) === Number(slot.rank) && team.isBot === true;
      });

      if (!botId) {
        console.error('[INIT] BOT FAILED: No bot at rank', slot.rank);
        throw new functions.https.HttpsError('failed-precondition', 'BOT_NOT_FOUND_IN_SLOT');
      }
      console.log('[INIT] BOT FOUND:', botId);
      const botRowsAtRank = Object.entries(stats).filter(([, team]) => Number(team?.rank) === Number(slot.rank));
      if (botRowsAtRank.length !== 1 || botRowsAtRank[0][0] !== botId) {
        throw new functions.https.HttpsError('failed-precondition', 'LEAGUE_TABLE_SLOT_CONFLICT');
      }

      // The schedule must already exist. Registration never creates it.
      const matchesQuery = db.collection('matches_v2')
        .where('season', '==', seasonNum)
        .where('leagueId', '==', leagueId)
        .where('level', '==', Number(slot.division))
        .where('groupId', '==', Number(slot.group))
        .where('version', '==', 140);
      const matchesSnap = await t.get(matchesQuery);

      if (matchesSnap.size !== 56) {
        console.error('[INIT] WORLD INCOMPLETE: expected 56 matches, got', matchesSnap.size);
        throw new functions.https.HttpsError('failed-precondition', 'WORLD_NOT_READY');
      }

      if (!validateRegistrationSchedule(matchesSnap.docs.map(doc => doc.data() || {}), Number(slot.rank), botId)) {
        console.error('[INIT] WORLD INCONSISTENT: fixture participant does not match rank slot', { tableId, rank: slot.rank });
        throw new functions.https.HttpsError('failed-precondition', 'LEAGUE_SCHEDULE_SLOT_CONFLICT');
      }

      // --- 2. Р’РЎР• Р—РђРџРРЎР (WRITES) ---
      console.log('[INIT] Transaction: Proceeding to WRITES');

      t.update(slotDoc.ref, { 
        status: 'OCCUPIED', 
        occupantId: userId, 
        updatedAt: serverTimestamp() 
      });

      const newStats = { ...stats };
      delete newStats[botId];
      newStats[userId] = { 
        id: userId, name: clubName, rank: slot.rank, 
        matchesPlayed: 0, wins: 0, draws: 0, losses: 0, points: 0, diff: 0, 
        isBot: false 
      };
      t.update(tableRef, { 
        stats: newStats, 
        updatedAt: serverTimestamp() 
      });

      // Stage 3A.8: the bot is a real players_v14 club. Once its slot is
      // claimed, remove the bot profile so no orphaned bot club remains.
      const botPlayerRef = db.collection('players_v14').doc(botId);
      t.delete(botPlayerRef);

      // Replace the claimed BOT in all 56 prebuilt matches. Match document IDs
      // remain rank-based, so the calendar itself is not regenerated.
      for (const matchDoc of matchesSnap.docs) {
        const match = matchDoc.data() || {};
        const patch = {};
        if (match.homeId === botId) {
          patch.homeId = userId;
          patch.homeName = clubName;
        }
        if (match.awayId === botId) {
          patch.awayId = userId;
          patch.awayName = clubName;
        }
        if (Object.keys(patch).length) {
          t.update(matchDoc.ref, patch);
        }
      }

      const totalPlayers = (globalStatsSnap.exists ? (globalStatsSnap.data().totalPlayers || 1000) : 1000) + 1;
      t.set(statsRef, { totalPlayers, updatedAt: serverTimestamp() }, { merge: true });

      const startingSquad = generateStartingSquad();
      const initialState = {
        id: userId, email, numericId: totalPlayers,
        displayName: clubName, clubName, country: "International",
        selectedLeagueId: leagueId, leagueLevel: slot.division, groupId: slot.group, rank: slot.rank,
        credits: 1000000, crystals: 50, experiencePoints: 0, managerLevel: 1,
        lastProcessedSeason: seasonNum, lastLoginDate: new Date().toISOString(),
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        version: 140, ownedPlayers: startingSquad,
        lineup: {
          carry: startingSquad[0].id, mid: startingSquad[1].id, offlane: startingSquad[2].id,
          support: startingSquad[3].id, full_support: startingSquad[4].id,
          sub_carry: startingSquad[5].id, sub_mid: startingSquad[6].id,
          sub_offlane: startingSquad[7].id, sub_support: startingSquad[8].id,
          sub_full_support: startingSquad[9].id
        },
        staff: { coach: null }, strategy: "Balanced Play",
        arena: { capacity: 5000 }, hq: {}, bootcamp: {}, academy: {}, medical: {}
      };
      
      t.set(playerRef, initialState);

      console.log('[INIT] SUCCESS for UID:', userId);

      return { 
        success: true, 
        version: 'v' + REGISTRATION_VERSION,
        clubName, 
        tier: slot.division, 
        group: slot.group, 
        rank: slot.rank,
        numericId: totalPlayers
      };
    });

  } catch (e) {
    const errorDetails = {
      name: e?.name,
      message: e?.message,
      code: e?.code,
      details: e?.details,
      stack: e?.stack,
      userId,
      version: REGISTRATION_VERSION,
      leagueId,
      clubName,
      phase: 'INITIALIZE_CLUB',
      registrationContext: {
        userId,
        clubName,
        leagueId,
        season: 'unknown',
        division: 'unknown',
        group: 'unknown',
        slotFound: false,
        tableFound: false,
        botFound: false
      }
    };

    console.error('[INIT CRITICAL ERROR]:', JSON.stringify(errorDetails, null, 2));

    if (e instanceof functions.https.HttpsError) {
      const originalPayload = {
        originalErrorName: e.name,
        originalErrorCode: e.code,
        context: 'initializeClub'
      };

      if (e.code === 'internal') {
        throw new functions.https.HttpsError('internal', 'CLUB_INITIALIZATION_FAILED', originalPayload);
      }

      throw new functions.https.HttpsError(e.code, e.message, originalPayload);
    }

    throw new functions.https.HttpsError('internal', 'CLUB_INITIALIZATION_FAILED', {
      originalErrorName: errorDetails.name,
      originalErrorCode: errorDetails.code,
      context: 'initializeClub'
    });
  }
});

