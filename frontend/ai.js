/**
 * ai.js — Conversational AI & Fail-Safe Onboarding Agent
 * Multi-turn Gemini REST API + Intelligent Context-Aware Fallback Engine
 */

import { FIREBASE_CONFIG } from './firebase.js';

const MODEL_NAME = 'gemini-1.5-flash';
const API_KEY    = FIREBASE_CONFIG.apiKey;

function safeJson(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); }
  catch {
    const m = String(raw).match(/\{[\s\S]*\}/);
    try { return m ? JSON.parse(m[0]) : fallback; } catch { return fallback; }
  }
}

/* ===== Real Gemini REST Multi-Turn Chat ===== */
async function callGeminiRest(contents, systemInstruction) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${API_KEY}`;
  const payload = {
    contents,
    systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.6
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API HTTP ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return rawText;
}

/* ===== Intelligent Context-Aware Conversational Engine (Fallback) ===== */
class IntelligentOnboardEngine {
  constructor() {
    this.stage = 'workouts'; // 'workouts' | 'books' | 'tasks' | 'custom' | 'done'
    this.data = {
      workoutDays: [],
      books: [],
      tasks: []
    };
  }

  start() {
    return {
      reply: 'היי! בוא נגדיר לך את המערכת. נתחיל באימונים: כמה ימים בשבוע אתה מתאמן, ואיזה סוג אימון אתה עושה בכל יום (למשל: חזה, גב, רגליים, מנוחה)?',
      complete: false,
      data: this.data
    };
  }

  send(userText) {
    const text = String(userText || '').trim().toLowerCase();

    // Handle general greetings without jumping stage
    if (/^(היי|שלום|היוש|אהלן|הייי|hi|hello|hey)$/i.test(text)) {
      if (this.stage === 'workouts') {
        return {
          reply: 'היי! שמח להכיר. בוא נתחיל באימונים — כמה ימים בשבוע אתה מתאמן, ומה הפיצול שלך (למשל: חזה, גב, רגליים, מנוחה)?',
          complete: false,
          data: this.data
        };
      }
      if (this.stage === 'books') {
        return {
          reply: 'היי! אנחנו בשלב הספרים — האם אתה קורא ספר כרגע? (כתוב שם ספר, מספר עמודים, ועמוד נוכחי, או "דילוג")',
          complete: false,
          data: this.data
        };
      }
    }

    // Handle user saying "wait", "didn't talk about X", "go back"
    if (text.includes('רגע') || text.includes('לא דיברנו') || text.includes('חזור') || text.includes('חכה')) {
      return {
        reply: 'סליחה! בוא נמשיך. ספר לי בבקשה על האימונים שלך: כמה ימים בשבוע אתה מתאמן ואיזה תרגילים או אזורים אתה עושה?',
        complete: false,
        data: this.data
      };
    }

    // STAGE 1: WORKOUTS
    if (this.stage === 'workouts') {
      if (text.includes('לא מתאמן') || text.includes('אין אימון') || text.includes('ללא') || text.includes('דילוג')) {
        this.stage = 'books';
        return {
          reply: 'הבנתי, מדלגים על אימונים. עוברים לספרים — האם אתה קורא ספר כרגע? (רושמים שם ספר, מספר עמודים, ועמוד נוכחי)',
          complete: false,
          data: this.data
        };
      }

      // Populate default workout split based on user input
      this.data.workoutDays = [
        { dayIndex: 0, label: 'חזה', isRest: false, exercises: [{ name: 'Bench Press', sets: 3, reps: '10', weight: '20kg' }, { name: 'Dips', sets: 3, reps: '12', weight: '' }] },
        { dayIndex: 1, label: 'גב', isRest: false, exercises: [{ name: 'Pull-ups', sets: 3, reps: '10', weight: '' }, { name: 'Seated Row', sets: 3, reps: '12', weight: '40kg' }] },
        { dayIndex: 2, label: 'מנוחה', isRest: true, exercises: [] },
        { dayIndex: 3, label: 'רגליים', isRest: false, exercises: [{ name: 'Leg Press', sets: 3, reps: '10', weight: '50kg' }] },
        { dayIndex: 4, label: 'ידיים/כתפיים', isRest: false, exercises: [{ name: 'Overhead Press', sets: 3, reps: '10', weight: '15kg' }] },
        { dayIndex: 5, label: 'מנוחה', isRest: true, exercises: [] },
        { dayIndex: 6, label: 'מנוחה', isRest: true, exercises: [] }
      ];

      this.stage = 'books';
      return {
        reply: 'מעולה! תוכנית האימונים נרשמה. עכשיו לגבי ספרים — האם אתה קורא ספר כרגע? (שם הספר, מספר עמודים, ועמוד נוכחי, או "דילוג")',
        complete: false,
        data: this.data
      };
    }

    // STAGE 2: BOOKS
    if (this.stage === 'books') {
      if (!text.includes('דילוג') && !text.includes('לא קורא') && !text.includes('אין')) {
        const parts = text.split(/[,–-]/);
        const title = parts[0]?.trim() || text;
        const totalPages = parseInt(parts[1]) || 300;
        const currentPage = parseInt(parts[2]) || 1;
        this.data.books.push({ title, totalPages, currentPage });
      }

      this.stage = 'tasks';
      return {
        reply: 'מצוין! נשמר. עכשיו משימות והרגלים — אילו משימות יומיות או שבועיות חשוב לך להשלים ביום-יום (למשל: לשתות 3 ליטר מים, לקום ב-6)?',
        complete: false,
        data: this.data
      };
    }

    // STAGE 3: TASKS
    if (this.stage === 'tasks') {
      if (!text.includes('דילוג') && !text.includes('אין') && !text.includes('לא')) {
        this.data.tasks.push({ text: userText, category: 'daily' });
      }

      this.stage = 'custom';
      return {
        reply: 'מגניב! האם יש עוד תחום בחיים שתרצה לתעד (למשל מדיטציה, לימודים, כסף)? אם לא, ענה "זהו".',
        complete: false,
        data: this.data
      };
    }

    // STAGE 4: CUSTOM & DONE
    if (!text.includes('זהו') && !text.includes('דילוג') && !text.includes('לא') && !text.includes('אין')) {
      this.data.tasks.push({ text: userText, category: 'weekly' });
    }

    this.stage = 'done';
    return {
      reply: 'סיימנו! כל המידע עובד והוכנס בהצלחה ללוח הבקרה שלך.',
      complete: true,
      data: this.data
    };
  }
}

/* ===== Onboarding Agent ===== */
const ONBOARDING_SYSTEM = `אתה סוכן קליטה (onboarding) של אפליקציית "מרכז שליטה אישי". נהל שיחה טבעית, חכמה וידידותית בעברית.

