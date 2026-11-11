
'use client';

/**
 * Р“Р»РѕР±Р°Р»СЊРЅРѕРµ Р»РѕРєР°Р»СЊРЅРѕРµ С…СЂР°РЅРёР»РёС‰Рµ v245 (SERVER AUTHORITATIVE).
 * РџСЂСЏРјС‹Рµ Р·Р°РїРёСЃРё updateDoc СѓРґР°Р»РµРЅС‹ Рё Р·Р°РјРµРЅРµРЅС‹ РЅР° Server Actions.
 */

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useMemo } from 'react';
import { Player, StaffMember, StaffRole, generateScoutedPlayer, getRandomStartingSquad } from './moba-data';
import { getMoscowTime, getGlobalSeasonInfo, getMoscowDateString, getLevelThreshold } from './time-utils';
import { useUser, initializeFirebase } from '@/firebase';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { claimDailyRewardAction, purchasePremiumAction } from '@/app/actions/economy';
import { markMatchViewedAction } from '@/app/actions/match-report';
import { createTrialMatchAction } from '@/app/actions/trial-match-resolver';
import { startConstructionAction, accelerateConstructionAction, finalizeConstructionsAction } from '@/app/actions/infrastructure';
import { updateLineupAction, startDailyTrainingAction, listPlayerOnMarketAction } from '@/app/actions/gameplay';
import { setFoundationTrainingFocusAction } from '@/app/actions/foundation-management';
import { useToast } from '@/hooks/use-toast';
import { createDeterministicBotSquad, buildMatchTeamSnapshot } from './match-simulation';
import { runMatchEngine } from './match-engine';
import { hash32 } from './hash-utils';


export { getLevelThreshold };

export { STAT_KEYS } from './player-stats';

export type LineupSlot = 
  | 'carry' | 'mid' | 'offlane' | 'support' | 'full_support' 
  | 'sub_carry' | 'sub_mid' | 'sub_offlane' | 'sub_support' | 'sub_full_support'
  | 'res1' | 'res2' | 'res3' | 'res4' | 'res5' | 'res6' | 'res7' | 'res8';

export interface Gift {
  id: string;
  type: 'architect' | 'teambuilding' | 'grant' | 'shard' | 'curse' | 'secret';
  value: number;
  label: string;
  senderId?: string;
  senderName?: string;
  createdAt: string;
  claimed: boolean;
}

interface TrophyRecord {
  id: string;
  name: string;
  type: string;
  date: string;
  reward?: number;
}

interface GameState {
  credits: number; crystals: number; experiencePoints: number; managerLevel: number;
  leagueLevel: number; groupId: number; selectedLeagueId: string | null;
  displayName: string; id: string; numericId: number | null; isLoaded: boolean;
  clubName: string | null; clubLogo: string | null;
  lineup: Record<LineupSlot, string | null>;
  ownedPlayers: Player[]; youthAcademyPlayers: Player[];
  scoutingCandidates: Player[]; lastScoutDate: string | null;
  staff: Record<StaffRole, StaffMember | null>;
  strategy: string; lineSettings: any;
  tactics?: Record<string, any>;
  salaryLedger?: any | null;
  salaryPayments?: any[];
  rewardDay: number; lastRewardClaimDate: string | null;
  matchHistory: any[]; lastSeenMatchDay: number;
  managerSkills: { sponsors: number; agents: number; training: number; medical: number };
  arena: any; hq: any; bootcamp: any; academy: any; medical: any;
  country: string | null; isPremium: boolean; premiumUntil: string | null;
  activeSeasonNumber: number; activeLicenseTier: number | null;
  rank: number; seasonDay: number; seasonNumber: number;
  isSyncing: boolean; language: string;
  isDataReady: boolean; isTeamLoaded: boolean; isInitialSyncDone: boolean; allSeasonMatches: any[]; nextMatch: any | null; isMatchesLoading: boolean;
  lastProcessedSeason: number;
  trophies: TrophyRecord[];
  version: number;
  
  availableGiftsToSend: Gift[];
  receivedGifts: Gift[];
  lastGiftGenDate: string | null;

