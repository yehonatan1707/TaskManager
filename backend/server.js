/**
 * server.js — Personal Command Center Backend
 * Express 4 • helmet • cors • SQLite via db.js • JWT via auth.js
 * Routes:
 *   POST   /api/auth/register
 *   POST   /api/auth/login
 *   GET    /api/auth/me
 *   POST   /api/rooms/:roomId/quick   (Siri / Shortcuts quick-add)
 *   GET    /api/rooms/:roomId/quick
 *   GET    /health
 */
require('dotenv').config();

const path    = require('path');
const express = require('express');
const helmet  = require('helmet');
const cors    = require('cors');
const bcrypt  = require('bcryptjs');

const { getDb, createUser, getUserByEmail, getUserById, addQuickLog, getQuickLogs } = require('./db');
const { createToken, requireAuth, optionalAuth } = require('./auth');

const app  = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// ─── Security & Parsing ───────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", "https://www.gstatic.com", "https://apis.google.com"],
      styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com"],
      imgSrc:     ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://*.googleapis.com", "https://*.firebaseio.com"],
    }
  }
}));

const allowedOrigins = [
  process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5500',  // Live Server
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) cb(null, true);
    else cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

// ─── Static: serve frontend from ../frontend ──────────────────────────────────
const FRONTEND = path.join(__dirname, '..', 'frontend');
app.use(express.static(FRONTEND));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ─── Auth Routes ──────────────────────────────────────────────────────────────

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)      return res.status(400).json({ error: 'email and password required' });
    if (password.length < 6)     return res.status(400).json({ error: 'password must be >= 6 chars' });
    if (getUserByEmail(email))   return res.status(409).json({ error: 'email already registered' });

    const hashed = await bcrypt.hash(password, 12);
    const user   = createUser(email, hashed);
    const token  = createToken(user);
    res.status(201).json({ token, user: { id: user.id, email: user.email } });
  } catch (e) {
    console.error('register error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });

    const user = getUserByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = createToken(user);
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (e) {
    console.error('login error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// ─── Siri / Shortcuts Quick-Add ───────────────────────────────────────────────

// POST /api/rooms/:roomId/quick
// Body: { content: "string", token?: "jwt" }
// Designed for simple Siri Shortcut calls (no need for login cookie dance)
app.post('/api/rooms/:roomId/quick', optionalAuth, (req, res) => {
  try {
    const { roomId }  = req.params;
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'content is required' });

    const userId = req.user?.id || null;
    addQuickLog(roomId, content.trim(), userId);
    res.status(201).json({ ok: true, roomId, content: content.trim() });
  } catch (e) {
    console.error('quick-add error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/rooms/:roomId/quick
app.get('/api/rooms/:roomId/quick', requireAuth, (req, res) => {
  try {
    const { roomId } = req.params;
    const limit  = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const logs   = getQuickLogs(roomId, limit);
    res.json({ logs });
  } catch (e) {
    console.error('quick-get error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── SPA Fallback ────────────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(FRONTEND, 'index.html'));
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Startup ──────────────────────────────────────────────────────────────────
async function start() {
  await getDb();  // ensures SQLite is ready before accepting requests
  app.listen(PORT, () => {
    console.log(`\n🚀 Personal Command Center backend`);
    console.log(`   http://localhost:${PORT}`);
    console.log(`   Frontend: ${FRONTEND}`);
    console.log(`   Mode: ${process.env.NODE_ENV || 'development'}\n`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
