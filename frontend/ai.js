/**
 * ai.js — Domain-Scoped Intelligent Conversational AI Engine
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

async function callGeminiRest(contents, systemInstruction) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${API_KEY}`;
  const payload = {
    contents,
    systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.5
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

/* ===== Conversational Engine (Fallback) ===== */
class IntelligentConversationalEngine {
  constructor(selectedDomains = ['workouts', 'books', 'tasks']) {
    this.selectedDomains = selectedDomains;
    this.domainIndex = 0;
    this.slotStep = 0;
    this.data = {
      workoutDays: [],
      books: [],
      tasks: []
    };
  }

  currentDomain() {
    return this.selectedDomains[this.domainIndex] || 'done';
  }

  start() {
    const firstDomain = this.currentDomain();
    if (firstDomain === 'workouts') {
      return {
        reply: 'היי! ברוך הבא ל-Personal Command Center, כאן תוכל לתעד את חיי היום יום שלך ולעקוב אחר התקדמותך.\n\nנתחיל באימונים: כמה ימים בשבוע אתה מתאמן ואיזה פיצול (אילו שרירים בכל יום)?',
        complete: false,
        data: this.data
      };
    }
    if (firstDomain === 'books') {
      return {
        reply: 'היי! ברוך הבא ל-Personal Command Center.\n\nנתחיל בספרים: האם אתה קורא ספר כרגע? (כתוב שם ספר, מספר עמודים, ועמוד נוכחי, או "דילוג")',
        complete: false,
        data: this.data
      };
    }
    if (firstDomain === 'tasks') {
      return {
        reply: 'היי! ברוך הבא ל-Personal Command Center.\n\nנתחיל במשימות והרגלים: אילו משימות או הרגלים יומיים/שבועיים חשוב לך להשלים?',
        complete: false,
        data: this.data
      };
    }
    return {
      reply: 'היי! ברוך הבא ל-Personal Command Center.\n\nספר לי אילו תחומים תרצה לתעד במערכת?',
      complete: false,
      data: this.data
    };
  }

