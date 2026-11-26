'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useEffect, ReactNode } from 'react';
import { LoadingScreen } from './LoadingScreen';
import { useGameState } from '@/app/lib/store';
import { useUser } from '@/firebase';

/**
 * Registration/auth gate v17.
 * Firestore is authoritative; localStorage is only a cache.
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const { isLoaded, isTeamLoaded, isInitialSyncDone } = useGameState();
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const pathname = usePathname();

  const isAuthPage = pathname?.startsWith('/auth');
  const isSetupPage = pathname === '/setup';
  const isBetaSeasonOneResumePage = pathname === '/admin/beta-season-one-resume';
  const isMatchSettlementDiagnosticsPage = pathname === '/admin/match-settlement-diagnostics';

  useEffect(() => {
    if (isBetaSeasonOneResumePage || isMatchSettlementDiagnosticsPage || !isLoaded || isUserLoading) return;

    if (!user) {
      if (!isAuthPage) router.replace('/auth/login');
      return;
    }

    if (!isInitialSyncDone) return;

    if (!isTeamLoaded) {
      if (!isSetupPage) {
        console.log('[AUTH GUARD] No players_v14 profile; redirecting to /setup', { uid: user.uid });
        router.replace('/setup');
      }
      return;
    }

    if (isAuthPage || isSetupPage) {
      console.log('[AUTH GUARD] players_v14 loaded; redirecting to /', { uid: user.uid });
      router.replace('/');
    }
  }, [isLoaded, isUserLoading, user, isTeamLoaded, isInitialSyncDone, router, pathname, isAuthPage, isSetupPage, isBetaSeasonOneResumePage]);

  // Operational recovery is isolated from the account/profile gate.
  // Preview deployment and server-side project/branch/secret fences protect its API.
  if (isBetaSeasonOneResumePage || isMatchSettlementDiagnosticsPage) {
    return <div className="min-h-screen">{children}</div>;
  }

  if (!isLoaded || isUserLoading || (user && !isInitialSyncDone)) {
    return <LoadingScreen />;
  }

  if (!user && !isAuthPage) return <LoadingScreen />;

  // Auth routes must remain renderable while the router hands an authenticated
  // user without a club profile over to /setup. Showing the global preloader
  // here hides both the auth UI and any actionable setup/error state if a
  // navigation is delayed or interrupted.
  if (user && !isTeamLoaded && !isSetupPage && !isAuthPage) return <LoadingScreen />;

  return <div className="animate-in fade-in duration-500 h-full">{children}</div>;
}
