/**
 * app.js — Personal Command Center
 * Main application: state management, screen rendering, CRUD operations, AI Agents
 */
import { initAuth, checkRedirectResult, getCollection, settingsStore, signIn, register, signInGoogle, signInDemo, logOut, currentUser, isMockMode } from './firebase.js';
import { createWorkoutInterview, createOnboardingAgent, lookupBook } from './ai.js';

const state = {
  currentScreen: 'home',
  user: null,
  loading: false,
  hasCustomPlan: false,

  selectedDay: new Date().getDay(),
  workoutData: {},
  exercises: [],

  books: [],
  activeBook: null,

  tasks: [],
  taskFilter: 'daily',
  showCompleted: false,

  logs: [],
  streak: 0,
};

const WEEK_SCHEDULE = [
  { he: 'ראשון', day: 'Sun', type: 'chest',  icon: '💪', label: 'חזה' },
  { he: 'שני',   day: 'Mon', type: 'back',   icon: '🔙', label: 'גב' },
  { he: 'שלישי', day: 'Tue', type: 'swim1',  icon: '🏊', label: 'שחייה 1' },
  { he: 'רביעי', day: 'Wed', type: 'legs',   icon: '🦵', label: 'רגליים' },
  { he: 'חמישי', day: 'Thu', type: 'arms',   icon: '💪', label: 'ידיים/כתפיים/בטן' },
  { he: 'שישי',  day: 'Fri', type: 'rest',   icon: '😴', label: 'מנוחה' },
  { he: 'שבת',   day: 'Sat', type: 'swim2',  icon: '🏄', label: 'שחייה 2 / גלישה' },
];

const DEFAULT_EXERCISES = {
  chest: [
    { name: 'Dips',          sets: [{ reps:12 },{ reps:12 },{ reps:12 }], tag: '3×12' },
    { name: 'Bench Press',   sets: [{ reps:12,weight:'Warmup' },{ reps:22,weight:'22.5kg' },{ reps:22,weight:'22.5kg' },{ reps:22,weight:'22.5kg' }], tag: 'Warmup+3×22.5kg' },
    { name: 'Incline Smith', sets: [{ reps:10,weight:'17.5kg' },{ reps:10,weight:'17.5kg' },{ reps:10,weight:'17.5kg' },{ reps:10,weight:'17.5kg' }], tag: '4×17.5kg' },
    { name: 'Pec Deck',      sets: [{ reps:12,weight:'60kg' },{ reps:12,weight:'60kg' },{ reps:12,weight:'60kg' }], tag: '3×60kg' },
    { name: 'Push-ups',      sets: [{ reps:'Burnout' },{ reps:'Burnout' }], tag: '2×Burnout' },
  ],
  back: [
    { name: 'Pull-ups',      sets: [{ reps:10 },{ reps:10 },{ reps:10 }], tag: '3×10' },
    { name: 'Seated Row',    sets: [{ reps:12,weight:'50kg' },{ reps:12,weight:'50kg' },{ reps:12,weight:'50kg' }], tag: '3×50kg' },
    { name: 'Lat Pulldown',  sets: [{ reps:12,weight:'50kg' },{ reps:12,weight:'50kg' },{ reps:12,weight:'50kg' }], tag: '3×50kg' },
  ],
  legs: [
    { name: 'Adductor/Abductor', sets: [{ reps:12 },{ reps:12 },{ reps:12 }], tag: '3×12' },
    { name: 'Hip Thrust',        sets: [{ reps:10 },{ reps:10 },{ reps:10 }], tag: '3×10' },
    { name: 'Standing Leg Curl', sets: [{ reps:10 },{ reps:10 },{ reps:10 }], tag: '3×10' },
    { name: 'Leg Press',         sets: [{ reps:10 },{ reps:10 },{ reps:10 }], tag: '3×10' },
    { name: 'Calf Raises',       sets: [{ reps:15 },{ reps:15 },{ reps:15 }], tag: '3×15' },
  ],
  arms: [
    { name: 'DB Press / Lateral Raise Superset', sets: [{ reps:8 },{ reps:8 },{ reps:8 }], tag: '3×8 Superset' },
    { name: 'Preacher Curl',    sets: [{ reps:8 },{ reps:8 },{ reps:8 },{ reps:8 }], tag: '4×8' },
    { name: 'Hammer Curl',      sets: [{ reps:8 },{ reps:8 },{ reps:8 },{ reps:8 }], tag: '4×8' },
    { name: 'Cable Pushdown',   sets: [{ reps:12 },{ reps:12 },{ reps:12 }], tag: '3×12' },
    { name: 'Overhead Triceps', sets: [{ reps:12 },{ reps:12 },{ reps:12 }], tag: '3×12' },
    { name: 'Ab Roller',        sets: [{ reps:10 },{ reps:10 },{ reps:10 }], tag: '3×10' },
    { name: 'Hanging Leg Raise Superset', sets: [{ reps:'Failure' },{ reps:'Failure' },{ reps:'Failure' }], tag: '3×Failure' },
    { name: 'Machine Crunch',   sets: [{ reps:15 },{ reps:15 },{ reps:15 }], tag: '3 sets' },
  ],
  swim1: [], swim2: [], rest: [],
};

