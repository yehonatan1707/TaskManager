/**
 * ai.js — Gemini-powered features via Firebase AI Logic (free Gemini Developer API)
 * SETUP: Firebase Console → Build → AI Logic → Get started → "Gemini Developer API"
 */

import { getFirebaseApp, FB_VER } from './firebase.js';

const MODEL_NAME = 'gemini-2.5-flash';

let _aiMod = null;
let _aiInstance = null;

async function getAICore() {
  if (_aiInstance && _aiMod) return { mod: _aiMod, ai: _aiInstance };
  const app = await getFirebaseApp();
  _aiMod = await import(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-ai.js`);
  _aiInstance = _aiMod.getAI(app, { backend: new _aiMod.GoogleAIBackend() });
  return { mod: _aiMod, ai: _aiInstance };
}

function safeJson(raw, fallback) {
  try { return JSON.parse(raw); }
  catch {
    const m = raw && raw.match(/\{[\s\S]*\}/);
    try { return m ? JSON.parse(m[0]) : fallback; } catch { return fallback; }
  }
}

/* ===== Workout builder — guided interview ===== */

const WORKOUT_SYSTEM = `אתה מאמן כושר אישי שמנהל ראיון קצר וידידותי בעברית כדי לבנות תוכנית אימונים שבועית מותאמת אישית.

חוקים:
- שאל שאלה אחת בכל פעם. שאלות קצרות, ברורות וישירות.
- התחל בשאלה האם המשתמש מתאמן בכלל.
- אסוף בהדרגה: כמה ימים בשבוע, סוג הפיצול (למשל פוש/פול/רגליים, אזורי גוף, מלא), אילו תרגילים בכל יום, כמה סטים וחזרות, ומשקלים אם ידועים, וגם ציוד זמין (חדר כושר / בית / משקל גוף).
- זהה פערים באופן יזום: אם המשתמש שכח קבוצת שרירים חשובה (בטן, רגליים, גב) או לא ציין סטים/חזרות — שאל על כך.
- אל תבקש "ספר לי על השגרה שלך". תמיד שאל שאלה ספציפית וממוקדת.
- כל עוד אין לך מספיק מידע למלא תוכנית שבועית: החזר complete=false, days=[], ובשדה reply את השאלה הבאה בעברית.
- כשיש מספיק מידע: החזר complete=true עם days מלא (0=ראשון ... 6=שבת). לימי מנוחה קבע isRest=true ו-exercises ריק. ב-reply כתוב סיכום קצר וחגיגי בעברית.
- לכל תרגיל ספק: name (אפשר באנגלית כמו Bench Press), sets (מספר), reps (מחרוזת כמו "12" או "Failure"), weight (מחרוזת כמו "60kg" או "" אם משקל גוף).
- icon: השאר מחרוזת ריקה "".
- label לכל יום: שם קצר בעברית (למשל "חזה", "גב", "רגליים", "מנוחה").
- אל תשתמש באימוג'ים בתשובות שלך.`;

let _workoutModel = null;

async function getWorkoutModel() {
  if (_workoutModel) return _workoutModel;
  const { mod, ai } = await getAICore();
  const { getGenerativeModel, Schema } = mod;

  const schema = Schema.object({
    properties: {
      reply: Schema.string(),
      complete: Schema.boolean(),
      days: Schema.array({
        items: Schema.object({
          properties: {
            dayIndex: Schema.integer(),
            label: Schema.string(),
            icon: Schema.string(),
            isRest: Schema.boolean(),
            exercises: Schema.array({
              items: Schema.object({
                properties: {
                  name: Schema.string(),
                  sets: Schema.integer(),
                  reps: Schema.string(),
                  weight: Schema.string(),
                },
              }),
            }),
          },
        }),
      }),
    },
  });

  _workoutModel = getGenerativeModel(ai, {
    model: MODEL_NAME,
    systemInstruction: WORKOUT_SYSTEM,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature: 0.6,
    },
  });
  return _workoutModel;
}

export async function createWorkoutInterview() {
  const model = await getWorkoutModel();
  const chat = model.startChat({ history: [] });

  async function sendRaw(text) {
    const result = await chat.sendMessage(text);
    const parsed = safeJson(result.response.text(), { reply: '', complete: false, days: [] });
    return {
      reply: parsed.reply || '',
      complete: !!parsed.complete,
      days: Array.isArray(parsed.days) ? parsed.days : [],
    };
  }

  return {
    start() { return sendRaw('המשתמש פתח את אשף בניית האימונים. שאל את השאלה הראשונה.'); },
    send(userText) { return sendRaw(userText); },
  };
}

/* ===== Book lookup ===== */

let _bookModel = null;

async function getBookModel() {
  if (_bookModel) return _bookModel;
  const { mod, ai } = await getAICore();
  const { getGenerativeModel, Schema } = mod;

  const schema = Schema.object({
    properties: {
      found: Schema.boolean(),
      title: Schema.string(),
      author: Schema.string(),
      totalPages: Schema.integer(),
    },
  });

  _bookModel = getGenerativeModel(ai, {
    model: MODEL_NAME,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature: 0.2,
    },
  });
  return _bookModel;
}