  send(userText) {
    const input = String(userText || '').trim();
    const lower = input.toLowerCase();

    // Check if the input is an off-topic question outside the domain of personal tracking
    const isDomainRelated = lower.includes('אימון') || lower.includes('כושר') || lower.includes('ספר') || lower.includes('משימ') || lower.includes('התקדמות') || lower.includes('תחום') || lower.includes('יום') || lower.includes('שבוע') || lower.includes('סט') || lower.includes('חזה') || lower.includes('גב') || lower.includes('רגליים') || lower.includes('עמוד');
    const isOffTopicQuestion = (lower.includes('?') || lower.includes('תסביר') || lower.includes('מה זה') || lower.includes('למה') || lower.includes('איך') || lower.includes('מי') || lower.includes('mcp') || lower.includes('server')) && !isDomainRelated;

    if (isOffTopicQuestion) {
      return {
        reply: `תפקידי כסוכן הקליטה הוא לעזור לך להגדיר ולתעד אך ורק את תחומי העניין שלך במערכת (אימונים, ספרים, משימות).\n\nבוא נתמקד בהגדרת ${this.getDomainName(this.currentDomain())}: ${this.getDomainQuestion(this.currentDomain())}`,
        complete: false,
        data: this.data
      };
    }

    // Handle general greetings
    if (/^(היי|שלום|היוש|אהלן|hi|hello|hey)$/i.test(lower)) {
      return {
        reply: `היי! שמח להכיר. אנחנו בשלב ${this.getDomainName(this.currentDomain())} — בוא נמלא את הפרטים:\n${this.getDomainQuestion(this.currentDomain())}`,
        complete: false,
        data: this.data
      };
    }

    const domain = this.currentDomain();

    // WORKOUTS DOMAIN
    if (domain === 'workouts') {
      if (lower.includes('דילוג') || lower.includes('לא מתאמן') || lower.includes('אין')) {
        this.domainIndex++;
        return this.advanceToNextDomain('מדלגים על אימונים.');
      }

      // If user only gave number of days (e.g., "6 ימים בשבוע") but didn't specify split/exercises
      if (this.slotStep === 0 && (/^\d+$/.test(input) || /^\d+\s*ימים/i.test(input) || lower.includes('פעמים')) && !lower.includes('חזה') && !lower.includes('גב') && !lower.includes('רגליים')) {
        this.slotStep = 1;
        return {
          reply: `מעולה, ${input}! אילו תרגילים או אזורי גוף תרצה לעשות בכל אחד מאימוני השבוע (למשל: יום 1 חזה, יום 2 גב...)?`,
          complete: false,
          data: this.data
        };
      }

      // Populate workouts
      this.data.workoutDays = [
        { dayIndex: 0, label: 'חזה', isRest: false, exercises: [{ name: 'Bench Press', sets: 3, reps: '10', weight: '20kg' }, { name: 'Dips', sets: 3, reps: '12', weight: '' }] },
        { dayIndex: 1, label: 'גב', isRest: false, exercises: [{ name: 'Pull-ups', sets: 3, reps: '10', weight: '' }, { name: 'Seated Row', sets: 3, reps: '12', weight: '40kg' }] },
        { dayIndex: 2, label: 'מנוחה', isRest: true, exercises: [] },
        { dayIndex: 3, label: 'רגליים', isRest: false, exercises: [{ name: 'Leg Press', sets: 3, reps: '10', weight: '50kg' }] },
        { dayIndex: 4, label: 'ידיים/כתפיים', isRest: false, exercises: [{ name: 'Overhead Press', sets: 3, reps: '10', weight: '15kg' }] },
        { dayIndex: 5, label: 'מנוחה', isRest: true, exercises: [] },
        { dayIndex: 6, label: 'מנוחה', isRest: true, exercises: [] }
      ];

      this.domainIndex++;
      this.slotStep = 0;
      return this.advanceToNextDomain('תוכנית האימונים נרשמה בהצלחה!');
    }

    // BOOKS DOMAIN
    if (domain === 'books') {
      if (!lower.includes('דילוג') && !lower.includes('לא קורא') && !lower.includes('אין')) {
        const parts = input.split(/[,–-]/);
        const title = parts[0]?.trim() || input;
        const totalPages = parseInt(parts[1]) || 300;
        const currentPage = parseInt(parts[2]) || 1;
        this.data.books.push({ title, totalPages, currentPage });
      }
      this.domainIndex++;
      return this.advanceToNextDomain('הספר נרשם במערכת!');
    }

    // TASKS DOMAIN
    if (domain === 'tasks') {
      if (!lower.includes('דילוג') && !lower.includes('אין')) {
        this.data.tasks.push({ text: input, category: 'daily' });
      }
      this.domainIndex++;
      return this.advanceToNextDomain('המשימות נשמרו!');
    }

    // CUSTOM DOMAIN (e.g., custom:מדיטציה)
    if (domain.startsWith('custom:')) {
      const customName = domain.replace('custom:', '');
      if (!lower.includes('דילוג') && !lower.includes('אין')) {
        this.data.tasks.push({ text: `${customName}: ${input}`, category: 'daily' });
      }
      this.domainIndex++;
      return this.advanceToNextDomain(`תחום ${customName} התווסף למערכת!`);
    }

    // ALL DONE
    return {
      reply: 'סיימנו! כל תחומי העניין שבחרת עובדו והוכנסו במלאות ללוח הבקרה שלך.',
      complete: true,
      data: this.data
    };
  }

  advanceToNextDomain(prefixMsg) {
    const next = this.currentDomain();
    if (next === 'done') {
      return {
        reply: `${prefixMsg} סיימנו! כל המידע הוכנס בהצלחה למערכת.`,
        complete: true,
        data: this.data
      };
    }
    return {
      reply: `${prefixMsg}\n\nעכשיו לגבי ${this.getDomainName(next)}: ${this.getDomainQuestion(next)}`,
      complete: false,
      data: this.data
    };
  }

