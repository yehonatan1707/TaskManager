/**
 * firebase.js — Firebase SDK initializer with localStorage fallback + AI app accessor
 */

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyBaJ2VOB4Ne-4ZVLPQDvvfLvMkwWuPqATU",
  authDomain:        "personal-command-center-pwa.firebaseapp.com",
  projectId:         "personal-command-center-pwa",
  storageBucket:     "personal-command-center-pwa.firebasestorage.app",
  messagingSenderId: "751970285468",
  appId:             "1:751970285468:web:2a87d57a34ca34029d3a59"
};

const USE_FIREBASE = !!(FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey.length > 0);

export const FB_VER = '11.10.0';
export { FIREBASE_CONFIG };

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


let _app = null;
let _db = null;
let _auth = null;
let _fbModules = null;
let _initPromise = null;

async function initFirebase() {
  if (_fbModules) return;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const { initializeApp, getApps } = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-app.js`);
    const { getFirestore, collection, doc, getDocs, addDoc, updateDoc, deleteDoc, query, orderBy } =
      await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-firestore.js`);
    const { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult } =
      await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-auth.js`);

    const app = getApps().length === 0 ? initializeApp(FIREBASE_CONFIG) : getApps()[0];
    _app  = app;
    _db   = getFirestore(app);
    _auth = getAuth(app);

    _fbModules = {
      collection, doc, getDocs, addDoc, updateDoc, deleteDoc, query, orderBy,
      onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
      signOut, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult
    };
  })();

  return _initPromise;
}

export async function getFirebaseApp() {
  await initFirebase();
  return _app;
}

class FirestoreCollection {
  constructor(uid, colName) {
    this.uid = uid;
    this.colName = colName;
  }
  _colRef() {
    const { collection } = _fbModules;
    return collection(_db, 'users', this.uid, this.colName);
  }
  async getAll() {
    const { getDocs } = _fbModules;
    const snap = await getDocs(this._colRef());
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  async add(data) {
    const { addDoc } = _fbModules;
    const payload = { ...data, _createdAt: Date.now() };
    const ref = await addDoc(this._colRef(), payload);
    return { id: ref.id, ...payload };
  }
  async update(id, data) {
    const { doc, updateDoc } = _fbModules;
    const ref = doc(_db, 'users', this.uid, this.colName, id);
    await updateDoc(ref, { ...data, _updatedAt: Date.now() });
  }
  async remove(id) {
    const { doc, deleteDoc } = _fbModules;
    const ref = doc(_db, 'users', this.uid, this.colName, id);
    await deleteDoc(ref);
  }
}


export let currentUser = null;
export let isMockMode   = !USE_FIREBASE;

export async function initAuth(onUserChanged) {
  if (!USE_FIREBASE) {
    const saved = localStorage.getItem('pcc_mock_user');
    currentUser = saved ? JSON.parse(saved) : null;
    onUserChanged(currentUser);
    return;
  }

  await initFirebase();
  const { onAuthStateChanged } = _fbModules;
  onAuthStateChanged(_auth, (user) => {
    currentUser = user;
    isMockMode  = false;
    onUserChanged(user);
  });
}

export async function checkRedirectResult() {
  if (!USE_FIREBASE) return null;
  await initFirebase();
  const { getRedirectResult } = _fbModules;
  try {
    const result = await getRedirectResult(_auth);
    if (result?.user) {
      currentUser = result.user;
      isMockMode = false;
      return result.user;
    }
  } catch (e) {
    console.warn('Redirect sign-in error:', e);
  }
  return null;
}

export function getCollection(name) {
  if (!currentUser) throw new Error('Must be signed in to access collections');
  if (isMockMode) {
    return new MockCollection(currentUser.uid, name);
  }
  return new FirestoreCollection(currentUser.uid, name);
}

export const settingsStore = {
  async get() {
    if (isMockMode) {
      return JSON.parse(localStorage.getItem(`pcc_settings_${currentUser.uid}`) || '{}');
    }
    const { doc, getDocs, collection } = _fbModules;
    const snap = await getDocs(collection(_db, 'users', currentUser.uid, 'settings'));
    const docData = snap.docs[0]?.data() || {};
    return docData;
  },
  async set(data) {
    if (isMockMode) {
      const existing = await this.get();
      localStorage.setItem(`pcc_settings_${currentUser.uid}`, JSON.stringify({ ...existing, ...data }));
      return;
    }
    const { collection, addDoc, updateDoc, getDocs } = _fbModules;
    const colRef = collection(_db, 'users', currentUser.uid, 'settings');
    const snap = await getDocs(colRef);
    if (snap.empty) {
      await addDoc(colRef, data);
    } else {
      await updateDoc(snap.docs[0].ref, data);
    }
  }
};


export async function signIn(email, password) {
  if (!USE_FIREBASE || !_fbModules) {
    currentUser = { uid: `local_${email}`, email, displayName: email.split('@')[0] };
    isMockMode = true;
    localStorage.setItem('pcc_mock_user', JSON.stringify(currentUser));
    return currentUser;
  }
  const { signInWithEmailAndPassword } = _fbModules;
  const cred = await signInWithEmailAndPassword(_auth, email, password);
  return cred.user;
}

export async function register(email, password) {
  if (!USE_FIREBASE || !_fbModules) {
    currentUser = { uid: `local_${email}`, email, displayName: email.split('@')[0] };
    isMockMode = true;
    localStorage.setItem('pcc_mock_user', JSON.stringify(currentUser));
    return currentUser;
  }
  const { createUserWithEmailAndPassword } = _fbModules;
  const cred = await createUserWithEmailAndPassword(_auth, email, password);
  return cred.user;
}

function isMobileOrPWA() {
  const ua = navigator.userAgent || '';
  const mobile = /iPhone|iPad|iPod|Android/i.test(ua);
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
    || window.navigator.standalone === true;
  return mobile || standalone;
}

export async function signInGoogle() {
  if (!USE_FIREBASE) {
    currentUser = { uid: 'demo_user', email: 'demo@commandcenter.app', displayName: 'Demo User' };
    isMockMode = true;
    localStorage.setItem('pcc_mock_user', JSON.stringify(currentUser));
    return currentUser;
  }

  await initFirebase();
  const { GoogleAuthProvider, signInWithRedirect, signInWithPopup } = _fbModules;
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  if (isMobileOrPWA()) {
    await signInWithRedirect(_auth, provider);
    return null;
  }

  try {
    const cred = await signInWithPopup(_auth, provider);
    currentUser = {
      uid: cred.user.uid,
      email: cred.user.email,
      displayName: cred.user.displayName || cred.user.email
    };
    return currentUser;
  } catch (popupErr) {
    console.warn('Popup failed, falling back to redirect:', popupErr);
    await signInWithRedirect(_auth, provider);
    return null;
  }
}

export function signInDemo() {
  currentUser = { uid: 'demo_user_local', email: 'demo@local', displayName: 'Demo User' };
  isMockMode  = true;
  localStorage.setItem('pcc_mock_user', JSON.stringify(currentUser));
  return currentUser;
}

export async function logOut() {
  if (USE_FIREBASE && _auth && _fbModules) {
    const { signOut } = _fbModules;
    await signOut(_auth);
  }
  localStorage.removeItem('pcc_mock_user');
  currentUser = null;
  isMockMode = !USE_FIREBASE;
}