  addCrystals: (amount: number) => void;
  addCredits: (amount: number) => void;
  updatePlayer: (id: string, data: Partial<Player>, costCredits?: number, costCrystals?: number) => void;
  removePlayer: (id: string, refund: number) => void;
  assignToRole: (role: LineupSlot, playerId: string | null) => void;
  updateLineup: (updates: Partial<Record<LineupSlot, string | null>>) => void;
  updateTactics: (strategy: string, lineSettings: any) => void;
  claimReward: (credits: number, crystals: number) => void;
  setLanguage: (lang: string) => void;
  purchaseLicense: (tier: number, cost: number) => boolean;
  purchasePremium: () => boolean;
  setTrainingFocus: (playerId: string, focus: string | null) => void;
  startDailyPlayerTraining: (playerId: string, focus: string) => void;
  claimDailyPlayerTraining: (playerId: string) => void;
  recoverAllFatigue: (type: 'credits' | 'crystals') => boolean;
  hireStaffMember: (member: StaffMember) => void;
  trainStaffSkill: (role: StaffRole, skillKey: 'primary' | 'secondary', cost: number) => boolean;
  trainHeroSkill: (heroId: string, skillKey: string, amount: number) => Promise<boolean>;
  addPlayerDirectly: (player: Player) => void;
  addYouthPlayerDirectly: (player: Player) => void;
  promoteYouthPlayer: (playerId: string) => void;
  updateProfileName: (name: string) => void;
  updateProfileCountry: (country: string) => void;
  recordMatch: (winner: string, result: any, reward: number, opponentName: string, type: string, playedAt: string, matchId?: string, extraData?: any) => void;
  markMatchIdAsSeen: (id: string) => Promise<void>;
  deleteMatchHistoryEntry: (id: string) => void;
  clearMatchHistory: () => void;
  upgradeManagerSkill: (skillKey: keyof GameState['managerSkills']) => void;
  startArenaConstruction: (id: string, cost?: number) => Promise<boolean>;
  startHQConstruction: (id: string, cost?: number) => Promise<boolean>;
  startBootcampConstruction: (id: string, cost?: number) => Promise<boolean>;
  startAcademyConstruction: (id: string, cost?: number) => Promise<boolean>;
  startMedicalConstruction: (id: string, cost?: number) => Promise<boolean>;
  startCapacityExpansion: (seats: number, cost: number) => boolean;
  accelerateConstruction: (type: string, id: string, multiplier: number, price: number) => Promise<boolean>;
  checkConstructions: () => void;
  scoutCandidates: () => void;
  recruitCandidate: (playerId: string) => void;
  clearScoutingReport: () => void;
  payStaffSalaries: () => Promise<void>;
  healPlayer: (playerId: string, type: 'credits' | 'crystals', cost: number) => void;
  launchFanCampaign: (type: 'open_day' | 'autograph' | 'ultras_trip', cost: number, fans: number, loyalty: number) => void;
  addTrophy: (trophy: TrophyRecord) => void;
  setWorldReady: (isReady: boolean) => void;
  resetProfile: () => Promise<void>;
  
  sendGift: (gift: Gift, friendId: string, friendName: string) => Promise<boolean>;
  claimGift: (gift: Gift) => Promise<boolean>;
  generateDailyGifts: (gifts: Gift[]) => void;
  
  runTrialMatch: () => Promise<string | null>;
  saveToLocal: (state: Partial<GameState>) => void;
}

const STORAGE_KEY = 'lote_game_state_v245';
const VIEWED_MATCH_IDS_KEY = `${STORAGE_KEY}:viewed-match-ids`;

function rememberViewedMatchId(id: string) {
  if (typeof window === 'undefined' || !id) return;
  try {
    const current = JSON.parse(localStorage.getItem(VIEWED_MATCH_IDS_KEY) || '[]');
    const ids = Array.isArray(current) ? current.map(String).filter(Boolean) : [];
    if (!ids.includes(id)) ids.push(id);
    localStorage.setItem(VIEWED_MATCH_IDS_KEY, JSON.stringify(ids.slice(-2000)));
  } catch {
    // Counter must never depend on localStorage being available.
  }
}

