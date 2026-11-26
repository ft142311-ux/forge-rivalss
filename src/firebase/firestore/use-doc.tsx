'use client';
    
import { useState, useEffect, useRef } from 'react';
import {
  DocumentReference,
  onSnapshot,
  DocumentData,
  FirestoreError,
  DocumentSnapshot,
} from 'firebase/firestore';

type WithId<T> = T & { id: string };

export interface UseDocResult<T> {
  data: WithId<T> | null;
  isLoading: boolean;
  error: FirestoreError | Error | null;
}

/**
 * Hook for subscribing to a single Firestore document.
 * Refactored to use refs for cleanup and avoid SDK assertion crashes (ca9).
 */
export function useDoc<T = any>(
  memoizedDocRef: DocumentReference<DocumentData> | null | undefined,
): UseDocResult<T> {
  const [data, setData] = useState<WithId<T> | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<FirestoreError | Error | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!memoizedDocRef) {
      setData(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    let active = true;

    const timer = setTimeout(() => {
      try {
        if (!active) return;

        unsubscribeRef.current = onSnapshot(
          memoizedDocRef,
          (snapshot: DocumentSnapshot<DocumentData>) => {
            if (!active) return;
            
            const docData = snapshot.exists() 
              ? { ...(snapshot.data() as T), id: snapshot.id }
              : null;

            // Decouple from snapshot processing loop
            setTimeout(() => {
              if (active) {
                setData(docData);
                setError(null); 
                setIsLoading(false);
              }
            }, 0);
          },
          (fError: FirestoreError) => {
            if (!active) return;
            console.warn("Firestore Doc Stream Error:", fError.code, fError.message);
            setError(fError);
            setData(null);
            setIsLoading(false);
          }
        );
      } catch (e: any) {
        if (active) {
          setError(e);
          setIsLoading(false);
        }
      }
    }, 20);

    return () => {
      active = false;
      clearTimeout(timer);
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [memoizedDocRef]);

  return { data, isLoading, error };
}