let colWorkouts = null;
let colBooks    = null;
let colTasks    = null;
let colLogs     = null;

function initCollections() {
  colWorkouts = getCollection('workouts');
  colBooks    = getCollection('books');
  colTasks    = getCollection('tasks');
  colLogs     = getCollection('logs');
}

let toastTimer = null;
function showToast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function weekKeyNow() {
  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay());
  return weekStart.toISOString().split('T')[0];
}

function navigateTo(screenId) {
  state.currentScreen = screenId;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${screenId}`)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    const isActive = n.dataset.screen === screenId;
    n.classList.toggle('active', isActive);
    if (isActive) n.setAttribute('aria-current', 'page');
    else n.removeAttribute('aria-current');
  });
  renderScreen(screenId);
}

function renderScreen(id) {
  switch (id) {
    case 'home':     renderHome();     break;
    case 'workouts': renderWorkouts(); break;
    case 'books':    renderBooks();    break;
    case 'tasks':    renderTasks();    break;
    case 'logs':     renderLogs();     break;
  }
}

function updateHeader() {
  const today = new Date();
  const opts  = { weekday:'long', year:'numeric', month:'long', day:'numeric' };
  document.getElementById('header-date').textContent = today.toLocaleDateString('he-IL', opts);
  document.getElementById('streak-count').textContent = `🔥 ${state.streak} שבועות ברצף!`;
}

// ─── AI Controller State & Helpers ──────────────────────────────────────────
let aiInterview = null;
let aiOnComplete = null;
let aiBusy = false;

function aiSetInputEnabled(enabled) {
  const inp = document.getElementById('ai-input');
  const btn = document.getElementById('ai-send-btn');
  if (inp) inp.disabled = !enabled;
  if (btn) btn.disabled = !enabled;
}

function aiSetTyping(typing) {
  const el = document.getElementById('ai-typing');
  if (el) el.style.display = typing ? 'flex' : 'none';
}

function aiAppendBubble(sender, text) {
  const box = document.getElementById('ai-chat-messages');
  if (!box) return;
  const bubble = document.createElement('div');
  bubble.className = `ai-bubble ${sender === 'user' ? 'user' : 'bot'}`;
  bubble.textContent = text;
  box.appendChild(bubble);
  box.scrollTop = box.scrollHeight;
}

async function startAISession({ title, greeting, createSession, onComplete }) {
  const titleEl = document.getElementById('ai-modal-title');
  if (titleEl) titleEl.textContent = title;
  aiOnComplete = onComplete;

  openModal('ai-modal');
  const box = document.getElementById('ai-chat-messages');
  if (box) box.innerHTML = '';
  aiSetInputEnabled(false);
  aiSetTyping(true);
  aiBusy = true;
  try {
    aiInterview = await createSession();
    const first = await aiInterview.start();
    aiSetTyping(false);
    aiAppendBubble('ai', first.reply || greeting);
    if (first.complete && aiOnComplete) await aiOnComplete(first);
  } catch (e) {
    console.error('AI init error:', e);
    aiSetTyping(false);
    aiAppendBubble('ai', '⚠️ לא הצלחתי להתחבר ל-AI. ודא ש-Firebase AI Logic מופעל בקונסול.');
  } finally {
    aiBusy = false;
    aiSetInputEnabled(true);
  }
}

window.app = window.app || {};

window.app.openAIBuilder = async () => {
  if (state.hasCustomPlan && !confirm('כבר יש לך תוכנית אימונים. לבנות מחדש ולהחליף אותה?')) return;
  await startAISession({
    title: '✨ בניית אימונים עם AI',
    greeting: 'שלום! האם אתה מתאמן?',
    createSession: createWorkoutInterview,
    onComplete: async (res) => {
      if (res.days && res.days.length) {
        await applyAIPlan(res.days);
        aiAppendBubble('ai', '✅ התוכנית נוספה לממשק! עובר למסך האימונים...');
        setTimeout(() => {
          closeModal('ai-modal');
          aiInterview = null;
          navigateTo('workouts');
          showToast('💪 תוכנית האימונים נבנתה!');
        }, 1400);
      }
    },
  });
};

window.app.openOnboardingAgent = async () => {
  await startAISession({
    title: '🤖 בוא נכיר — הגדרת המערכת',
    greeting: 'היי! בוא נגדיר לך את המערכת. האם אתה מתאמן?',
    createSession: createOnboardingAgent,
    onComplete: async (res) => {
      await applyOnboarding(res.data);
      aiAppendBubble('ai', '✅ סיימנו! כל הממידע נכנס למערכת. עובר לדשבורד...');
      setTimeout(() => {
        closeModal('ai-modal');
        aiInterview = null;
        navigateTo('home');
        showToast('🎉 המערכת שלך מוכנה!');
      }, 1600);
    },
  });
};

window.app.aiSend = async () => {
  const inp = document.getElementById('ai-input');
  if (!inp || !aiInterview || aiBusy) return;
  const text = inp.value.trim();
  if (!text) return;
  
  inp.value = '';
  aiAppendBubble('user', text);
  aiSetInputEnabled(false);
  aiSetTyping(true);
  aiBusy = true;

  try {
    const res = await aiInterview.send(text);
    aiSetTyping(false);
    if (res.reply) {
      aiAppendBubble('ai', res.reply);
    }
    if (res.complete && aiOnComplete) {
      await aiOnComplete(res);
    }
  } catch (e) {
    console.error('AI error:', e);
    aiSetTyping(false);
    aiAppendBubble('ai', '⚠️ שגיאה בתקשורת עם ה-AI. נסה שוב.');
  } finally {
    aiBusy = false;
    aiSetInputEnabled(true);
  }
};

async function applyAIPlan(days) {
  if (!Array.isArray(days)) return;
  days.forEach((dayObj) => {
    const dIdx = parseInt(dayObj.dayIndex);
    if (isNaN(dIdx) || dIdx < 0 || dIdx > 6) return;
    const dayType = WEEK_SCHEDULE[dIdx]?.type;
    if (!dayType || dayType === 'rest' || dayType === 'swim1' || dayType === 'swim2') return;

    if (dayObj.isRest) {
      DEFAULT_EXERCISES[dayType] = [];
    } else if (Array.isArray(dayObj.exercises) && dayObj.exercises.length > 0) {
      DEFAULT_EXERCISES[dayType] = dayObj.exercises.map((ex) => ({
        name: ex.name || 'תרגיל',
        sets: Array.from({ length: parseInt(ex.sets) || 3 }, () =>
          ex.weight ? { reps: ex.reps || '10', weight: ex.weight } : { reps: ex.reps || '10' }
        ),
        tag: `${ex.sets || 3}×${ex.reps || 10}${ex.weight ? ' ' + ex.weight : ''}`,
      }));
    }
  });
  state.hasCustomPlan = true;
  await saveCustomExercises();
  renderExercises();
}

async function applyOnboarding(data) {
  data = data || {};

  if (Array.isArray(data.workoutDays) && data.workoutDays.length) {
    await applyAIPlan(data.workoutDays);
  }

  for (const b of (data.books || [])) {
    const title = String(b.title || '').trim();
    const pages = Math.max(1, parseInt(b.totalPages) || 0);
    if (!title || pages < 1) continue;
    const current = Math.max(0, Math.min(pages, parseInt(b.currentPage) || 0));
    try {
      const doc = await colBooks.add({ title, totalPages: pages, currentPage: current, finished: false });
      state.books.push(doc);
    } catch (e) { console.warn('onboarding book add failed:', e); }
  }

  for (const t of (data.tasks || [])) {
    const txt = String(t.text || '').trim();
    if (!txt) continue;
    const category = t.category === 'weekly' ? 'weekly' : 'daily';
    try {
      const doc = await colTasks.add({ text: txt, category, done: false });
      state.tasks.push(doc);
    } catch (e) { console.warn('onboarding task add failed:', e); }
  }

  renderHome();
}

async function renderHome() {
  const dayIdx = new Date().getDay();
  const dayInfo = WEEK_SCHEDULE[dayIdx];
  const typeKey = dayInfo.type;

  // Onboarding banner for new users
  let banner = document.getElementById('home-onboard-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'home-onboard-banner';
    const screenHome = document.getElementById('screen-home');
    if (screenHome) screenHome.insertBefore(banner, screenHome.firstChild);
  }

  const isNew = !state.hasCustomPlan && state.books.length === 0 && state.tasks.length === 0;
  if (isNew) {
    banner.innerHTML = `
      <div class="setup-card">
        <div class="setup-card-emoji">🤖</div>
        <div class="setup-card-title">בוא נכיר ונגדיר לך את המערכת</div>
        <div class="setup-card-sub">הסוכן החכם ישאל אותך כמה שאלות על אימונים, ספרים, משימות ותחומים נוספים — והכול ייכנס אוטומטית למקומו.</div>
        <button class="btn btn-ai btn-full" onclick="app.openOnboardingAgent()">🤖 התחל עם הסוכן</button>
      </div>`;
  } else {
    banner.innerHTML = '';
  }

  const woCompEl = document.getElementById('today-workout-completion');
  const woNameEl = document.getElementById('today-workout-name');
  const woMetaEl = document.getElementById('today-workout-meta');
  const woBarEl  = document.getElementById('today-workout-bar');

  woNameEl.textContent = `${dayInfo.icon} ${dayInfo.label}`;
  woMetaEl.textContent = dayInfo.he;

  const exercises = DEFAULT_EXERCISES[typeKey] || [];
  const savedDay  = state.workoutData[dayIdx] || {};
  let totalSets = 0, doneSets = 0;
  exercises.forEach((ex, ei) => {
    ex.sets.forEach((_, si) => {
      totalSets++;
      if (savedDay[`${ei}_${si}`]) doneSets++;
    });
  });
  const pct = totalSets > 0 ? Math.round((doneSets / totalSets) * 100) : 0;
  woCompEl.textContent   = `${pct}%`;
  woBarEl.style.width    = `${pct}%`;

  const bookCard = document.getElementById('home-book-card');
  const active   = state.books.find(b => !b.finished);
  if (active) {
    const bpct = Math.round((active.currentPage / active.totalPages) * 100);
    bookCard.innerHTML = `
      <div class="card-header">
        <div class="card-title">📖 ספר פעיל</div>
        <div class="stat-pill indigo">${bpct}%</div>
      </div>
      <div class="book-title">${escHtml(active.title)}</div>
      <div class="book-pages-display">עמוד ${active.currentPage} מתוך ${active.totalPages}</div>
      <div class="progress-bar mt-2"><div class="progress-fill indigo" style="width:${bpct}%"></div></div>`;
  } else {
    bookCard.innerHTML = `<div class="empty-state"><div class="icon">📚</div><div class="msg">אין ספר פעיל</div></div>`;
  }

  const taskSummaryEl = document.getElementById('home-tasks-summary');
  const pending = state.tasks.filter(t => t.category === 'daily' && !t.done);
  taskSummaryEl.innerHTML = pending.length
    ? pending.slice(0,4).map(t => `
        <div class="task-item" style="background:var(--bg-card-2)">
          <div class="task-checkbox ${t.done ? 'checked' : ''}">
            ${t.done ? '✓' : ''}
          </div>
          <div class="task-text" style="cursor:default">${escHtml(t.text)}</div>
        </div>`).join('')
    : `<div class="empty-state"><div class="icon">✅</div><div class="msg">כל המשימות הושלמו!</div></div>`;
}

function renderWorkouts() {
  const tabsEl = document.getElementById('day-tabs');
  tabsEl.innerHTML = WEEK_SCHEDULE.map((d, i) => `
    <button class="day-tab ${i === state.selectedDay ? 'active' : ''}"
            onclick="app.selectDay(${i})">
      ${d.icon} ${d.he}
    </button>`).join('');

  renderExercises();
}

function renderExercises() {
  const dayInfo  = WEEK_SCHEDULE[state.selectedDay];
  const typeKey  = dayInfo.type;
  const savedDay = state.workoutData[state.selectedDay] || {};
  const listEl   = document.getElementById('exercise-list');

  if (typeKey === 'rest') {
    listEl.innerHTML = `<div class="empty-state"><div class="icon">😴</div>
      <div class="msg">יום מנוחה!</div>
      <div class="sub">מנוחה היא חלק מהאימון 💪</div></div>`;
    document.getElementById('workout-progress-label').textContent = '';
    document.getElementById('workout-progress-bar').style.width = '0%';
    return;
  }
  if (typeKey === 'swim1' || typeKey === 'swim2') {
    listEl.innerHTML = `<div class="empty-state"><div class="icon">🏊</div>
      <div class="msg">${dayInfo.label}</div>
      <div class="sub">להנות ולשחות! 🌊</div></div>`;
    document.getElementById('workout-progress-label').textContent = '';
    document.getElementById('workout-progress-bar').style.width = '0%';
    return;
  }

  const exercises = DEFAULT_EXERCISES[typeKey] || [];
  if (exercises.length === 0) {
    listEl.innerHTML = `<div class="empty-state"><div class="icon">🏋️</div>
      <div class="msg">אין תרגילים עדיין</div>
      <div class="sub">הוסף תרגיל חדש</div></div>`;
    document.getElementById('workout-progress-label').textContent = '0/0 • 0%';
    document.getElementById('workout-progress-bar').style.width = '0%';
    return;
  }

  let totalSets = 0, doneSets = 0;
  exercises.forEach((ex, ei) => ex.sets.forEach((_, si) => {
    totalSets++;
    if (savedDay[`${ei}_${si}`]) doneSets++;
  }));
  const pct = totalSets > 0 ? Math.round((doneSets / totalSets) * 100) : 0;

  document.getElementById('workout-progress-label').textContent = `${doneSets}/${totalSets} סטים • ${pct}%`;
  document.getElementById('workout-progress-bar').style.width = `${pct}%`;

  listEl.innerHTML = exercises.map((ex, ei) => {
    const allDone = ex.sets.every((_, si) => savedDay[`${ei}_${si}`]);
    return `
    <div class="exercise-item ${allDone ? 'completed' : ''}" id="ex-${ei}">
      <div class="exercise-header">
        <div class="exercise-name">${escHtml(ex.name)}</div>
        <div class="exercise-tag">${escHtml(ex.tag)}</div>
      </div>
      <div class="sets-row">
        ${ex.sets.map((s, si) => {
          const done = !!savedDay[`${ei}_${si}`];
          const label = s.weight ? `${s.reps} × ${s.weight}` : `${s.reps}`;
          return `<button class="set-chip ${done ? 'done' : ''}"
                    onclick="app.toggleSet(${state.selectedDay}, ${ei}, ${si})">
                    ${done ? '✓ ' : ''}${escHtml(label)}
                  </button>`;
        }).join('')}
      </div>
      <div class="exercise-actions">
        <button class="icon-btn" title="ערוך" onclick="app.editExercise(${ei})">✏️</button>
        <button class="icon-btn danger" title="מחק תרגיל" onclick="app.deleteExercise(${ei})">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

window.app.selectDay = (i) => { state.selectedDay = i; renderWorkouts(); };

window.app.toggleSet = (dayIdx, exIdx, setIdx) => {
  const wk = weekKeyNow();
  if (state.workoutData._weekKey && state.workoutData._weekKey !== wk) {
    Object.keys(state.workoutData).forEach(k => {
      if (k !== '_weekKey') state.workoutData[k] = {};
    });
  }
  state.workoutData._weekKey = wk;

  if (!state.workoutData[dayIdx]) state.workoutData[dayIdx] = {};
  const key = `${exIdx}_${setIdx}`;
  state.workoutData[dayIdx][key] = !state.workoutData[dayIdx][key];
  saveWorkoutData();
  renderExercises();
  if (state.currentScreen === 'home') renderHome();
};

window.app.editExercise = (exIdx) => {
  const dayType = WEEK_SCHEDULE[state.selectedDay].type;
  const ex      = DEFAULT_EXERCISES[dayType]?.[exIdx];
  if (!ex) return;
  openModal('edit-exercise-modal');
  document.getElementById('edit-ex-name').value   = ex.name;
  document.getElementById('edit-ex-tag').value    = ex.tag;
  document.getElementById('edit-ex-index').value  = exIdx;
};

window.app.deleteExercise = (exIdx) => {
  const dayType = WEEK_SCHEDULE[state.selectedDay].type;
  const ex      = DEFAULT_EXERCISES[dayType];
  if (!ex) return;
  if (!confirm('למחוק את התרגיל?')) return;
  ex.splice(exIdx, 1);
  saveCustomExercises();
  renderExercises();
  showToast('תרגיל נמחק');
};

async function saveWorkoutData() {
  try {
    const all = await colWorkouts.getAll();
    const existing = all.find(d => d.type === 'workout_sets');
    const payload  = { type: 'workout_sets', data: JSON.stringify(state.workoutData) };
    if (existing) await colWorkouts.update(existing.id, payload);
    else           await colWorkouts.add(payload);
  } catch (e) { console.warn('Could not save workout data:', e); }
}

async function saveCustomExercises() {
  try {
    const all = await colWorkouts.getAll();
    const existing = all.find(d => d.type === 'custom_exercises');
    const payload  = { type: 'custom_exercises', data: JSON.stringify(DEFAULT_EXERCISES) };
    if (existing) await colWorkouts.update(existing.id, payload);
    else           await colWorkouts.add(payload);
  } catch (e) { console.warn('Could not save custom exercises:', e); }
}

async function loadWorkoutData() {
  try {
    const all = await colWorkouts.getAll();
    const setsDoc = all.find(d => d.type === 'workout_sets');
    if (setsDoc?.data) {
      state.workoutData = JSON.parse(setsDoc.data);
      const wk = weekKeyNow();
      if (state.workoutData._weekKey && state.workoutData._weekKey !== wk) {
        Object.keys(state.workoutData).forEach(k => {
          if (k !== '_weekKey') state.workoutData[k] = {};
        });
        state.workoutData._weekKey = wk;
        saveWorkoutData();
      }
    }
    const exDoc = all.find(d => d.type === 'custom_exercises');
    if (exDoc?.data) {
      const saved = JSON.parse(exDoc.data);
      Object.keys(saved).forEach(key => { DEFAULT_EXERCISES[key] = saved[key]; });
      state.hasCustomPlan = true;
    }
  } catch (e) { console.warn('Could not load workout data:', e); }
}

function renderBooks() {
  const active   = state.books.filter(b => !b.finished);
  const finished = state.books.filter(b => b.finished);
  const listEl   = document.getElementById('active-books-list');
  const archEl   = document.getElementById('finished-books-list');

  listEl.innerHTML = active.length
    ? active.map(b => bookCard(b)).join('')
    : `<div class="empty-state"><div class="icon">📚</div><div class="msg">אין ספרים פעילים</div></div>`;

  archEl.innerHTML = finished.length
    ? finished.map(b => `
        <div class="archive-item">
          <div class="archive-item-info">
            <div class="archive-item-title">${escHtml(b.title)}</div>
            <div class="archive-item-meta">${b.totalPages} עמודים • ${escHtml(b.finishedDate || '—')}</div>
          </div>
          <button class="icon-btn danger" onclick="app.deleteBook('${b.id}')">🗑️</button>
        </div>`).join('')
    : `<div class="empty-state" style="padding:16px"><div class="msg text-muted">אין ספרים שסיימת עדיין</div></div>`;
}

function bookCard(b) {
  const pct = Math.min(100, Math.round((b.currentPage / b.totalPages) * 100));
  return `
  <div class="book-card" id="book-${b.id}">
    <div class="card-header">
      <div>
        <div class="book-title">${escHtml(b.title)}</div>
        <div class="book-pages-display">עמוד ${b.currentPage} מתוך ${b.totalPages}</div>
      </div>
      <div class="stat-pill indigo">${pct}%</div>
    </div>
    <div class="progress-bar"><div class="progress-fill indigo" style="width:${pct}%"></div></div>
    <div class="page-controls mt-2">
      <input class="page-input" type="number" id="page-inp-${b.id}" 
             value="${b.currentPage}" min="0" max="${b.totalPages}" style="max-width:90px">
      <button class="quick-btn" onclick="app.incPage('${b.id}',1)">+1</button>
      <button class="quick-btn" onclick="app.incPage('${b.id}',5)">+5</button>
      <button class="quick-btn" onclick="app.incPage('${b.id}',10)">+10</button>
      <button class="btn btn-sm btn-primary" onclick="app.setPage('${b.id}')">שמור</button>
    </div>
    <div class="flex gap-2 mt-2">
      ${pct >= 100 ? `<button class="btn btn-sm btn-primary" onclick="app.finishBook('${b.id}')">✅ סיימתי!</button>` : ''}
      <button class="btn btn-sm btn-danger" onclick="app.deleteBook('${b.id}')">🗑️ מחק</button>
    </div>
  </div>`;
}

window.app.incPage = async (id, n) => {
  const b = state.books.find(x => x.id === id);
  if (!b) return;
  b.currentPage = Math.min(b.totalPages, b.currentPage + n);
  await colBooks.update(id, { currentPage: b.currentPage });
  renderBooks();
  renderHome();
};
window.app.setPage = async (id) => {
  const b   = state.books.find(x => x.id === id);
  const inp = document.getElementById(`page-inp-${id}`);
  if (!b || !inp) return;
  const val = Math.max(0, Math.min(b.totalPages, parseInt(inp.value) || 0));
  b.currentPage = val;
  await colBooks.update(id, { currentPage: val });
  renderBooks();
  renderHome();
  showToast(`עמוד ${val} נשמר`);
};
window.app.finishBook = async (id) => {
  const b = state.books.find(x => x.id === id);
  if (!b) return;
  b.finished = true;
  b.finishedDate = new Date().toLocaleDateString('he-IL');
  await colBooks.update(id, { finished: true, finishedDate: b.finishedDate });
  renderBooks();
  renderHome();
  showToast('🎉 כל הכבוד! סיימת את הספר!');
};
window.app.deleteBook = async (id) => {
  if (!confirm('למחוק את הספר?')) return;
  state.books = state.books.filter(b => b.id !== id);
  await colBooks.remove(id);
  renderBooks();
  renderHome();
  showToast('ספר נמחק');
};

function renderTasks() {
  const filtered = state.tasks.filter(t => {
    const catMatch = t.category === state.taskFilter;
    const visMatch = state.showCompleted || !t.done;
    return catMatch && visMatch;
  });

  const listEl = document.getElementById('task-list');
  listEl.innerHTML = filtered.length
    ? filtered.map(t => `
        <div class="task-item ${t.done ? 'completed' : ''}" id="task-${t.id}">
          <div class="task-checkbox ${t.done ? 'checked' : ''}" onclick="app.toggleTask('${t.id}')">
            ${t.done ? '✓' : ''}
          </div>
          <div class="task-text" contenteditable="true"
               onblur="app.editTask('${t.id}', this.textContent.trim())"
               >${escHtml(t.text)}</div>
          <button class="icon-btn danger" onclick="app.deleteTask('${t.id}')">🗑️</button>
        </div>`).join('')
    : `<div class="empty-state"><div class="icon">${state.taskFilter==='daily'?'📋':'📅'}</div>
        <div class="msg">אין משימות ${state.showCompleted?'':'פתוחות'}</div>
        <div class="sub">הוסף משימה חדשה למטה ✨</div></div>`;

  document.getElementById('tab-daily').classList.toggle('active', state.taskFilter === 'daily');
  document.getElementById('tab-weekly').classList.toggle('active', state.taskFilter === 'weekly');

  const cnt = state.tasks.filter(t => t.category === state.taskFilter && t.done).length;
  document.getElementById('completed-count').textContent = cnt ? `${cnt} משימות הושלמו` : '';
}

window.app.toggleTask = async (id) => {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  t.done = !t.done;
  await colTasks.update(id, { done: t.done });
  renderTasks();
  renderHome();
};
window.app.editTask = async (id, text) => {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  if (!text) {
    const el = document.querySelector(`#task-${id} .task-text`);
    if (el) el.textContent = t.text;
    return;
  }
  if (t.text === text) return;
  t.text = text;
  await colTasks.update(id, { text });
};
window.app.deleteTask = async (id) => {
  if (!confirm('למחוק את המשימה?')) return;
  state.tasks = state.tasks.filter(t => t.id !== id);
  await colTasks.remove(id);
  renderTasks();
  renderHome();
  showToast('משימה נמחקה');
};

function renderLogs() {
  const historyEl = document.getElementById('log-history');
  const sorted    = [...state.logs].sort((a, b) => (b._createdAt || 0) - (a._createdAt || 0));

  historyEl.innerHTML = sorted.slice(0, 30).map(log => `
    <div class="log-history-item">
      <div class="log-history-date">${escHtml(log.date || '—')}</div>
      <div class="log-history-content">
        ${log.linux  ? `<div>🐧 <strong>Linux:</strong> ${escHtml(log.linux)}</div>`  : ''}
        ${log.market ? `<div>📈 <strong>שוק:</strong> ${escHtml(log.market)}</div>` : ''}
        ${log.win    ? `<div>🏆 <strong>Win:</strong> ${escHtml(log.win)}</div>`    : ''}
      </div>
    </div>`).join('') ||
    `<div class="empty-state" style="padding:20px"><div class="icon">📓</div>
      <div class="msg">אין רשומות עדיין</div></div>`;

  const u = state.user;
  document.getElementById('settings-user-name').textContent  = u?.displayName || u?.email || 'אורח';
  document.getElementById('settings-user-email').textContent = u?.email || '—';
  document.getElementById('settings-mode-badge').textContent = isMockMode ? '🟡 מצב מקומי' : '🟢 Firebase';
  document.getElementById('settings-streak-val').textContent = `${state.streak} שבועות`;
}

window.app.saveLog = async () => {
  const linux  = document.getElementById('log-linux').value.trim();
  const market = document.getElementById('log-market').value.trim();
  const win    = document.getElementById('log-win').value.trim();
  if (!linux && !market && !win) { showToast('מלא לפחות שדה אחד'); return; }

  const payload = {
    linux, market, win,
    date: new Date().toLocaleDateString('he-IL'),
    _createdAt: Date.now(),
  };
  const saved = await colLogs.add(payload);
  state.logs.push(saved);
  document.getElementById('log-linux').value  = '';
  document.getElementById('log-market').value = '';
  document.getElementById('log-win').value    = '';
  renderLogs();
  showToast('📓 יומן נשמר!');
};

window.app.syncStreak = async () => {
  state.streak++;
  await settingsStore.set({ streak: state.streak });
  updateHeader();
  renderLogs();
  showToast(`🔥 רצף: ${state.streak} שבועות!`);
};

function setAuthBtnLoading(btnId, loading, originalText) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? '⏳ טוען...' : originalText;
}

