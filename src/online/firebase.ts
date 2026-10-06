import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously, type Auth, type User } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';

import { useEmulators } from './config';

const env = import.meta.env;

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

function init() {
  if (app) return;
  app = initializeApp(
    useEmulators
      ? { apiKey: 'demo-key', projectId: 'demo-4d-chess', authDomain: 'localhost' }
      : {
          apiKey: env.VITE_FIREBASE_API_KEY,
          authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
          projectId: env.VITE_FIREBASE_PROJECT_ID,
          appId: env.VITE_FIREBASE_APP_ID,
        },
  );
  auth = getAuth(app);
  db = getFirestore(app);
  if (useEmulators) {
    connectAuthEmulator(auth, `http://${location.hostname}:9299`, { disableWarnings: true });
    connectFirestoreEmulator(db, location.hostname, 8282);
  }
}

export function firestore(): Firestore {
  init();
  return db!;
}

/** Everyone plays as an anonymous user; the same browser keeps the same id, so you can rejoin. */
export async function currentUser(): Promise<User> {
  init();
  await auth!.authStateReady();
  if (auth!.currentUser) return auth!.currentUser;
  const cred = await signInAnonymously(auth!);
  return cred.user;
}
