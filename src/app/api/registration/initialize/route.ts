import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { getAppCheck } from 'firebase-admin/app-check';
import { getAdminDb } from '@/lib/firebase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RegistrationMatchPlan =
  | { ok: true; updates: Array<{ matchId: string | null; patch: Record<string, any> }> }
  | { ok: false; reason: string; updates: []; matchId?: string };

type RegistrationStandingTransfer =
  | { ok: true; stats: Record<string, Record<string, any>>; transferredRow: Record<string, any> }
  | { ok: false; reason: string };

type RegistrationCore = {
  isEligibleRegistrationSlot: (slot: Record<string, unknown>, season: number) => boolean;
  validateRegistrationSchedule: (matches: Record<string, unknown>[], rank: number, botId: string) => boolean;
  generateStartingSquad: () => Record<string, unknown>[];
  buildRegistrationMatchPlan: (
    matches: Record<string, unknown>[],
    botId: string,
    userId: string,
    clubName: string,
    nowMs?: number,
  ) => RegistrationMatchPlan;
  transferBotStandingToUser: (
    stats: Record<string, Record<string, any>>,
    botId: string,
    userId: string,
    clubName: string,
    rank: number,
  ) => RegistrationStandingTransfer;
};

// Keep the same audited invariants and squad generator as the emulator callable.
const registrationCore = require('../../../../../functions/registration-core') as RegistrationCore;

const REGISTRATION_VERSION = 'v170';
const LEAGUE_ID = 'ALPHA';
const MAX_BODY_BYTES = 4096;

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'Pragma': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

function safeClubName(value: unknown, uid: string): string {
  if (typeof value !== 'string') return `Commander_${uid.slice(0, 4)}`;
  const normalized = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 25);
  return normalized || `Commander_${uid.slice(0, 4)}`;
}