const AUTH_ERRORS = {
  'auth/user-not-found':        'משתמש לא נמצא. האם להירשם?',
  'auth/wrong-password':        'סיסמה שגויה',
  'auth/invalid-credential':    'אימייל או סיסמה שגויים',
  'auth/email-already-in-use':  'האימייל כבר רשום. נסה להיכנס במקום',
  'auth/weak-password':         'הסיסמה קצרה מדי (לפחות 6 תווים)',
  'auth/invalid-email':         'כתובת אימייל לא תקינה',
  'auth/too-many-requests':     'יותר מדי ניסיונות. המתן דקה ונסה שוב',
  'auth/network-request-failed':'בעיית רשת. בדוק חיבור לאינטרנט',
};
function authError(e) {
  const code = e.code || '';
  return AUTH_ERRORS[code] || e.message || 'שגיאה לא ידועה';
}

window.app.authLogin = async () => {
  const email = document.getElementById('auth-email').value.trim();
  const pass  = document.getElementById('auth-pass').value;
  if (!email || !pass) { showToast('מלא אימייל וסיסמה'); return; }
  setAuthBtnLoading('auth-submit-btn', true, 'כניסה');
  try {
    const user = await signIn(email, pass);
    if (user) await onUserSignedIn(user);
  } catch (e) {
    console.error('Login error:', e);
    showToast(authError(e));
    setAuthBtnLoading('auth-submit-btn', false, 'כניסה');
  }
};
window.app.authRegister = async () => {
  const email = document.getElementById('auth-email').value.trim();
  const pass  = document.getElementById('auth-pass').value;
  if (!email || !pass) { showToast('מלא אימייל וסיסמה'); return; }
  setAuthBtnLoading('auth-submit-btn', true, 'הרשמה');
  try {
    const user = await register(email, pass);
    if (user) await onUserSignedIn(user);
  } catch (e) {
    console.error('Register error:', e);
    showToast(authError(e));
    setAuthBtnLoading('auth-submit-btn', false, 'הרשמה');
  }
};
window.app.authGoogle = async () => {
  const btn = document.getElementById('btn-google');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ מתחבר לגוגל...'; }
  try {
    const user = await signInGoogle();
    if (user) {
      await onUserSignedIn(user);
    }
  } catch (e) {
    console.error('Google auth error:', e);
    showToast('Google: ' + authError(e));
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
  }
};
window.app.authDemo = async () => {
  signInDemo();
  await onUserSignedIn({
    uid: 'demo_user_local', email: 'demo@local', displayName: '👤 Demo User'
  });
};
window.app.logOut = async () => {
  await logOut();
  state.user = null;
  state.books = []; state.tasks = []; state.logs = []; state.streak = 0;
  state.workoutData = {};
  showAuthScreen();
};

