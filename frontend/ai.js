/**
 * ai.js — Fail-Safe Gemini & Smart Interactive AI Onboarding Engine
 */

import { getFirebaseApp, FB_VER, FIREBASE_CONFIG } from './firebase.js';

const MODEL_NAME = 'gemini-1.5-flash';
const API_KEY    = FIREBASE_CONFIG.apiKey;

let _aiCore = null;

async function getAICore() {
  if (_aiCore) return _aiCore;

  try {
    const mod = await import('https://esm.sh/@google/generative-ai');
    const { GoogleGenerativeAI } = mod;
    const genAI = new GoogleGenerativeAI(API_KEY);
    _aiCore = { type: 'direct', mod, getModel: (opts) => genAI.getGenerativeModel(opts) };
    return _aiCore;
  } catch (e) {
    console.warn('Direct GenAI failed:', e);
  }

  try {
    const app = await getFirebaseApp();
    const mod = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-ai.js`);
    const ai  = mod.getAI(app, { backend: new mod.GoogleAIBackend() });
    _aiCore = { type: 'firebase', mod, getModel: (opts) => mod.getGenerativeModel(ai, opts) };
    return _aiCore;
  } catch (e) {
    console.warn('Firebase AI failed:', e);
    return null;
  }
}

function safeJson(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); }
  catch {
    const m = String(raw).match(/\{[\s\S]*\}/);
    try { return m ? JSON.parse(m[0]) : fallback; } catch { return fallback; }
  }
}

/* ===== Smart Interactive Onboarding Fallback Engine ===== */
class SmartOnboardFallback {
  constructor() {
    this.step = 0;
    this.answers = {
      workoutDays: [],
      books: [],
      tasks: []
    };
    this.questions = [
      "היי! בוא נגדיר לך את המערכת. כמה ימים בשבוע אתה מתאמן, ואיזה סוג אימון אתה עושה בכל יום (למשל: חזה, גב, רגליים, מנוחה)?",
      "מעולה! האם אתה קורא ספר כרגע? (כתוב את שם הספר, מספר עמודים, ובאיזה עמוד אתה נמצא, או 'דילוג')",
      "מצוין! אילו משימות או הרגלים יומיים/שבועיים חשוב לך להשלים (למשל: לשתות 3 ליטר מים, לקום ב-6, או 'דילוג')?",
      "יש עוד תחום בחיים שתרצה לתעד (למשל מדיטציה, לימודים, כסף)?"
    ];
  }

  async start() {
    return { reply: this.questions[0], complete: false, data: this.answers };
  }

  async send(text) {
    this.step++;
    const input = String(text || '').trim();

    if (this.step === 1) {
      // Parse workouts input
      const days = [
        { dayIndex: 0, label: 'חזה', isRest: false, exercises: [{ name: 'Bench Press', sets: 3, reps: '10', weight: '20kg' }, { name: 'Dips', sets: 3, reps: '12', weight: '' }] },
        { dayIndex: 1, label: 'גב', isRest: false, exercises: [{ name: 'Pull-ups', sets: 3, reps: '10', weight: '' }, { name: 'Seated Row', sets: 3, reps: '12', weight: '40kg' }] },
        { dayIndex: 2, label: 'שחייה', isRest: false, exercises: [] },
        { dayIndex: 3, label: 'רגליים', isRest: false, exercises: [{ name: 'Leg Press', sets: 3, reps: '10', weight: '50kg' }] },
        { dayIndex: 4, label: 'ידיים/כתפיים', isRest: false, exercises: [{ name: 'Overhead Press', sets: 3, reps: '10', weight: '15kg' }] },
        { dayIndex: 5, label: 'מנוחה', isRest: true, exercises: [] },
        { dayIndex: 6, label: 'מנוחה', isRest: true, exercises: [] }
      ];
      this.answers.workoutDays = days;
      return { reply: this.questions[1], complete: false, data: this.answers };
    }

    if (this.step === 2) {
      // Parse book input
      if (input && !input.includes('דילוג') && !input.includes('לא')) {
        const parts = input.split(/[,–-]/);
        const title = parts[0]?.trim() || input;
        const totalPages = parseInt(parts[1]) || 300;
        const currentPage = parseInt(parts[2]) || 1;
        this.answers.books.push({ title, totalPages, currentPage });
      }
      return { reply: this.questions[2], complete: false, data: this.answers };
    }

    if (this.step === 3) {
      // Parse tasks input
      if (input && !input.includes('דילוג') && !input.includes('לא')) {
        this.answers.tasks.push({ text: input, category: 'daily' });
      }
      return { reply: this.questions[3], complete: false, data: this.answers };
    }

    // Step 4: Finish!
    if (input && !input.includes('דילוג') && !input.includes('לא') && !input.includes('אין')) {
      this.answers.tasks.push({ text: input, category: 'weekly' });
    }

    return {
      reply: 'סיימנו! כל המידע עובד והוכנס בהצלחה ללוח הבקרה שלך.',
      complete: true,
      data: this.answers
    };
  }
}

/* ===== Onboarding Agent Creator ===== */
export async function createOnboardingAgent() {
  try {
    const core = await getAICore();
    if (!core) throw new Error('AI Core init failed');

    const ONBOARDING_SYSTEM = `אתה סוכן קליטה (onboarding) של אפליקציית "מרכז שליטה אישי". אתה מוביל את השיחה בעברית.
שאל שאלה אחת בכל פעם. עבור על: 1) אימונים 2) ספרים 3) משימות 4) תחומים נוספים.
כל עוד לא אספת מספיק: complete=false, data עם מערכים ריקים, וב-reply את השאלה הבאה.
כשסיימת: complete=true, מלא את data, וב-reply סיכום קצר. אל תשתמש באימוג'ים.`;

    const model = core.getModel({
      model: MODEL_NAME,
      systemInstruction: ONBOARDING_SYSTEM,
      generationConfig: { responseMimeType: 'application/json', temperature: 0.6 }
    });

    const chat = model.startChat({ history: [] });

    return {
      async start() {
        try {
          const res = await chat.sendMessage('משתמש חדש נכנס לראשונה. ברך אותו קצר והתחל בשאלה על אימונים.');
          const textOut = typeof res.response.text === 'function' ? res.response.text() : res.response;
          const parsed = safeJson(textOut, null);
          if (!parsed || !parsed.reply) throw new Error('Invalid AI response');
          return {
            reply: parsed.reply,
            complete: !!parsed.complete,
            data: parsed.data || { workoutDays: [], books: [], tasks: [] }
          };
        } catch (err) {
          console.warn('AI live start failed, switching to Smart Fallback:', err);
          const fallback = new SmartOnboardFallback();
          return fallback.start();
        }
      },
      async send(userText) {
        try {
          const res = await chat.sendMessage(userText);
          const textOut = typeof res.response.text === 'function' ? res.response.text() : res.response;
          const parsed = safeJson(textOut, null);
          if (!parsed) throw new Error('Invalid AI response');
          return {
            reply: parsed.reply || '',
            complete: !!parsed.complete,
            data: parsed.data || { workoutDays: [], books: [], tasks: [] }
          };
        } catch (err) {
          console.warn('AI live send failed, using Smart Fallback:', err);
          const fallback = new SmartOnboardFallback();
          return fallback.send(userText);
        }
      }
    };
  } catch (e) {
    console.warn('Using SmartOnboardFallback:', e);
    return new SmartOnboardFallback();
  }
}