const DEFAULT_STATE: GameState = {
  credits: 1000000, crystals: 50, experiencePoints: 0, managerLevel: 1,
  leagueLevel: 9, groupId: 1, selectedLeagueId: null,
  displayName: 'Local Manager', id: '', numericId: null, isLoaded: false, isTeamLoaded: false, isInitialSyncDone: false,
  clubName: null, clubLogo: null,
  lineup: { 
    carry: null, mid: null, offlane: null, support: null, full_support: null, 
    sub_carry: null, sub_mid: null, sub_offlane: null, sub_support: null, sub_full_support: null,
    res1: null, res2: null, res3: null, res4: null, res5: null, res6: null, res7: null, res8: null 
  },
  ownedPlayers: [], youthAcademyPlayers: [], scoutingCandidates: [], lastScoutDate: null,
  staff: { coach: null, analyst: null, scout: null, doctor: null, financier: null },
  strategy: 'Balanced Play', lineSettings: { carry: 'standard', mid: 'standard', offlane: 'standard' },
  tactics: { direction: 'mid', style: 'control', pressing: 'medium', rigidity: 'medium', tempo: 'balanced', aggression: 'medium', range: 'medium' },
  activeLicenseTier: null, rank: 0, salaryLedger: null, salaryPayments: [],
  rewardDay: 1, lastRewardClaimDate: null, matchHistory: [], lastSeenMatchDay: 0,
  managerSkills: { sponsors: 0, agents: 0, training: 0, medical: 0 },
  arena: { capacity: 5000 }, hq: {}, bootcamp: {}, academy: {}, medical: {},
  country: null, isPremium: false, premiumUntil: null, activeSeasonNumber: 1, seasonNumber: 1, seasonDay: 1, isSyncing: false, language: 'ru',
  isDataReady: false, allSeasonMatches: [], nextMatch: null, isMatchesLoading: true,
  lastProcessedSeason: 0, trophies: [], version: 245,
  availableGiftsToSend: [], receivedGifts: [], lastGiftGenDate: null,
  addCrystals: () => {}, addCredits: () => {}, updatePlayer: () => {}, removePlayer: () => {}, assignToRole: () => {}, updateLineup: () => {}, updateTactics: () => {},
  claimReward: () => {}, setLanguage: () => {}, purchaseLicense: () => false, purchasePremium: () => false,
  setTrainingFocus: () => {}, startDailyPlayerTraining: () => {}, claimDailyPlayerTraining: () => {},
  recoverAllFatigue: () => false, hireStaffMember: () => {}, trainStaffSkill: () => false, trainHeroSkill: async () => false,
  addPlayerDirectly: () => {}, addYouthPlayerDirectly: () => {}, promoteYouthPlayer: () => {},
  updateProfileName: () => {}, updateProfileCountry: () => {}, recordMatch: () => {},
  markMatchIdAsSeen: async () => {}, deleteMatchHistoryEntry: () => {}, clearMatchHistory: () => {},
  upgradeManagerSkill: () => {},
  startArenaConstruction: async () => false, startHQConstruction: async () => false, startBootcampConstruction: async () => false,
  startAcademyConstruction: async () => false, startMedicalConstruction: async () => false, startCapacityExpansion: () => false,
  accelerateConstruction: async () => false, checkConstructions: () => {},
  scoutCandidates: () => {}, recruitCandidate: () => {}, clearScoutingReport: () => {},
  payStaffSalaries: async () => {}, healPlayer: () => {}, launchFanCampaign: () => {},
  addTrophy: () => {}, setWorldReady: () => {}, resetProfile: async () => {},
  sendGift: async () => false, claimGift: async () => false, generateDailyGifts: () => {},
  runTrialMatch: async () => null,
  saveToLocal: () => {}
};

const GameStateContext = createContext<GameState | undefined>(undefined);