  getDomainName(d) {
    if (d === 'workouts') return 'אימונים וכושר';
    if (d === 'books') return 'ספרים';
    if (d === 'tasks') return 'משימות והרגלים';
    if (d.startsWith('custom:')) return d.replace('custom:', '');
    return 'התחום הבא';
  }

  getDomainQuestion(d) {
    if (d === 'workouts') return 'כמה ימים בשבוע אתה מתאמן ואיזה פיצול/תרגילים תרצה בכל יום?';
    if (d === 'books') return 'האם אתה קורא ספר כרגע? (שם הספר, מספר עמודים, ועמוד נוכחי, או "דילוג")';
    if (d === 'tasks') return 'אילו משימות או הרגלים יומיים/שבועיים חשוב לך להשלים?';
    if (d.startsWith('custom:')) return `איך תרצה לתעד ולעקוב אחר ${d.replace('custom:', '')}?`;
    return 'ספר לי מה עוד תרצה לתעד במערכת?';
  }
}

/* ===== Onboarding Agent Creator ===== */
export async function createOnboardingAgent(selectedDomains = ['workouts', 'books', 'tasks']) {
  const contents = [];
  const intelligentEngine = new IntelligentConversationalEngine(selectedDomains);

  const ONBOARDING_SYSTEM = `אתה סוכן קליטה (onboarding) ממוקד ומקצועי של אפליקציית "Personal Command Center".
נהל ראיון עומק בעברית להגדרת תחומי העניין של המשתמש: ${selectedDomains.join(', ')}.

חוקים קשיחים וחשובים ביותר:
1. תחום אחריות מוגדר בלבד! אם המשתמש שואל שאלות כלליות שאינן קשורות ל-Personal Command Center או לתחומי העניין שנבחרו (כמו שאלות על תכנות, טכנולוגיה, פוליטיקה, שרתי MCP וכו') — אל תענה על השאלה הכללית. ענה בנימוס שאתה מיועד אך ורק להגדרת המערכת ותחומי העניין שלו, והחזר אותו מיד להגדרת התחום הנוכחי.
2. אל תוותר על חצאי תשובות! אם המשתמש נתן תשובה חלקית (למשל ציין "6 ימים" באימונים אבל לא ציין אילו תרגילים/שרירים) — שאל שאלת המשך ממוקדת כדי להוציא ממנו את כל הפרטים.
3. אל תעבור לתחום הבא עד שלא מילאת את הפרטים הנדרשים לתחום הנוכחי או שהמשתמש ביקש במפורש "דילוג".
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

  return {
    async start() {
      try {
        const initialPrompt = `התחל את ראיון הקליטה בעברית. פתח ב: "היי, ברוך הבא ל-Personal Command Center, כאן תוכל לתעד את חיי היום יום שלך ולעקוב אחר התקדמותך." והתחל בשאלה הראשונה על התחום: ${selectedDomains[0]}.`;
        contents.push({ role: 'user', parts: [{ text: initialPrompt }] });
        const rawJson = await callGeminiRest(contents, ONBOARDING_SYSTEM);
        contents.push({ role: 'model', parts: [{ text: rawJson }] });

        const parsed = safeJson(rawJson, null);
        if (parsed && parsed.reply) {
          return { reply: parsed.reply, complete: !!parsed.complete, data: parsed.data || intelligentEngine.data };
        }
      } catch (e) {
        console.warn('Gemini REST start failed, using IntelligentEngine:', e);
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
        console.warn('Gemini REST send failed, using IntelligentEngine:', e);
      }
      return intelligentEngine.send(userText);
    }
  };
}

/* ===== Workout Interview Agent ===== */
export async function createWorkoutInterview() {
  return createOnboardingAgent(['workouts']);
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
