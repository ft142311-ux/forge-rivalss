'use client';

import { useEffect, useRef } from 'react';
import { useGameState } from '@/app/lib/store';
import { getGlobalSeasonInfo } from '@/app/lib/time-utils';
import { useAuth, useFirestore, useUser } from '@/firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { resolveDueTrialMatchesForUserAction } from '@/app/actions/trial-match-resolver';

/**
 * Серверный/клиентский мост матчей.
 *
 * Firestore остаётся источником истины: готовое расписание только читается
 * realtime. Этот компонент больше НЕ создаёт и НЕ восстанавливает календарь.
 * Генерация мира выполняется заранее серверным оркестратором.
 */
export function AutoMatchManager() {
  const {
    isLoaded, selectedLeagueId,
    leagueLevel, groupId, activeSeasonNumber, setWorldReady,
    saveToLocal
  } = useGameState();

  const { user } = useUser();
  const auth = useAuth();
  const userId = user?.uid ?? null;
  const db = useFirestore();
  const syncStartedRef = useRef<string | null>(null);


  const resolveDueTrialMatches = async () => {
    if (!user) return;
    // The browser may request resolution only for its authenticated account.
    // Simulation, locking and final Firestore writes are server-authoritative.
    const token = await user.getIdToken(true);
    const result = await resolveDueTrialMatchesForUserAction(token);
    if (result?.error === 'AUTH_SESSION_EXPIRED' && auth) {
      await signOut(auth);
    }
  };

  useEffect(() => {
    if (!isLoaded) return;

    if (!userId) {
      setWorldReady(true);
      return;
    }

    if (!selectedLeagueId) {
      console.warn('[MATCH REALTIME] No selectedLeagueId; releasing world preloader.', { uid: userId });
      setWorldReady(true);
      return;
    }

    if (!db) {
      console.warn('[MATCH REALTIME] Firestore is not initialized yet.');
      setWorldReady(false);
      return;
    }

    const currentSeason = Number(activeSeasonNumber || getGlobalSeasonInfo().activeSeasonNumber || 1);
    const currentContext = `${selectedLeagueId}_L${leagueLevel}_G${groupId}_S${currentSeason}_v140`;
    syncStartedRef.current = currentContext;

    const q = query(
      collection(db, 'matches_v2'),
      where('leagueId', '==', selectedLeagueId),
      where('level', '==', Number(leagueLevel)),
      where('groupId', '==', Number(groupId)),
      where('season', '==', currentSeason),
      where('version', '==', 140)
    );

    const unsubscribe = onSnapshot(q, snap => {
      const officialMatches = snap.docs.map(d => ({ ...d.data(), id: d.id }));
      console.log('[MATCH REALTIME] Schedule synced', {
        season: currentSeason,
        leagueId: selectedLeagueId,
        level: Number(leagueLevel),
        group: Number(groupId),
        matches: officialMatches.length
      });
      const scheduleReady = officialMatches.length === 56;
      if (!scheduleReady) {
        console.error('[MATCH REALTIME] Prebuilt schedule is incomplete; no repair is performed.', {
          expected: 56,
          actual: officialMatches.length,
          season: currentSeason,
          leagueId: selectedLeagueId,
          level: Number(leagueLevel),
          group: Number(groupId)
        });
      }

      saveToLocal({
        allSeasonMatches: officialMatches.sort((a: any, b: any) => Number(a.tour || 0) - Number(b.tour || 0)),
        seasonNumber: currentSeason,
        activeSeasonNumber: currentSeason,
        isMatchesLoading: !scheduleReady
      });
      setWorldReady(scheduleReady);

      // Official league matches are resolved by the authenticated server cron.
      // A browser must never trigger the global resolver: it is a world-wide
      // state mutation, not a per-user synchronization operation.
      void resolveDueTrialMatches().catch(error => console.error('[TRIAL MATCH] Initial resolver failed:', error));
    }, error => {
      console.error('[MATCH REALTIME] Sync failed:', error);
      setWorldReady(false);
    });
    // Official league match resolution runs on the server cron. This component
    // only synchronizes the schedule and handles the existing trial-match flow.
    const trialTick = window.setInterval(() => {
      void resolveDueTrialMatches().catch(error => console.error('[TRIAL MATCH] Resolver failed:', error));
    }, 5_000);

    return () => {
      unsubscribe();
      window.clearInterval(trialTick);
    };
  }, [isLoaded, selectedLeagueId, leagueLevel, groupId, activeSeasonNumber, userId, saveToLocal, setWorldReady, db, auth]);

  return null;
}
