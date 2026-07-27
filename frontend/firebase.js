/**
 * firebase.js — Firebase SDK initializer with localStorage fallback
 * Dual-mode: If Firebase config is populated → real Firestore
 *            If config is empty/missing  → full localStorage mock
 */

// ─── PASTE YOUR FIREBASE CONFIG HERE ──────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBaJ2VOB4Ne-4ZVLPQDvvfLvMkwWuPqATU",
  authDomain:        "personal-command-center-pwa.firebaseapp.com",
  projectId:         "personal-command-center-pwa",
  storageBucket:     "personal-command-center-pwa.firebasestorage.app",
  messagingSenderId: "751970285468",
  appId:             "1:751970285468:web:2a87d57a34ca34029d3a59"
};
// ──────────────────────────────────────────────────────────────────────────────

const USE_FIREBASE = !!(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey.length > 0);

// ─── localStorage Mock DB ────────────────────────────────────────────────────
const LS_KEY = 'pcc_data';

function lsGet() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
  catch { return {}; }
}
function lsSave(data) {
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

class MockCollection {
  constructor(uid, col) { this.uid = uid; this.col = col; }
  _path() { return `${this.uid}/${this.col}`; }
  _all() { return lsGet()[this._path()] || []; }
  _write(arr) { const root = lsGet(); root[this._path()] = arr; lsSave(root); }

  async getAll() { return this._all(); }
  async add(data) {
    const arr = this._all();
    const doc = { id: crypto.randomUUID(), ...data, _createdAt: Date.now() };
    arr.push(doc); this._write(arr); return doc;
  }
  async update(id, data) {
    this._write(this._all().map(d => d.id === id ? { ...d, ...data, _updatedAt: Date.now() } : d));
  }
  async remove(id) { this._write(this._all().filter(d => d.id !== id)); }
}

// ─── Real Firestore Helpers ──────────────────────────────────────────────────
let _db = null;
let _auth = null;
let _fbModules = null;
let _initPromise = null;

async function initFirebase() {
  if (_fbModules) return; // already initialized
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
    const {
      getAuth, onAuthStateChanged,
      signInWithEmailAndPassword, createUserWithEmailAndPassword,
      GoogleAuthProvider, signInWithRedirect, getRedirectResult, signOut
    } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
    const {
      getFirestore, collection, getDocs, addDoc, updateDoc,
      deleteDoc, doc, serverTimestamp, query, orderBy
    } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

    const firebaseApp = getApps().length === 0
      ? initializeApp(FIREBASE_CONFIG)
      : getApps()[0];

    _db   = getFirestore(firebaseApp);
    _auth = getAuth(firebaseApp);

    _fbModules = {
      onAuthStateChanged,
      signInWithEmailAndPassword, createUserWithEmailAndPassword,
      GoogleAuthProvider, signInWithRedirect, getRedirectResult, signOut,
      collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, query, orderBy
    };
  })();

  return _initPromise;
}

class FirestoreCollection {
  constructor(uid, col) {
    this.uid = uid;
    this.col = col;
    const { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, query, orderBy } = _fbModules;
    this._col  = collection(_db, `users/${uid}/${col}`);
    this._fns  = { getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, query, orderBy };
  }

