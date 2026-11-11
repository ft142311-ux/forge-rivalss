
'use client';

import React, { createContext, useContext, ReactNode, useMemo, useState, useEffect } from 'react';
import { FirebaseApp } from 'firebase/app';
import { Firestore } from 'firebase/firestore';
import { Auth, onAuthStateChanged, User, signOut } from 'firebase/auth';

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
    const unsubscribe = onAuthStateChanged(
      auth,
      async (user) => {
        const sequence = ++authChangeSequence;
        if (!user) {
          setUserAuthState({ user: null, isUserLoading: false, userError: null });
          return;
        }

        try {
          // Force Firebase to issue/refresh the ID token on each new auth session.
          // Do not mark the app as ready until the refresh has completed.
          await user.getIdToken(true);
          if (sequence !== authChangeSequence || auth.currentUser?.uid !== user.uid) return;
          setUserAuthState({ user, isUserLoading: false, userError: null });
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
