'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Query,
  onSnapshot,
  DocumentData,
  FirestoreError,
  QuerySnapshot,
  CollectionReference,
} from 'firebase/firestore';

export type WithId<T> = T & { id: string };

export interface UseCollectionResult<T> {
  data: WithId<T>[] | null;
  isLoading: boolean;
  error: FirestoreError | Error | null;
  fromCache: boolean;
}

/**
 * Hook for subscribing to Firestore collections.
 * Optimized with refs to prevent assertion failures during rapid re-renders.
 */
export function useCollection<T = any>(
    memoizedTargetRefOrQuery: (CollectionReference<DocumentData> | Query<DocumentData>) | null | undefined,
): UseCollectionResult<T> {
  const [data, setData] = useState<WithId<T>[] | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [fromCache, setFromCache] = useState<boolean>(true);
  const [error, setError] = useState<FirestoreError | Error | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!memoizedTargetRefOrQuery) {
      setData(null);
      setIsLoading(false);
      setFromCache(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    let active = true;

    const timer = setTimeout(() => {
      if (!active) return;

      unsubscribeRef.current = onSnapshot(
        memoizedTargetRefOrQuery,
        { includeMetadataChanges: true },
        (snapshot: QuerySnapshot<DocumentData>) => {
          if (!active) return;
          
          const results: WithId<T>[] = [];
          snapshot.forEach((doc) => {
            results.push({ ...(doc.data() as T), id: doc.id });
          });
          
          const isFromCache = snapshot.metadata.fromCache;

          setData(results);
          setFromCache(isFromCache);
          setIsLoading(false);
        },
        (fError: FirestoreError) => {
          if (!active) return;
          console.warn("Firestore Collection Stream Error:", fError.code, fError.message);
          setError(fError);
          setIsLoading(false);
        }
      );
    }, 20);

    return () => {
      active = false;
      clearTimeout(timer);
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [memoizedTargetRefOrQuery]);

  return { data, isLoading, error, fromCache };
}