  async getAll() {
    const { getDocs, query, orderBy } = this._fns;
    try {
      const q = query(this._col, orderBy('_createdAt', 'asc'));
      const snap = await getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch { return []; }
  }

  async add(data) {
    const { addDoc, serverTimestamp } = this._fns;
    const ref = await addDoc(this._col, { ...data, _createdAt: serverTimestamp() });
    return { id: ref.id, ...data };
  }

  async update(id, data) {
    const { updateDoc, doc } = this._fns;
    await updateDoc(doc(this._col, id), { ...data, _updatedAt: serverTimestamp() });
  }

  async remove(id) {
    const { deleteDoc, doc } = this._fns;
    await deleteDoc(doc(this._col, id));
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export let currentUser = null;

export function getCollection(name) {
  if (!currentUser) throw new Error('Not authenticated');
  // Use Firestore only if Firebase is configured AND initialized
  return (USE_FIREBASE && _fbModules)
    ? new FirestoreCollection(currentUser.uid, name)
    : new MockCollection(currentUser.uid, name);
}

export const settingsStore = {
  async get() {
    try {
      const col = getCollection('settings');
      const all = await col.getAll();
      return all[0] || {};
    } catch { return {}; }
  },
  async set(data) {
    try {
      const col = getCollection('settings');
      const all = await col.getAll();
      if (all[0]) await col.update(all[0].id, data);
      else await col.add(data);
    } catch (e) { console.warn('Settings save failed:', e); }
  }
};

/**
 * Check if a redirect sign-in result is pending (called on every page load).
 * Returns the user object if a redirect completed, or null.
 */
export async function checkRedirectResult() {
  if (!USE_FIREBASE) return null;
  try {
    await initFirebase();
    const { getRedirectResult } = _fbModules;
    const result = await getRedirectResult(_auth);
    if (result?.user) {
      currentUser = {
        uid: result.user.uid,
        email: result.user.email,
        displayName: result.user.displayName
      };
      return currentUser;
    }
  } catch (e) {
    console.warn('Redirect result error:', e);
  }
  return null;
}

/**
 * Initialise Firebase auth listener.
 * callback(user) fires immediately with current state, then on every change.
 */
export async function initAuth(callback) {
  if (!USE_FIREBASE) {
    const saved = localStorage.getItem('pcc_mock_user');
    currentUser = saved ? JSON.parse(saved) : null;
    callback(currentUser);
    return;
  }

  try {
    await initFirebase();
  } catch (e) {
    console.error('Firebase init failed, falling back to mock mode:', e);
    const saved = localStorage.getItem('pcc_mock_user');
    currentUser = saved ? JSON.parse(saved) : null;
    callback(currentUser);
    return;
  }

  const { onAuthStateChanged } = _fbModules;
  return new Promise((resolve) => {
    onAuthStateChanged(_auth, (fbUser) => {
      currentUser = fbUser
        ? { uid: fbUser.uid, email: fbUser.email, displayName: fbUser.displayName || fbUser.email }
        : null;
      callback(currentUser);
      resolve(currentUser);
    });
  });
}

/** Sign in with email/password */
export async function signIn(email, password) {
  if (!USE_FIREBASE || !_fbModules) {
    currentUser = { uid: `local_${email}`, email, displayName: email.split('@')[0] };
    localStorage.setItem('pcc_mock_user', JSON.stringify(currentUser));
    return currentUser;
  }
  const { signInWithEmailAndPassword } = _fbModules;
  const cred = await signInWithEmailAndPassword(_auth, email, password);
  return cred.user;
}

/** Register a new account with email/password */
export async function register(email, password) {
  if (!USE_FIREBASE || !_fbModules) {
    currentUser = { uid: `local_${email}`, email, displayName: email.split('@')[0] };
    localStorage.setItem('pcc_mock_user', JSON.stringify(currentUser));
    return currentUser;
  }
  const { createUserWithEmailAndPassword } = _fbModules;
  const cred = await createUserWithEmailAndPassword(_auth, email, password);
  return cred.user;
}

/**
 * Sign in with Google — uses REDIRECT (works on all browsers + mobile).
 * After the redirect, checkRedirectResult() will pick up the user.
 */
export async function signInGoogle() {
  if (!USE_FIREBASE || !_fbModules) {
    // Mock mode: instant login
    currentUser = { uid: 'demo_user', email: 'demo@commandcenter.app', displayName: 'Demo User' };
    localStorage.setItem('pcc_mock_user', JSON.stringify(currentUser));
    return currentUser;
  }
  const { GoogleAuthProvider, signInWithRedirect } = _fbModules;
  const provider = new GoogleAuthProvider();
  await signInWithRedirect(_auth, provider);
  // Page will redirect to Google, then come back — result handled by checkRedirectResult()
}

/** Demo / Guest login — no account needed, data stored locally */
export function signInDemo() {
  currentUser = {
    uid: 'demo_user_local',
    email: 'demo@local',
    displayName: '👤 Demo User'
  };
  localStorage.setItem('pcc_mock_user', JSON.stringify(currentUser));
  return currentUser;
}

/** Sign out */
export async function logOut() {
  localStorage.removeItem('pcc_mock_user');
  if (USE_FIREBASE && _fbModules && _auth) {
    try {
      const { signOut } = _fbModules;
      await signOut(_auth);
    } catch (e) { console.warn('Sign out error:', e); }
  }
  currentUser = null;
}

export const isMockMode = !USE_FIREBASE;
