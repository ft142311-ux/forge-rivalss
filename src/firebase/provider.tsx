
'use client';

import React, { createContext, useContext, ReactNode, useMemo, useState, useEffect } from 'react';
import { FirebaseApp } from 'firebase/app';
import { Firestore } from 'firebase/firestore';
import { Auth, onIdTokenChanged, User, signOut } from 'firebase/auth';
import { recordUserActivityAction } from '@/app/actions/user-activity';
import { recordManagerPresenceAction } from '@/app/actions/manager-presence';

/**
 * ПРОВАЙДЕР FIREBASE v3.1 (Passive Mode).
 * Теперь не блокирует локальную работу приложения, если Firebase недоступен.
 */

interface UserAuthState {
  user: User | null;
  isUserLoading: boolean;
  userError: Error | null;
}

export interface FirebaseContextState {
  areServicesAvailable: boolean;
  firebaseApp: FirebaseApp | null;
  firestore: Firestore | null;
  auth: Auth | null;
  user: User | null;
  isUserLoading: boolean;
  userError: Error | null;
}

export const FirebaseContext = createContext<FirebaseContextState | undefined>(undefined);

export const FirebaseProvider: React.FC<{ children: ReactNode; firebaseApp: FirebaseApp; firestore: Firestore; auth: Auth }> = ({
  children,
  firebaseApp,
  firestore,
  auth,
}) => {
  const [userAuthState, setUserAuthState] = useState<UserAuthState>({
    user: auth?.currentUser || null,
    isUserLoading: !!auth,
    userError: null,
  });

  useEffect(() => {
    if (!auth) {
      setUserAuthState({ user: null, isUserLoading: false, userError: null });
      return;
    }

    let authChangeSequence = 0;
    const unsubscribe = onIdTokenChanged(
      auth,
      async (user) => {
        const sequence = ++authChangeSequence;
        if (!user) {
          setUserAuthState({ user: null, isUserLoading: false, userError: null });
          return;
        }

        try {
          // onIdTokenChanged fires on initial sign-in and on scheduled token
          // refreshes. Read the current token without forcing another refresh:
          // forcing here would recursively trigger this listener.
          // Each verified token event also refreshes the server-side activity
          // heartbeat, so a long-lived active tab is not mistaken for inactivity.
          const idToken = await user.getIdToken();
          if (sequence !== authChangeSequence || auth.currentUser?.uid !== user.uid) return;

          // Publish the verified Firebase session immediately. Activity
          // recording is auxiliary and must never hold the login/register UI
          // behind a Firestore/server-action round trip.
          setUserAuthState({ user, isUserLoading: false, userError: null });

          // Keep the server-side account lifecycle check, but run it after
          // the client session is available. Terminal account states still
          // revoke the session; transient failures do not block navigation.
          void (async () => {
            try {
              const activity = await recordUserActivityAction(idToken);
              if (sequence !== authChangeSequence || auth.currentUser?.uid !== user.uid) return;
              const terminalActivityError = [
                'ACCOUNT_DISABLED',
                'ACCOUNT_RETIRING',
                'ACCOUNT_RETIRED',
                'AUTH_TOKEN_REVOKED',
                'AUTH_TOKEN_INVALID',
              ].includes(String(activity?.error || ''));
              if (terminalActivityError) {
                try { await signOut(auth); } catch { /* Auth listener settles state. */ }
                return;
              }
              if (!activity?.success) {
                console.warn('[AUTH ACTIVITY] Session activity was not acknowledged:', activity?.error || 'UNKNOWN');
              }
            } catch (activityError) {
              console.warn('[AUTH ACTIVITY] Background session activity failed:', activityError);
            }
          })();
        } catch (error: any) {
          if (sequence !== authChangeSequence) return;
          const code = String(error?.code || '').toLowerCase();
          const terminalAuthError = [
            'auth/user-token-expired', 'auth/invalid-user-token', 'auth/user-disabled',
            'auth/user-not-found', 'auth/invalid-credential'
          ].includes(code);
          if (terminalAuthError) {
            try { await signOut(auth); } catch { /* Auth state listener will settle below. */ }
            return;
          }
          // A transient network failure should not destroy a valid login.
          setUserAuthState({ user, isUserLoading: false, userError: error instanceof Error ? error : new Error(String(error)) });
        }
      },
      (error) => {
        setUserAuthState((prev) => ({
          ...prev,
          isUserLoading: false,
          userError: error,
        }));
      }
    );

    return () => unsubscribe();
  }, [auth]);

  // Presence is independent from Auth's slower ID-token refresh cadence.
  // A visible tab refreshes its server-verified heartbeat every 45 seconds;
  // hidden tabs stop heartbeating and naturally become offline after 2 minutes.
  useEffect(() => {
    const activeUser = userAuthState.user;
    if (!auth || !activeUser) return;

    let active = true;
    let inFlight = false;

    const heartbeat = async () => {
      if (!active || inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      try {
        const idToken = await activeUser.getIdToken();
        if (!active) return;
        const result = await recordManagerPresenceAction(idToken);
        if (!result?.success) {
          const terminalErrors = [
            'ACCOUNT_DISABLED',
            'ACCOUNT_RETIRING',
            'ACCOUNT_RETIRED',
            'AUTH_TOKEN_REVOKED',
            'AUTH_TOKEN_INVALID',
          ];
          if (terminalErrors.includes(String(result?.error || ''))) {
            try { await signOut(auth); } catch { /* Auth listener settles state. */ }
            return;
          }
          console.warn('[PRESENCE] Heartbeat was not acknowledged:', result?.error || 'UNKNOWN');
        }
      } catch (error) {
        console.warn('[PRESENCE] Heartbeat failed:', error);
      } finally {
        inFlight = false;
      }
    };

    void heartbeat();
    const interval = window.setInterval(() => { void heartbeat(); }, 45_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void heartbeat();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [auth, userAuthState.user]);

  const contextValue = useMemo((): FirebaseContextState => ({
    areServicesAvailable: !!firebaseApp && !!firestore && !!auth,
    firebaseApp,
    firestore,
    auth,
    user: userAuthState.user,
    isUserLoading: userAuthState.isUserLoading,
    userError: userAuthState.userError,
  }), [firebaseApp, firestore, auth, userAuthState]);

  return (
    <FirebaseContext.Provider value={contextValue}>
      {children}
    </FirebaseContext.Provider>
  );
};

export const useFirebase = () => {
  const context = useContext(FirebaseContext);
  if (context === undefined) {
    // В локальном режиме возвращаем пустые сервисы без ошибки
    return { areServicesAvailable: false, firebaseApp: null, firestore: null, auth: null, user: null, isUserLoading: false, userError: null };
  }
  return context;
};

export const useAuth = () => useFirebase().auth;
export const useFirestore = () => useFirebase().firestore;
export const useFirebaseApp = () => useFirebase().firebaseApp;
export const useUser = () => {
  const { user, isUserLoading, userError } = useFirebase();
  return { user, isUserLoading, userError };
};

export const useMemoFirebase = <T,>(factory: () => T, deps: React.DependencyList): T => {
  return useMemo(factory, deps);
};