function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
window.app.openModal  = openModal;
window.app.closeModal = closeModal;

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
});

window.app.submitAddBook = async () => {
  const title = document.getElementById('new-book-title').value.trim();
  const pages = parseInt(document.getElementById('new-book-pages').value) || 0;
  if (!title || pages < 1) { showToast('מלא שם ומספר עמודים תקין'); return; }
  const doc = await colBooks.add({ title, totalPages: pages, currentPage: 0, finished: false });
  state.books.push(doc);
  closeModal('add-book-modal');
  document.getElementById('new-book-title').value = '';
  document.getElementById('new-book-pages').value = '';
  renderBooks();
  renderHome();
  showToast('📚 ספר חדש נוסף!');
};

window.app.submitAddTask = async () => {
  const text = document.getElementById('new-task-text').value.trim();
  if (!text) { showToast('הכנס טקסט למשימה'); return; }
  const doc = await colTasks.add({ text, category: state.taskFilter, done: false });
  state.tasks.push(doc);
  closeModal('add-task-modal');
  document.getElementById('new-task-text').value = '';
  renderTasks();
  renderHome();
  showToast('משימה חדשה נוספה!');
};

window.app.submitEditExercise = () => {
  const idx  = parseInt(document.getElementById('edit-ex-index').value);
  const name = document.getElementById('edit-ex-name').value.trim();
  const tag  = document.getElementById('edit-ex-tag').value.trim();
  const dayType = WEEK_SCHEDULE[state.selectedDay].type;
  if (!name || !DEFAULT_EXERCISES[dayType]?.[idx]) return;
  DEFAULT_EXERCISES[dayType][idx].name = name;
  DEFAULT_EXERCISES[dayType][idx].tag  = tag;
  saveCustomExercises();
  closeModal('edit-exercise-modal');
  renderExercises();
  showToast('תרגיל עודכן');
};

