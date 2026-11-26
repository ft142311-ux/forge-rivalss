'use client';
    
import {
  setDoc,
  doc,
  deleteDoc,
  CollectionReference,
  DocumentReference,
  SetOptions,
} from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import {FirestorePermissionError} from '@/firebase/errors';

/**
 * Sanitizes data by replacing undefined values with null to prevent Firestore crashes.
 * Added recursion protection via WeakSet.
 */
function sanitizeData(data: any, seen = new WeakSet()): any {
  if (data === null || typeof data !== 'object') return data;
  if (seen.has(data)) return null; 
  seen.add(data);

  const sanitized = Array.isArray(data) ? [] : {} as any;
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      const val = data[key];
      if (val === undefined) sanitized[key] = null;
      else if (typeof val === 'object') sanitized[key] = sanitizeData(val, seen);
      else sanitized[key] = val;
    }
  }
  return sanitized;
}

/**
 * Initiates a setDoc operation for a document reference.
 * Does NOT await the write operation internally.
 */
export function setDocumentNonBlocking(docRef: DocumentReference, data: any, options?: SetOptions) {
  const cleanData = sanitizeData(data);
  const op = options ? setDoc(docRef, cleanData, options) : setDoc(docRef, cleanData);
  op.catch(error => {
    errorEmitter.emit(
      'permission-error',
      new FirestorePermissionError({
        path: docRef.path,
        operation: 'write',
      })
    )
  })
}


/**
 * Initiates an add operation by generating a document ID and using setDoc.
 */
export function addDocumentNonBlocking(colRef: CollectionReference, data: any) {
  const newDocRef = doc(colRef);
  const cleanData = sanitizeData(data);
  const promise = setDoc(newDocRef, { ...cleanData, id: newDocRef.id })
    .catch(error => {
      errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: colRef.path,
          operation: 'create',
        })
      )
    });
  return promise;
}


/**
 * Initiates an update operation for a document reference.
 */
export function updateDocumentNonBlocking(docRef: DocumentReference, data: any) {
  const cleanData = sanitizeData(data);
  setDoc(docRef, cleanData, { merge: true })
    .catch(error => {
      errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: docRef.path,
          operation: 'update',
        })
      )
    });
}


/**
 * Initiates a deleteDoc operation for a document reference.
 */
export function deleteDocumentNonBlocking(docRef: DocumentReference) {
  deleteDoc(docRef)
    .catch(error => {
      errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: docRef.path,
          operation: 'delete',
        })
      )
    });
}