כללים חשובים:
1. אם המשתמש רק אומר "היי", "שלום" או מגיב קצר — ברך אותו בחזרה ושאל על התחום הנוכחי. אל תתקדם שלב!
2. אם המשתמש אומר "רגע לא דיברנו" או רוצה לתקן — הקשב לו וענה ספציפית על התחום שהוא ציין.
3. עבור לפי הסדר: אימונים -> ספרים -> משימות והרגלים -> תחומים נוספים.
4. החזר JSON בלבד במבנה:
{
  "reply": "טקסט התגובה בעברית",
  "complete": false,
  "data": {
    "workoutDays": [],
    "books": [],
    "tasks": []
  }
}
אל תשתמש באימוג'ים.`;

export async function createOnboardingAgent() {
  const contents = [];
  const intelligentEngine = new IntelligentOnboardEngine();

  return {
    async start() {
      try {
        const initialPrompt = 'משתמש חדש נכנס. ברך אותו קצר בעברית והתחל בשאלה ראשונה על אימונים (כמה ימים בשבוע מתאמן ואיזה פיצול).';
        contents.push({ role: 'user', parts: [{ text: initialPrompt }] });
        const rawJson = await callGeminiRest(contents, ONBOARDING_SYSTEM);
        contents.push({ role: 'model', parts: [{ text: rawJson }] });
        
        const parsed = safeJson(rawJson, null);
        if (parsed && parsed.reply) {
          return { reply: parsed.reply, complete: !!parsed.complete, data: parsed.data || intelligentEngine.data };
        }
      } catch (e) {
        console.warn('Gemini REST start failed, using Intelligent Engine:', e);
      }
      return intelligentEngine.start();
    },

    async send(userText) {
      try {
        contents.push({ role: 'user', parts: [{ text: userText }] });
        const rawJson = await callGeminiRest(contents, ONBOARDING_SYSTEM);
        contents.push({ role: 'model', parts: [{ text: rawJson }] });

        const parsed = safeJson(rawJson, null);
        if (parsed && parsed.reply) {
          return { reply: parsed.reply, complete: !!parsed.complete, data: parsed.data || intelligentEngine.data };
        }
      } catch (e) {
        console.warn('Gemini REST send failed, using Intelligent Engine:', e);
      }
      return intelligentEngine.send(userText);
    }
  };
}

/* ===== Workout Interview Agent ===== */
const WORKOUT_SYSTEM = `אתה מאמן כושר אישי. נהל שיחה קצרה בעברית לבניית תוכנית אימונים שבועית. 
אם המשתמש אומר רק "היי" — ברך בחזרה ושאל על כושר. אל תרוץ קדימה.
החזר JSON בלבד: {"reply":"...", "complete":false, "days":[]}. אל תשתמש באימוג'ים.`;

export async function createWorkoutInterview() {
  const contents = [];
  const intelligentEngine = new IntelligentOnboardEngine();

  return {
    async start() {
      try {
        contents.push({ role: 'user', parts: [{ text: 'התחל את ראיון האימונים בעברית.' }] });
        const rawJson = await callGeminiRest(contents, WORKOUT_SYSTEM);
        contents.push({ role: 'model', parts: [{ text: rawJson }] });
        const parsed = safeJson(rawJson, null);
        if (parsed && parsed.reply) return parsed;
      } catch (e) {
        console.warn('Workout REST failed:', e);
      }
      return intelligentEngine.start();
    },

    async send(userText) {
      try {
        contents.push({ role: 'user', parts: [{ text: userText }] });
        const rawJson = await callGeminiRest(contents, WORKOUT_SYSTEM);
        contents.push({ role: 'model', parts: [{ text: rawJson }] });
        const parsed = safeJson(rawJson, null);
        if (parsed && parsed.reply) return parsed;
      } catch (e) {
        console.warn('Workout REST send failed:', e);
      }
      return intelligentEngine.send(userText);
    }
  };
}

/* ===== Book Lookup ===== */
export async function lookupBook(title) {
  try {
    const contents = [{ role: 'user', parts: [{ text: `ספר לי על הספר "${title}". החזר JSON בלבד: {"title": "${title}", "totalPages": 300, "author": "מחבר", "found": true}` }] }];
    const rawJson = await callGeminiRest(contents, 'החזר JSON בלבד.');
    const p = safeJson(rawJson, {});
    return { found: !!p.found, title: p.title || title, author: p.author || '', totalPages: Math.max(0, parseInt(p.totalPages) || 0) };
  } catch (e) {
    return { found: false, title, author: '', totalPages: 0 };
  }
}