export function GameStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GameState>(DEFAULT_STATE);
  const { user, isUserLoading } = useUser();
  const { toast } = useToast();
  const staticSeasonInfo = useMemo(() => getGlobalSeasonInfo(), []);

  const saveToLocal = useCallback((updates: Partial<GameState>) => {
    setState(prev => {
      const newState = { ...prev, ...updates };
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
      }
      return newState;
    });
  }, []);

  useEffect(() => {
    if (isUserLoading) return;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (user && parsed.id && parsed.id !== user.uid) {
          setState(prev => ({ ...DEFAULT_STATE, id: user.uid, isLoaded: true, language: parsed.language || 'ru' }));
          return;
        }
        const migratedHistory = Array.isArray(parsed.matchHistory)
          ? parsed.matchHistory.map((m: any) => {
              // Legacy report records from pre-v1 match core are the source of
              // the stuck unread badge. They are historical records, not new
              // reports, so close them once during the migration.
              if (m && m.seen !== true && m.reportStatus !== 'viewed' && !String(m.engineVersion || '').startsWith('forge-match-core')) {
                return { ...m, seen: true, reportStatus: 'viewed', viewedAt: new Date().toISOString(), legacyMigrated: true };
              }
              return m;
            })
          : [];
        setState(prev => ({ ...DEFAULT_STATE, ...parsed, matchHistory: migratedHistory, id: user?.uid || parsed.id || '', isLoaded: true }));
      } catch (e) { setState(prev => ({ ...prev, isLoaded: true })); }
    } else { setState(prev => ({ ...prev, id: user?.uid || '', isLoaded: true })); }
  }, [isUserLoading, user]);

  // РЎРРќРҐР РћРќРР—РђР¦РРЇ РЎ FIRESTORE
  useEffect(() => {
    if (!user?.uid || !state.isLoaded) {
      if (state.isLoaded && !user) setState(prev => ({ ...prev, isInitialSyncDone: true }));
      return;
    }
    const { firestore: db } = initializeFirebase();
    const playerRef = doc(db, 'players_v14', user.uid);
    const unsubscribe = onSnapshot(playerRef, (snapshot) => {
      if (snapshot.exists()) {
        const d = snapshot.data();
        saveToLocal({
          ...d,
          isTeamLoaded: true,
          isInitialSyncDone: true,
          credits: Number(d.credits),
          crystals: Number(d.crystals)
        } as any);
      } else {
        setState(prev => ({ ...prev, isTeamLoaded: false, isInitialSyncDone: true }));
      }
    });
    return () => unsubscribe();
  }, [user?.uid, state.isLoaded, saveToLocal]);

  // Р—РђР©РР©Р•РќРќР«Р• Р”Р•Р™РЎРўР’РРЇ (SERVER ACTIONS)
  
  const claimReward = useCallback(async () => {
    if (!user?.uid) return;
    const res = await claimDailyRewardAction(await user.getIdToken());
    if (res.success) {
      toast({ title: state.language === 'ru' ? "РќР°РіСЂР°РґР° РїРѕР»СѓС‡РµРЅР°!" : "Reward Claimed!" });
    } else {
      toast({ variant: "destructive", title: ('error' in res ? String(res.error) : 'REWARD_CLAIM_FAILED') });
    }
  }, [user?.uid, state.language, toast]);

  const purchasePremium = useCallback(() => {
    if (!user?.uid) return false;
    user.getIdToken().then(purchasePremiumAction).then(res => {
      if (!res.success) toast({ variant: "destructive", title: ('error' in res ? String(res.error) : 'PREMIUM_PURCHASE_FAILED') });
    });
    return true;
  }, [user?.uid, toast]);

  const updateLineup = useCallback((updates: any) => {
    if (!user?.uid) return;
    user.getIdToken().then((idToken) => updateLineupAction(idToken, updates));
  }, [user?.uid]);

  const setTrainingFocus = useCallback(async (pId: string, focus: string | null) => {
    if (!user?.uid) return;
    try {
      const result = await setFoundationTrainingFocusAction(await user.getIdToken(true), pId, focus);
      if (!result.success) toast({ variant: 'destructive', title: result.error || 'TRAINING_FOCUS_FAILED' });
    } catch (error: any) {
      toast({ variant: 'destructive', title: error?.message || 'TRAINING_FOCUS_FAILED' });
    }
  }, [user?.uid, toast]);

  const startDailyPlayerTraining = useCallback((pId: string, focus: string) => {
    if (!user?.uid) return;
    user.getIdToken().then((idToken) => startDailyTrainingAction(idToken, pId, focus));
  }, [user?.uid]);

  const startConstruction = useCallback(async (section: 'arena' | 'hq' | 'bootcamp' | 'academy' | 'medical', id: string): Promise<boolean> => {
    if (!user?.uid) return false;
    try {
      const idToken = await user.getIdToken(true);
      const res = await startConstructionAction(idToken, section, id);
      if (!res.success) {
        toast({ variant: 'destructive', title: ('error' in res ? String(res.error) : 'CONSTRUCTION_FAILED') });
        return false;
      }
      return true;
    } catch {
      toast({ variant: 'destructive', title: 'CONSTRUCTION_FAILED' });
      return false;
    }
  }, [user?.uid, toast]);

  const startArenaConstruction = useCallback((id: string, _cost?: number) => startConstruction('arena', id), [startConstruction]);
  const startHQConstruction = useCallback((id: string, _cost?: number) => startConstruction('hq', id), [startConstruction]);
  const startBootcampConstruction = useCallback((id: string, _cost?: number) => startConstruction('bootcamp', id), [startConstruction]);
  const startAcademyConstruction = useCallback((id: string, _cost?: number) => startConstruction('academy', id), [startConstruction]);
  const startMedicalConstruction = useCallback((id: string, _cost?: number) => startConstruction('medical', id), [startConstruction]);

  const accelerateConstruction = useCallback(async (type: string, id: string, multiplier: number, price: number) => {
    if (!user?.uid) return false;
    try {
      const idToken = await user.getIdToken(true);
      const res = await accelerateConstructionAction(idToken, type, id, multiplier);
      if (!res.success) {
        toast({ variant: 'destructive', title: ('error' in res ? String(res.error) : 'ACCELERATION_FAILED') });
        return false;
      }
      return true;
    } catch {
      toast({ variant: 'destructive', title: 'ACCELERATION_FAILED' });
      return false;
    }
  }, [user?.uid, toast]);

  const checkConstructions = useCallback(() => {
    if (!user?.uid) return;
    const sections = [state.arena, state.hq, state.bootcamp, state.academy, state.medical];
    const nowMs = Date.now();
    const hasDue = sections.some((section: any) => Object.values(section?.constructionFinishes || {}).some((v: any) => {
      const finishMs = new Date(String(v)).getTime();
      return Number.isFinite(finishMs) && finishMs <= nowMs;
    }));
    if (!hasDue) return;
    void user.getIdToken(true).then((idToken) => finalizeConstructionsAction(idToken));
  }, [user?.uid, user, state.arena, state.hq, state.bootcamp, state.academy, state.medical]);

  const assignToRole = useCallback((role: LineupSlot, pId: string | null) => {
    updateLineup({ [role]: pId });
  }, [updateLineup]);

  const markMatchIdAsSeen = useCallback(async (id: string): Promise<void> => {
    const matchId = String(id || '').trim();
    if (!matchId) return;

    const viewedAt = new Date().toISOString();

    // РљСЂРёС‚РёС‡РЅРѕ: С„РёРєСЃРёСЂСѓРµРј РїСЂРѕСЃРјРѕС‚СЂ Р”Рћ React setState/router. Р•СЃР»Рё РґРѕРєСѓРјРµРЅС‚ РјР°С‚С‡Р°
    // СѓР¶Рµ СѓРґР°Р»С‘РЅ РёР· Firestore, СЃРµСЂРІРµСЂ РЅРµ СЃРјРѕР¶РµС‚ РµРіРѕ РїРѕРјРµС‚РёС‚СЊ вЂ” РЅРѕ СЃС‡РµС‚С‡РёРє РІСЃС‘ СЂР°РІРЅРѕ
    // РѕР±СЏР·Р°РЅ РёСЃС‡РµР·РЅСѓС‚СЊ. Р­С‚РѕС‚ СЃРїРёСЃРѕРє СЏРІР»СЏРµС‚СЃСЏ Р»РѕРєР°Р»СЊРЅС‹Рј РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРµРј РїСЂРѕСЃРјРѕС‚СЂР°.
    rememberViewedMatchId(matchId);

    const markSeen = (m: any) => {
      if (!m || String(m.id || '') !== matchId) return m;
      return { ...m, seen: true, reportStatus: 'viewed', viewedAt };
    };

    // РЎРЅР°С‡Р°Р»Р° РјРіРЅРѕРІРµРЅРЅРѕ РѕР±РЅРѕРІР»СЏРµРј РѕР±Р° Р»РѕРєР°Р»СЊРЅС‹С… РёСЃС‚РѕС‡РЅРёРєР°. Р­С‚Рѕ РІР°Р¶РЅРѕ:
    // РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ РґРѕР»Р¶РµРЅ СѓРІРёРґРµС‚СЊ 3 в†’ 2 в†’ 1 в†’ 0 Р±РµР· РїРµСЂРµР·Р°РіСЂСѓР·РєРё СЃС‚СЂР°РЅРёС†С‹.
    setState(prev => {
      const nextState = {
        ...prev,
        matchHistory: (prev.matchHistory || []).map(markSeen),
        allSeasonMatches: (prev.allSeasonMatches || []).map(markSeen),
      };
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
      }
      return nextState;
    });

    // РЎРµСЂРІРµСЂРЅР°СЏ Р·Р°РїРёСЃСЊ вЂ” РєР°РЅРѕРЅРёС‡РµСЃРєР°СЏ. Р­С‚Рѕ СѓСЃС‚СЂР°РЅСЏРµС‚ РіРѕРЅРєСѓ, РєРѕРіРґР° Firestore
    // snapshot РІРѕР·РІСЂР°С‰Р°Р» СЃС‚Р°СЂРѕРµ seen=false Рё РІРѕСЃСЃС‚Р°РЅР°РІР»РёРІР°Р» badge РїРѕСЃР»Рµ РїСЂРѕСЃРјРѕС‚СЂР°.
    try {
      if (user?.uid) {
        const idToken = await user.getIdToken(true);
        const result = await markMatchViewedAction(idToken, matchId);
        if (!result?.success) {
          console.warn('[MATCH REPORT] Server acknowledgement failed:', result?.error);
        }
      }
    } catch (error) {
      console.warn('[MATCH REPORT] Could not persist viewed state:', error);
    }
  }, [user]);

  const recordMatch = useCallback(async (
    _winner: string,
    _result: any,
    _reward: number,
    opponentName: string,
    type: string,
    playedAt: string,
    matchId?: string,
    extraData?: any
  ) => {
    if (!user?.uid || !state.ownedPlayers?.length) return;

    const starterSlots: LineupSlot[] = ['carry', 'mid', 'offlane', 'support', 'full_support'];
    const starters = starterSlots
      .map(slot => state.lineup?.[slot])
      .filter((id): id is string => Boolean(id))
      .map(id => state.ownedPlayers.find(player => player.id === id))
      .filter(Boolean) as Player[];
    if (starters.length !== 5) return;

    const id = matchId || `${type}_${user.uid}_${Date.now()}`;
    const botOverall = 23 + (hash32(`${id}:bot-ovr`) % 5);
    const botPlayers = createDeterministicBotSquad(`${id}:${opponentName}`, botOverall);
    const homeName = state.clubName || state.displayName || 'РњРѕР№ РєР»СѓР±';
    const simulation = _result?.engineVersion === 'forge-match-core-v1'
      ? _result
      : runMatchEngine({
          mode: type,
          matchId: id,
          home: buildMatchTeamSnapshot({ ...state, ownedPlayers: starters }, homeName, user.uid),
          away: buildMatchTeamSnapshot({ clubName: opponentName || 'Bot', ownedPlayers: botPlayers, strategy: 'Balanced Play' }, opponentName || 'Bot', `bot_${id}`),
          bestOf: 2,
        });

    const [scoreA, scoreB] = simulation.seriesScore.split('-').map(Number);
    const report = {
      id,
      type,
      matchType: type,
      status: 'finished',
      isFinished: true,
      bestOf: simulation.bestOf || 2,
      matchFormat: `BO${simulation.bestOf || 2}`,
      homeId: user.uid,
      awayId: `bot_${id}`,
      homeName,
      awayName: opponentName || 'Bot',
      homeLogo: state.clubLogo || null,
      awayLogo: null,
      scoreA, scoreB,
      homeScore: scoreA,
      awayScore: scoreB,
      seriesScore: `${scoreA}-${scoreB}`,
      score: `${scoreA}-${scoreB}`,
      winner: simulation.winner,
      winnerId: simulation.winnerSide === 'home' ? user.uid : simulation.winnerSide === 'away' ? `bot_${id}` : null,
      playedAt,
      resolvedAt: playedAt,
      homeStrength: simulation.homeStrength,
      awayStrength: simulation.awayStrength,
      homeOverall: simulation.homeOverall,
      awayOverall: simulation.awayOverall,
      simulation,
      games: simulation.games,
      opponentOverall: botOverall,
      reportStatus: 'new',
      seen: false,
      engineVersion: simulation.engineVersion,
      source: 'history',
      ...(extraData || {}),
    };

    const db = initializeFirebase().firestore;
    await setDoc(doc(db, 'matches_v2', id), { ...report, createdAt: serverTimestamp() }, { merge: true });
    saveToLocal({ matchHistory: [report, ...(state.matchHistory || []).filter((m: any) => m?.id !== id)] });
  }, [user?.uid, state, saveToLocal]);

  const runTrialMatch = useCallback(async (): Promise<string | null> => {
    if (!user?.uid) return null;
    try {
      const idToken = await user.getIdToken(true);
      const result = await createTrialMatchAction(idToken);
      if (!result.success) {
        console.warn('[TRIAL MATCH] Server action rejected:', result.error || 'TRIAL_MATCH_FAILED');
        return null;
      }
      if (!result.matchId || !result.report) return null;

      saveToLocal({
        matchHistory: [
          result.report,
          ...(state.matchHistory || []).filter((match: any) => match?.id !== result.matchId),
        ],
      });
      return result.matchId;
    } catch (error) {
      console.error('[TRIAL MATCH] Could not create trial match:', error);
      return null;
    }
  }, [user?.uid, user, state.matchHistory, saveToLocal]);

  // Keep world-sync callbacks referentially stable. AutoMatchManager has a
  // Firestore listener whose effect depends on setWorldReady; defining this
  // callback inline makes it change on every state update and causes the
  // listener to be torn down/recreated in a loop.
  const setWorldReady = useCallback((isReady: boolean) => {
    saveToLocal({ isDataReady: isReady });
  }, [saveToLocal]);

  const setLanguage = useCallback((lang: string) => {
    saveToLocal({ language: lang });
  }, [saveToLocal]);

  const value = useMemo(() => ({
    ...state, 
    recordMatch, runTrialMatch, markMatchIdAsSeen, claimReward, purchasePremium, updateLineup, setTrainingFocus, startDailyPlayerTraining, assignToRole,
    startArenaConstruction, startHQConstruction, startBootcampConstruction, startAcademyConstruction,
    startMedicalConstruction, accelerateConstruction, checkConstructions,
    addCrystals: () => console.warn("Client-side state write blocked by security policy."),
    addCredits: () => console.warn("Client-side state write blocked by security policy."),
    updatePlayer: () => console.warn("Client-side state write blocked by security policy."),
    setLanguage,
    setWorldReady,
    saveToLocal,
    resetProfile: async () => { if (typeof window !== 'undefined') localStorage.removeItem(STORAGE_KEY); window.location.reload(); }
  }), [state, claimReward, purchasePremium, updateLineup, setTrainingFocus, startDailyPlayerTraining, assignToRole,
    startArenaConstruction, startHQConstruction, startBootcampConstruction, startAcademyConstruction,
    startMedicalConstruction, accelerateConstruction, checkConstructions, setLanguage, setWorldReady, saveToLocal, recordMatch, runTrialMatch, markMatchIdAsSeen]);

  return <GameStateContext.Provider value={value}>{children}</GameStateContext.Provider>;
}

export function useGameState() {
  const context = useContext(GameStateContext);
  if (context === undefined) throw new Error('useGameState must be used within a GameStateProvider');
  return context;
}