function mapRegistrationError(error: unknown): { status: number; code: string } {
  const message = error instanceof Error ? error.message : '';
  const known: Record<string, { status: number; code: string }> = {
    SEASON_CONFIG_MISSING: { status: 503, code: 'SEASON_CONFIG_MISSING' },
    WORLD_INITIALIZING: { status: 503, code: 'WORLD_INITIALIZING' },
    SEASON_TRANSITION_IN_PROGRESS: { status: 409, code: 'SEASON_TRANSITION_IN_PROGRESS' },
    WORLD_NOT_READY: { status: 503, code: 'WORLD_NOT_READY' },
    LEAGUE_TABLE_MISSING: { status: 503, code: 'LEAGUE_TABLE_MISSING' },
    LEAGUE_TABLE_MISMATCH: { status: 503, code: 'LEAGUE_TABLE_MISMATCH' },
    BOT_NOT_FOUND_IN_SLOT: { status: 503, code: 'BOT_NOT_FOUND_IN_SLOT' },
    INVALID_LEAGUE_SLOT: { status: 409, code: 'INVALID_LEAGUE_SLOT' },
    NO_FREE_SLOTS_IN_LEAGUE: { status: 409, code: 'NO_FREE_SLOTS_IN_LEAGUE' },
    SLOT_MATCH_IN_PROGRESS: { status: 409, code: 'SLOT_MATCH_IN_PROGRESS' },
    SLOT_MATCH_DUE: { status: 409, code: 'SLOT_MATCH_DUE' },
    SLOT_MATCH_TIME_UNKNOWN: { status: 409, code: 'SLOT_MATCH_TIME_UNKNOWN' },
    NO_UPCOMING_FIXTURES_FOR_SLOT: { status: 409, code: 'NO_UPCOMING_FIXTURES_FOR_SLOT' },
    LEAGUE_TABLE_SLOT_CONFLICT: { status: 503, code: 'LEAGUE_TABLE_SLOT_CONFLICT' },
    LEAGUE_SCHEDULE_SLOT_CONFLICT: { status: 503, code: 'LEAGUE_SCHEDULE_SLOT_CONFLICT' },
  };
  return known[message] || { status: 500, code: 'CLUB_INITIALIZATION_FAILED' };
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    return json(415, { success: false, error: 'UNSUPPORTED_MEDIA_TYPE' });
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json(413, { success: false, error: 'REQUEST_TOO_LARGE' });
  }

  const authorization = request.headers.get('authorization') || '';
  const tokenMatch = authorization.match(/^Bearer ([^\s]+)$/);
  if (!tokenMatch) {
    return json(401, { success: false, error: 'AUTHENTICATION_REQUIRED' });
  }

  try {
    const db = getAdminDb();
    const decoded = await getAuth().verifyIdToken(tokenMatch[1], true);
    const userId = decoded.uid;
    const email = typeof decoded.email === 'string' ? decoded.email : '';

    if (!email) {
      return json(403, { success: false, error: 'EMAIL_REQUIRED' });
    }

    // App Check enforcement can be enabled for staging after the registered Web
    // App has its attestation provider configured. If enabled, missing or invalid
    // attestation is rejected; it is never silently bypassed.
    if (process.env.FIREBASE_APPCHECK_REQUIRED === 'true') {
      const appCheckToken = request.headers.get('X-Firebase-AppCheck');
      if (!appCheckToken) {
        return json(401, { success: false, error: 'APP_CHECK_REQUIRED' });
      }
      try {
        await getAppCheck().verifyToken(appCheckToken);
      } catch {
        return json(401, { success: false, error: 'APP_CHECK_INVALID' });
      }
    }

    let payload: unknown;
    try {
      const rawBody = await request.text();
      if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
        return json(413, { success: false, error: 'REQUEST_TOO_LARGE' });
      }
      payload = JSON.parse(rawBody);
    } catch {
      return json(400, { success: false, error: 'INVALID_JSON' });
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return json(400, { success: false, error: 'INVALID_REQUEST' });
    }

    const body = payload as Record<string, unknown>;
    if (Object.keys(body).some((key) => key !== 'clubName')) {
      return json(400, { success: false, error: 'INVALID_REQUEST_FIELDS' });
    }

    const clubName = safeClubName(body.clubName, userId);
    const playerRef = db.collection('players_v14').doc(userId);
    const configRef = db.collection('system_v1').doc('season_config');
    const statsRef = db.collection('system_v1').doc('global_stats');
    const auditRef = db.collection('security_audit_v1').doc();

    const result = await db.runTransaction(async (transaction) => {
      // Idempotency: a repeated request for an already-created account returns
      // its existing result and never allocates a second slot or squad.
      const playerSnapshot = await transaction.get(playerRef);
      if (playerSnapshot.exists) {
        const existing = playerSnapshot.data() || {};
        return {
          success: true,
          version: REGISTRATION_VERSION,
          clubName: existing.clubName,
          tier: existing.leagueLevel,
          group: existing.groupId,
          rank: existing.rank,
          numericId: existing.numericId,
          alreadyInitialized: true,
        };
      }

      const configSnapshot = await transaction.get(configRef);
      if (!configSnapshot.exists) throw new Error('SEASON_CONFIG_MISSING');
      const config = configSnapshot.data() || {};
      const seasonNum = Number(config.activeSeasonNumber || 1);
      const phase = config.phase || 'UNKNOWN';

      if (config.worldReady !== true) throw new Error('WORLD_INITIALIZING');
      if (phase !== 'REGULAR_SEASON' && phase !== 'ACTIVE') {
        throw new Error('SEASON_TRANSITION_IN_PROGRESS');
      }

      const globalStatsSnapshot = await transaction.get(statsRef);
      const slotsQuery = db.collection('league_slots_v1').where('season', '==', seasonNum);
      const slotsSnapshot = await transaction.get(slotsQuery);
      const leagueSlots = slotsSnapshot.docs.filter((document) => {
        const slot = document.data() || {};
        return slot.leagueId === LEAGUE_ID && Number(slot.season) === seasonNum;
      });

      if (leagueSlots.length !== 120) throw new Error('WORLD_NOT_READY');

      const freeSlots = leagueSlots.filter((document) =>
        registrationCore.isEligibleRegistrationSlot(document.data() || {}, seasonNum)
      );
      if (freeSlots.length === 0) throw new Error('NO_FREE_SLOTS_IN_LEAGUE');

      const slotDocument = freeSlots[Math.floor(Math.random() * freeSlots.length)];
      const slot = slotDocument.data() || {};
      if (slot.status !== 'FREE' || slot.occupantId || Number(slot.season) !== seasonNum) {
        throw new Error('INVALID_LEAGUE_SLOT');
      }

      const tableId = `table_v140_S${seasonNum}_L${LEAGUE_ID}_V${slot.division}_G${slot.group}`;
      const tableRef = db.collection('league_tables_v2').doc(tableId);
      const tableSnapshot = await transaction.get(tableRef);
      if (!tableSnapshot.exists) throw new Error('LEAGUE_TABLE_MISSING');

      const tableData = tableSnapshot.data() || {};
      if (
        Number(tableData.level) !== Number(slot.division) ||
        Number(tableData.group) !== Number(slot.group) ||
        Number(tableData.season) !== seasonNum
      ) throw new Error('LEAGUE_TABLE_MISMATCH');

      const stats = (tableData.stats || {}) as Record<string, Record<string, unknown>>;
      const botId = Object.keys(stats).find((id) =>
        Number(stats[id]?.rank) === Number(slot.rank) && stats[id]?.isBot === true
      );
      if (!botId) throw new Error('BOT_NOT_FOUND_IN_SLOT');

      const rowsAtRank = Object.entries(stats).filter(([, team]) =>
        Number(team?.rank) === Number(slot.rank)
      );
      if (rowsAtRank.length !== 1 || rowsAtRank[0][0] !== botId) {
        throw new Error('LEAGUE_TABLE_SLOT_CONFLICT');
      }

      const matchesQuery = db.collection('matches_v2')
        .where('season', '==', seasonNum)
        .where('leagueId', '==', LEAGUE_ID)
        .where('level', '==', Number(slot.division))
        .where('groupId', '==', Number(slot.group))
        .where('version', '==', 140);
      const matchesSnapshot = await transaction.get(matchesQuery);
      if (matchesSnapshot.size !== 56) throw new Error('WORLD_NOT_READY');

      const matches = matchesSnapshot.docs.map((document) => document.data() || {});
      if (!registrationCore.validateRegistrationSchedule(matches, Number(slot.rank), botId)) {
        throw new Error('LEAGUE_SCHEDULE_SLOT_CONFLICT');
      }

      const matchPlan = registrationCore.buildRegistrationMatchPlan(
        matchesSnapshot.docs.map((document) => ({ ...(document.data() || {}), id: document.id })),
        botId,
        userId,
        clubName,
        Date.now(),
      );
      if (!matchPlan.ok) throw new Error(matchPlan.reason);

      const standingTransfer = registrationCore.transferBotStandingToUser(
        stats,
        botId,
        userId,
        clubName,
        Number(slot.rank),
      );
      if (!standingTransfer.ok) throw new Error(standingTransfer.reason);

      // All reads and safety checks are complete. Firestore commits every mutation atomically.
      transaction.update(slotDocument.ref, {
        status: 'OCCUPIED',
        occupantId: userId,
        occupancyGeneration: Math.max(0, Number(slot.occupancyGeneration) || 0) + 1,
        lastOccupantId: botId,
        lastTransitionReason: 'NEW_REGISTRATION',
        lastTransitionAt: new Date(),
        updatedAt: new Date(),
      });

      // The slot owns its season-to-date record. Transfer identity only; do not
      // reset wins, draws, losses, points, match count, diff or additive fields.
      transaction.update(tableRef, {
        stats: standingTransfer.stats,
        updatedAt: new Date(),
      });

      transaction.delete(db.collection('players_v14').doc(botId));

      // Historical completed fixtures remain byte-for-byte unchanged. Only
      // future, not-yet-due fixtures are rebound to the new club.
      for (const update of matchPlan.updates) {
        const matchDocument = matchesSnapshot.docs.find((document) => document.id === update.matchId);
        if (matchDocument) transaction.update(matchDocument.ref, update.patch);
      }

      const totalPlayers =
        (globalStatsSnapshot.exists
          ? Number(globalStatsSnapshot.data()?.totalPlayers || 1000)
          : 1000) + 1;
      transaction.set(statsRef, { totalPlayers, updatedAt: new Date() }, { merge: true });

      const startingSquad = registrationCore.generateStartingSquad();
      const initialState = {
        id: userId,
        email,
        numericId: totalPlayers,
        displayName: clubName,
        clubName,
        country: 'International',
        selectedLeagueId: LEAGUE_ID,
        leagueLevel: slot.division,
        groupId: slot.group,
        rank: slot.rank,
        credits: 1000000,
        crystals: 50,
        experiencePoints: 0,
        managerLevel: 1,
        lastProcessedSeason: seasonNum,
        lastLoginDate: new Date().toISOString(),
        createdAt: new Date(),
        updatedAt: new Date(),
        version: 140,
        ownedPlayers: startingSquad,
        lineup: {
          carry: startingSquad[0].id,
          mid: startingSquad[1].id,
          offlane: startingSquad[2].id,
          support: startingSquad[3].id,
          full_support: startingSquad[4].id,
          sub_carry: startingSquad[5].id,
          sub_mid: startingSquad[6].id,
          sub_offlane: startingSquad[7].id,
          sub_support: startingSquad[8].id,
          sub_full_support: startingSquad[9].id,
        },
        staff: { coach: null },
        strategy: 'Balanced Play',
        arena: { capacity: 5000 },
        hq: {},
        bootcamp: {},
        academy: {},
        medical: {},
      };

      transaction.set(playerRef, initialState);
      transaction.create(auditRef, {
        event: 'CLUB_REGISTRATION_COMPLETED',
        actorUid: userId,
        season: seasonNum,
        leagueId: LEAGUE_ID,
        division: slot.division,
        group: slot.group,
        rank: slot.rank,
        registrationVersion: REGISTRATION_VERSION,
        createdAt: new Date(),
      });

      return {
        success: true,
        version: REGISTRATION_VERSION,
        clubName,
        tier: slot.division,
        group: slot.group,
        rank: slot.rank,
        numericId: totalPlayers,
        alreadyInitialized: false,
      };
    });

    return json(200, result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '';
    const errorCode = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code || '').toLowerCase()
      : '';
    if (errorCode.includes('id-token-revoked') || message.toLowerCase().includes('id token has been revoked')) {
      return json(401, { success: false, error: 'AUTH_TOKEN_REVOKED' });
    }
    if (errorCode.includes('id-token-expired') || errorCode.includes('invalid-id-token') || errorCode.includes('argument-error') || errorCode.includes('invalid-argument') || message.toLowerCase().includes('id token has expired') || message.toLowerCase().includes('decoding firebase id token failed')) {
      return json(401, { success: false, error: 'AUTH_TOKEN_INVALID' });
    }
    if (message === 'AUTHENTICATION_REQUIRED') {
      return json(401, { success: false, error: 'AUTHENTICATION_REQUIRED' });
    }

    const mapped = mapRegistrationError(error);
    if (mapped.status === 500) {
      console.error('[REGISTRATION API] Failed:', error);
    } else {
      console.warn('[REGISTRATION API] Rejected:', mapped.code);
    }
    return json(mapped.status, { success: false, error: mapped.code });
  }
}
