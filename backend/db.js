/**
 * db.js — SQLite persistence layer via sql.js
 * Stores: users, quick_logs (Siri shortcut entries), sessions
 */
const path   = require('path');
const fs     = require('fs');
const initSqlJs = require('sql.js');

require('dotenv').config();

const DB_PATH = process.env.SQLITE_DB_PATH || './data/database.sqlite';

let _db   = null;  // sql.js Database instance
let _SQL  = null;  // sql.js module

/** Load (or create) the SQLite file and return the db instance. */
async function getDb() {
  if (_db) return _db;

  _SQL = await initSqlJs();
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    _db = new _SQL.Database(fileBuffer);
  } else {
    _db = new _SQL.Database();
  }

  _initSchema();
  return _db;
}

function _persist() {
  const data = _db.export();
  const buf  = Buffer.from(data);
  const dir  = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_PATH, buf);
}

function _initSchema() {
  _db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      email      TEXT UNIQUE NOT NULL,
      password   TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
  `);
  _db.run(`
    CREATE TABLE IF NOT EXISTS quick_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id    TEXT NOT NULL,
      user_id    INTEGER,
      content    TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
  `);
  _persist();
}

// ─── Users ───────────────────────────────────────────────────────────────────
function createUser(email, hashedPassword) {
  _db.run('INSERT INTO users (email, password) VALUES (?, ?)', [email, hashedPassword]);
  _persist();
  return getUserByEmail(email);
}

function getUserByEmail(email) {
  const stmt = _db.prepare('SELECT * FROM users WHERE email = ?');
  stmt.bind([email]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function getUserById(id) {
  const stmt = _db.prepare('SELECT id, email, created_at FROM users WHERE id = ?');
  stmt.bind([id]);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

// ─── Quick Logs (Siri / Shortcuts) ───────────────────────────────────────────
function addQuickLog(roomId, content, userId = null) {
  _db.run(
    'INSERT INTO quick_logs (room_id, content, user_id) VALUES (?, ?, ?)',
    [roomId, content, userId]
  );
  _persist();
}

function getQuickLogs(roomId, limit = 50) {
  const stmt = _db.prepare(
    'SELECT * FROM quick_logs WHERE room_id = ? ORDER BY created_at DESC LIMIT ?'
  );
  stmt.bind([roomId, limit]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

module.exports = { getDb, createUser, getUserByEmail, getUserById, addQuickLog, getQuickLogs };
