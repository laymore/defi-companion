import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { initializeFirestore, doc, getDocFromServer, enableNetwork, disableNetwork } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Singleton pattern for Firebase initialization
export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // In some cases, force enable network
  if (errInfo.error.includes('offline')) {
    enableNetwork(db).catch(() => {});
  }
  throw new Error(JSON.stringify(errInfo));
}

// Use initializeFirestore with settings optimized for stability in sandboxed environments
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, firebaseConfig.firestoreDatabaseId || '(default)');

export const googleProvider = new GoogleAuthProvider();

export async function loginWithGoogle() {
  try {
    // Ensure network is enabled before trying to sign in
    await enableNetwork(db);
    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    console.error("Error signing in with Google", error);
  }
}

export async function logout() {
  await signOut(auth);
}

// More robust connectivity check with retry
export async function ensureConnected() {
  try {
    await enableNetwork(db);
    // Simple light request
    await getDocFromServer(doc(db, '_health_', 'ping'));
    return true;
  } catch (e: any) {
    if (e.message?.includes('permission')) return true; // Permission error means we ARE connected
    console.warn("Firestore connectivity warning:", e.message);
    return false;
  }
}

// Startup check
ensureConnected().then(connected => {
  if (connected) {
    console.log("Firestore initialized and connected.");
  } else {
    console.warn("Firestore started in OFFLINE mode. Will retry on next data request.");
  }
});
