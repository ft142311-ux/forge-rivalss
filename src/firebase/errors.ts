'use client';

/**
 * A safe, passive error class for Firestore operations.
 * This class MUST NOT call any Firebase SDK functions in its constructor
 * (like getAuth()) to prevent "INTERNAL ASSERTION FAILED" errors 
 * when the SDK's internal state is locked during stream updates.
 */
export class FirestorePermissionError extends Error {
  public readonly context: any;

  constructor(context: { path: string; operation: string; data?: any }) {
    const message = `Access Denied: ${context.operation} failed on [${context.path}]. Check security rules.`;
    super(message);
    this.name = 'FirestorePermissionError';
    this.context = context;
  }
}
