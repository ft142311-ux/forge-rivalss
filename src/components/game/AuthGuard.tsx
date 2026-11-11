'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useEffect, ReactNode } from 'react';
import { LoadingScreen } from './LoadingScreen';
import { useGameState } from '@/app/lib/store';
import { useUser } from '@/firebase';

/**
 * Registration/auth gate v15.
 * Firestore is authoritative; localStorage is only a cache.
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const { isLoaded, isTeamLoaded, isInitialSyncDone } = useGameState();
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const pathname = usePathname();

  const isAuthPage = pathname?.startsWith('/auth');
  const isSetupPage = pathname === '/setup';

  useEffect(() => {
    if (!isLoaded || isUserLoading) return;

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
  }, [isLoaded, isUserLoading, user, isTeamLoaded, isInitialSyncDone, router, pathname, isAuthPage, isSetupPage]);

  if (!isLoaded || isUserLoading || (user && !isInitialSyncDone)) {
    return <LoadingScreen />;
  }

  if (!user && !isAuthPage) return <LoadingScreen />;
  if (user && !isTeamLoaded && !isSetupPage) return <LoadingScreen />;

  return <div className="animate-in fade-in duration-500 h-full">{children}</div>;
}