window.app.submitAddExercise = () => {
  const name = document.getElementById('new-ex-name').value.trim();
  const sets = parseInt(document.getElementById('new-ex-sets').value) || 3;
  const reps = document.getElementById('new-ex-reps').value.trim() || '10';
  const weight = document.getElementById('new-ex-weight').value.trim();
  if (!name) { showToast('הכנס שם תרגיל'); return; }
  const dayType = WEEK_SCHEDULE[state.selectedDay].type;
  if (!DEFAULT_EXERCISES[dayType]) DEFAULT_EXERCISES[dayType] = [];
  const newEx = {
    name,
    sets: Array.from({ length: sets }, () => weight ? { reps, weight } : { reps }),
    tag: `${sets}×${reps}${weight ? ' '+weight : ''}`,
  };
  DEFAULT_EXERCISES[dayType].push(newEx);
  saveCustomExercises();
  closeModal('add-exercise-modal');
  document.getElementById('new-ex-name').value = '';
  document.getElementById('new-ex-sets').value = '';
  document.getElementById('new-ex-reps').value = '';
  document.getElementById('new-ex-weight').value = '';
  renderExercises();
  showToast('תרגיל חדש נוסף!');
};

window.app.setTaskFilter = (f) => {
  state.taskFilter = f;
  renderTasks();
};
window.app.toggleShowCompleted = (el) => {
  state.showCompleted = el.checked;
  renderTasks();
};

