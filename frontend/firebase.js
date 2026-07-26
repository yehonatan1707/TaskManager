/**
 * firebase.js — Firebase SDK initializer with localStorage fallback
 * Dual-mode: If Firebase config is populated → real Firestore
 *            If config is empty/missing  → full localStorage mock
 */

// ─── PASTE YOUR FIREBASE CONFIG HERE ──────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "",
  authDomain:        "",
  projectId:         "",
  storageBucket:     "",
  messagingSenderId: "",
  appId:             ""
};
// ──────────────────────────────────────────────────────────────────────────────

const USE_FIREBASE = FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey.length > 0;

// ─── localStorage Mock DB ────────────────────────────────────────────────────
const LS_KEY = 'pcc_data';

function lsGet() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
  catch { return {}; }
}
function lsSave(data) {
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

/** @typedef {{ id: string, [key: string]: any }} DocLike */

class MockCollection {
  constructor(uid, col) {
    this.uid = uid;
    this.col = col;
  }
  _path() { return `${this.uid}/${this.col}`; }

  /** @returns {DocLike[]} */
  _all() {
    const root = lsGet();
    return root[this._path()] || [];
  }
  _write(arr) {
    const root = lsGet();
    root[this._path()] = arr;
    lsSave(root);
  }

  async getAll() { return this._all(); }

  async add(data) {
    const arr = this._all();
    const doc = { id: crypto.randomUUID(), ...data, _createdAt: Date.now() };
    arr.push(doc);
    this._write(arr);
    return doc;
  }

  async update(id, data) {
    const arr = this._all().map(d => d.id === id ? { ...d, ...data, _updatedAt: Date.now() } : d);
    this._write(arr);
  }

  async remove(id) {
    this._write(this._all().filter(d => d.id !== id));
  }

  async getDoc(id) {
    return this._all().find(d => d.id === id) || null;
  }
}

// ─── Real Firestore Helpers ──────────────────────────────────────────────────
let _db = null;
let _auth = null;
let _fbModules = null;

async function initFirebase() {
  const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
  const { getAuth, onAuthStateChanged, signInWithEmailAndPassword,
          createUserWithEmailAndPassword, GoogleAuthProvider,
          signInWithPopup, signOut } =
    await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
  const { getFirestore, collection, getDocs, addDoc, updateDoc,
          deleteDoc, doc, serverTimestamp, query, orderBy } =
    await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

  const app = initializeApp(FIREBASE_CONFIG);
  _db   = getFirestore(app);
  _auth = getAuth(app);

  _fbModules = {
    onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
    GoogleAuthProvider, signInWithPopup, signOut,
    collection, getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, query, orderBy
  };

  return { auth: _auth, db: _db };
}

class FirestoreCollection {
  constructor(uid, col) {
    this.uid = uid;
    this.col = col;
    const { collection, getDocs, addDoc, updateDoc,
            deleteDoc, doc, serverTimestamp, query, orderBy } = _fbModules;
    this._col  = collection(_db, `users/${uid}/${col}`);
    this._fns  = { getDocs, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, query, orderBy };
  }

  async getAll() {
    const { getDocs, query, orderBy } = this._fns;
    const q = query(this._col, orderBy('_createdAt', 'asc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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

  async getDoc(id) {
    return null; // not needed for this app
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export let currentUser = null; // { uid, email, displayName }

/**
 * Returns a collection helper bound to the current user.
 * @param {'workouts'|'books'|'tasks'|'logs'|'settings'} name
 */
export function getCollection(name) {
  if (!currentUser) throw new Error('Not authenticated');
  return USE_FIREBASE
    ? new FirestoreCollection(currentUser.uid, name)
    : new MockCollection(currentUser.uid, name);
}

/**
 * Reads/writes a single "document" in the settings collection (stored as id='singleton').
 */
export const settingsStore = {
  async get() {
    const col = getCollection('settings');
    const all = await col.getAll();
    return all[0] || {};
  },
  async set(data) {
    const col = getCollection('settings');
    const all = await col.getAll();
    if (all[0]) await col.update(all[0].id, data);
    else         await col.add(data);
  }
};

/**
 * Initialise auth listener. Returns a promise resolving when auth state is known.
 * callback(user) is called on every auth change.
 */
export async function initAuth(callback) {
  if (!USE_FIREBASE) {
    // Mock: restore from localStorage
    const saved = localStorage.getItem('pcc_mock_user');
    currentUser = saved ? JSON.parse(saved) : null;
    callback(currentUser);
    return;
  }

  await initFirebase();
  const { onAuthStateChanged } = _fbModules;
  return new Promise((resolve) => {
    onAuthStateChanged(_auth, (fbUser) => {
      currentUser = fbUser
        ? { uid: fbUser.uid, email: fbUser.email, displayName: fbUser.displayName }
        : null;
      callback(currentUser);
      resolve(currentUser);
    });
  });
}

/** Sign in with email/password */
export async function signIn(email, password) {
  if (!USE_FIREBASE) {
    currentUser = { uid: `mock_${email}`, email, displayName: email.split('@')[0] };
    localStorage.setItem('pcc_mock_user', JSON.stringify(currentUser));
    return currentUser;
  }
  const { signInWithEmailAndPassword } = _fbModules;
  const cred = await signInWithEmailAndPassword(_auth, email, password);
  return cred.user;
}

/** Register with email/password */
export async function register(email, password) {
  if (!USE_FIREBASE) {
    currentUser = { uid: `mock_${email}`, email, displayName: email.split('@')[0] };
    localStorage.setItem('pcc_mock_user', JSON.stringify(currentUser));
    return currentUser;
  }
  const { createUserWithEmailAndPassword } = _fbModules;
  const cred = await createUserWithEmailAndPassword(_auth, email, password);
  return cred.user;
}

/** Sign in with Google (popup) */
export async function signInGoogle() {
  if (!USE_FIREBASE) {
    currentUser = { uid: 'mock_google_user', email: 'user@gmail.com', displayName: 'Demo User' };
    localStorage.setItem('pcc_mock_user', JSON.stringify(currentUser));
    return currentUser;
  }
  const { GoogleAuthProvider, signInWithPopup } = _fbModules;
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(_auth, provider);
  return cred.user;
}

/** Sign out */
export async function logOut() {
  if (!USE_FIREBASE) {
    currentUser = null;
    localStorage.removeItem('pcc_mock_user');
    return;
  }
  const { signOut } = _fbModules;
  await signOut(_auth);
  currentUser = null;
}

export const isMockMode = !USE_FIREBASE;