export async function lookupBook(title) {
  const model = await getBookModel();
  const prompt = `ספר לי על הספר "${title}". החזר: totalPages = מספר העמודים המשוער במהדורה הנפוצה, author = שם המחבר, found = האם זיהית את הספר בוודאות. אם אינך בטוח, תן הערכה סבירה ו-found=false.`;
  const result = await model.generateContent(prompt);
  const p = safeJson(result.response.text(), {});
  return {
    found: !!p.found,
    title: p.title || title,
    author: p.author || '',
    totalPages: Math.max(0, parseInt(p.totalPages) || 0),
  };
}

/* ===== Onboarding agent — agent-led, multi-domain interview ===== */

const ONBOARDING_SYSTEM = `אתה סוכן קליטה (onboarding) של אפליקציית "מרכז שליטה אישי". אתה מוביל את השיחה בעברית ופונה למשתמש — לא הוא אליך.

איך לנהל את הריאיון:
- שאל שאלה אחת בכל פעם. קצרה, ידידותית וממוקדת. פתח בברכה קצרה ובשאלה הראשונה.
- עבור לפי הסדר על התחומים:
  1) אימונים: האם מתאמן? כמה ימים בשבוע? איזה פיצול? אילו תרגילים בכל יום? סטים/חזרות/משקלים? ציוד?
  2) ספרים: האם קורא ספר עכשיו? שם הספר, מספר עמודים, ובאיזה עמוד הוא נמצא.
  3) משימות והרגלים: אילו משימות/הרגלים יומיים ושבועיים יש לו (למשל "לשתות 3 ליטר מים", "לקום ב-6").
  4) בסוף שאל במפורש: "יש עוד תחום בחיים שתרצה לתעד?" (למשל מדיטציה, לימודים, כסף). אם כן — הפוך אותו למשימות/הרגלים מתאימים בשדה tasks.
- זהה פערים ושאל שאלות המשך על מה שהמשתמש שכח. אם המשתמש לא מתאמן/לא קורא — דלג יפה על התחום.
- אל תבקש "ספר לי על עצמך". תמיד שאלה ספציפית אחת.

פורמט התשובה:
- כל עוד לא אספת מספיק: complete=false, data עם מערכים ריקים, ובשדה reply את השאלה הבאה בעברית.
- כשסיימת את כל התחומים: complete=true, מלא את data, וב-reply כתוב סיכום קצר וחגיגי.

מבנה data:
- workoutDays: לוח 7 ימים (dayIndex 0=ראשון ... 6=שבת). לימי מנוחה isRest=true ו-exercises ריק. לכל תרגיל: name, sets (מספר), reps (מחרוזת), weight (מחרוזת, "" אם משקל גוף). icon="" (השאר ריק), label=שם קצר בעברית.
- books: לכל ספר title, totalPages (מספר), currentPage (מספר, 0 אם בהתחלה).
- tasks: לכל משימה/הרגל text (בעברית) ו-category ("daily" או "weekly"). תחומים מותאמים אישית הופכים גם הם ל-tasks.
- אל תשתמש באימוג'ים בתשובות שלך.`;

let _onboardModel = null;

async function getOnboardModel() {
  if (_onboardModel) return _onboardModel;
  const { mod, ai } = await getAICore();
  const { getGenerativeModel, Schema } = mod;

  const exerciseSchema = Schema.object({
    properties: {
      name: Schema.string(),
      sets: Schema.integer(),
      reps: Schema.string(),
      weight: Schema.string(),
    },
  });

  const schema = Schema.object({
    properties: {
      reply: Schema.string(),
      complete: Schema.boolean(),
      data: Schema.object({
        properties: {
          workoutDays: Schema.array({
            items: Schema.object({
              properties: {
                dayIndex: Schema.integer(),
                label: Schema.string(),
                icon: Schema.string(),
                isRest: Schema.boolean(),
                exercises: Schema.array({ items: exerciseSchema }),
              },
            }),
          }),
          books: Schema.array({
            items: Schema.object({
              properties: {
                title: Schema.string(),
                totalPages: Schema.integer(),
                currentPage: Schema.integer(),
              },
            }),
          }),
          tasks: Schema.array({
            items: Schema.object({
              properties: {
                text: Schema.string(),
                category: Schema.string(),
              },
            }),
          }),
        },
      }),
    },
  });

  _onboardModel = getGenerativeModel(ai, {
    model: MODEL_NAME,
    systemInstruction: ONBOARDING_SYSTEM,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature: 0.6,
    },
  });
  return _onboardModel;
}

export async function createOnboardingAgent() {
  const model = await getOnboardModel();
  const chat = model.startChat({ history: [] });

  async function sendRaw(text) {
    const result = await chat.sendMessage(text);
    const parsed = safeJson(result.response.text(), { reply: '', complete: false, data: {} });
    const data = parsed.data || {};
    return {
      reply: parsed.reply || '',
      complete: !!parsed.complete,
      data: {
        workoutDays: Array.isArray(data.workoutDays) ? data.workoutDays : [],
        books: Array.isArray(data.books) ? data.books : [],
        tasks: Array.isArray(data.tasks) ? data.tasks : [],
      },
    };
  }

  return {
    start() { return sendRaw('משתמש חדש נכנס לראשונה. ברך אותו קצר והתחל את הריאיון בשאלה הראשונה על אימונים.'); },
    send(userText) { return sendRaw(userText); },
  };
}