function showAuthScreen()  {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app').style.visibility = 'hidden';
}
function hideAuthScreen() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').style.visibility = 'visible';
}

let authMode = 'login';
window.app.switchAuthMode = () => {
  authMode = authMode === 'login' ? 'register' : 'login';
  document.getElementById('auth-mode-title').textContent = authMode === 'login' ? 'כניסה' : 'הרשמה';
  document.getElementById('auth-submit-btn').textContent  = authMode === 'login' ? 'כניסה' : 'הרשמה';
  document.getElementById('auth-switch-link').textContent = authMode === 'login'
    ? 'אין לך חשבון? הירשם'
    : 'יש לך חשבון? כנס';
  document.getElementById('auth-submit-btn').onclick = authMode === 'login'
    ? window.app.authLogin
    : window.app.authRegister;
};

async function onUserSignedIn(user) {
  state.user = user;
  initCollections();

  try {
    const [books, tasks, logs, settings] = await Promise.all([
      colBooks.getAll(),
      colTasks.getAll(),
      colLogs.getAll(),
      settingsStore.get(),
    ]);
    state.books  = books;
    state.tasks  = tasks;
    state.logs   = logs;
    state.streak = settings.streak || 0;
  } catch (e) {
    console.warn('Data load error:', e);
  }

  await loadWorkoutData();
  updateHeader();
  hideAuthScreen();
  navigateTo('home');
  maybeAutoOnboard();
}

function maybeAutoOnboard() {
  const uid = state.user?.uid || 'anon';
  const key = `pcc_onboarded_${uid}`;
  const isNew = !state.hasCustomPlan && state.books.length === 0 && state.tasks.length === 0;
  if (isNew && !localStorage.getItem(key)) {
    localStorage.setItem(key, '1');
    setTimeout(() => { window.app.openOnboardingAgent(); }, 700);
  }
}

async function bootstrap() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(console.warn);
  }

  showAuthScreen();

  try {
    const redirectUser = await checkRedirectResult();
    if (redirectUser) {
      await onUserSignedIn(redirectUser);
      return;
    }
  } catch (e) {
    console.warn('Redirect check failed:', e);
  }

  await initAuth(async (user) => {
    if (!user) {
      showAuthScreen();
      return;
    }
    await onUserSignedIn(user);
  });
}

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => navigateTo(btn.dataset.screen));
});

bootstrap().catch(e => console.error('Bootstrap failed:', e));
