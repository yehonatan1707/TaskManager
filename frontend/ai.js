/**
 * ai.js — Firebase / Gemini AI Integrations
 * Workouts Builder & Multi-Domain Onboarding Agent
 */

const MODEL_NAME = 'gemini-1.5-flash';
const API_KEY    = 'AIzaSyBaJ2VOB4Ne-4ZVLPQDvvfLvMkwWuPqATU';

let _aiCore = null;

async function getAICore() {
  if (_aiCore) return _aiCore;
  const mod = await import('https://esm.sh/@google/generative-ai');
  const { GoogleGenerativeAI } = mod;
  const ai = new GoogleGenerativeAI(API_KEY);
  _aiCore = { mod, ai };
  return _aiCore;
}

function safeJson(str, fallback) {
  try {
    const clean = str.replace(/```json\n?|\n?```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return fallback;
  }
}

/* ===== Workout builder agent ===== */
const WORKOUT_SYSTEM = `אתה מאמן כושר מומחה באפליקציית "קומנד סנטר". תפקידך לבנות תוכנית אימונים שבועית מותאמת אישית.
נהל שיחה קצרה בעברית. שאל על מטרות, ימים בשבוע, ניסיון וציוד.
בכל תשובה החזר JSON:
{
  "reply": "טקסט התגובה בעברית",
  "complete": true/false,
  "days": [
    {
      "dayIndex": 0..6,
      "label": "שם האימון",
      "icon": "אימוג'י",
      "isRest": false,
      "exercises": [ { "name": "שם", "sets": 3, "reps": "10-12", "weight": "20kg" } ]
    }
  ]
}`;

export async function createWorkoutInterview() {
  const { mod, ai } = await getAICore();
  const { Schema } = mod;

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
      days: Schema.array({
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
    },
  });

  const model = ai.getGenerativeModel({
    model: MODEL_NAME,
    systemInstruction: WORKOUT_SYSTEM,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature: 0.6,
    },
  });

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
    start() { return sendRaw('התחל את השיחה בברכה קצרה ובשאלה ראשונה על כושר.'); },
    send(userText) { return sendRaw(userText); },
  };
}

/* ===== Book auto-lookup ===== */
export async function lookupBook(title) {
  try {
    const { ai } = await getAICore();
    const model = ai.getGenerativeModel({ model: MODEL_NAME });
    const prompt = `חפש מידע על הספר "${title}". החזר JSON בלבד: {"title": "שם מבוקש", "totalPages": 300, "author": "שם מחבר"}`;
    const res = await model.generateContent(prompt);
    return safeJson(res.response.text(), null);
  } catch (e) {
    console.warn('Book lookup failed:', e);
    return null;
  }
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
- workoutDays: לוח 7 ימים (dayIndex 0=ראשון ... 6=שבת). לימי מנוחה isRest=true ו-exercises ריק. לכל תרגיל: name, sets (מספר), reps (מחרוזת), weight (מחרוזת, "" אם משקל גוף). icon=אימוג'י, label=שם קצר בעברית.
- books: לכל ספר title, totalPages (מספר), currentPage (מספר, 0 אם בהתחלה).
- tasks: לכל משימה/הרגל text (בעברית) ו-category ("daily" או "weekly"). תחומים מותאמים אישית הופכים גם הם ל-tasks.`;

let _onboardModel = null;

async function getOnboardModel() {
  if (_onboardModel) return _onboardModel;
  const { mod, ai } = await getAICore();
  const { Schema } = mod;

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

  _onboardModel = ai.getGenerativeModel({
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