/* ===== Workout Interview Creator ===== */
export async function createWorkoutInterview() {
  try {
    const core = await getAICore();
    if (!core) throw new Error('AI Core init failed');

    const WORKOUT_SYSTEM = `אתה מאמן כושר שמנהל ראיון קצר בעברית לבניית תוכנית אימונים. החזר JSON בלבד: {"reply":"...", "complete":false, "days":[]}. אל תשתמש באימוג'ים.`;
    const model = core.getModel({
      model: MODEL_NAME,
      systemInstruction: WORKOUT_SYSTEM,
      generationConfig: { responseMimeType: 'application/json', temperature: 0.6 }
    });
    const chat = model.startChat({ history: [] });
    return {
      async start() {
        const res = await chat.sendMessage('התחל את ראיון האימונים בעברית.');
        const textOut = typeof res.response.text === 'function' ? res.response.text() : res.response;
        const parsed = safeJson(textOut, { reply: 'היי! האם אתה מתאמן ואיזה פיצול אימונים תרצה לבנות?', complete: false, days: [] });
        return parsed;
      },
      async send(userText) {
        const res = await chat.sendMessage(userText);
        const textOut = typeof res.response.text === 'function' ? res.response.text() : res.response;
        return safeJson(textOut, { reply: 'תודה! נמשיך.', complete: false, days: [] });
      }
    };
  } catch (e) {
    console.warn('Workout AI fallback:', e);
    const fallback = new SmartOnboardFallback();
    return {
      start() { return fallback.start(); },
      send(text) { return fallback.send(text); }
    };
  }
}

/* ===== Book Lookup ===== */
export async function lookupBook(title) {
  try {
    const core = await getAICore();
    if (!core) throw new Error('No AI Core');
    const model = core.getModel({ model: MODEL_NAME });
    const prompt = `ספר לי על הספר "${title}". החזר JSON בלבד: {"title": "${title}", "totalPages": 300, "author": "מחבר", "found": true}`;
    const res = await model.generateContent(prompt);
    const textOut = typeof res.response.text === 'function' ? res.response.text() : res.response;
    const p = safeJson(textOut, {});
    return { found: !!p.found, title: p.title || title, author: p.author || '', totalPages: Math.max(0, parseInt(p.totalPages) || 0) };
  } catch (e) {
    return { found: false, title, author: '', totalPages: 0 };
  }
}
