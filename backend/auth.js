/**
 * auth.js — JWT token creation & validation middleware
 */
const jwt = require('jsonwebtoken');
require('dotenv').config();

const SECRET     = process.env.JWT_SECRET    || 'default_insecure_secret_change_me';
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * Creates a signed JWT for a given user object.
 * @param {{ id: number, email: string }} user
 * @returns {string} signed JWT token
 */
function createToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email },
    SECRET,
    { expiresIn: EXPIRES_IN }
  );
}

/**
 * Express middleware: validates Bearer token in Authorization header.
 * Attaches decoded payload to req.user on success.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: no token provided' });
  }

  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
    return res.status(401).json({ error: `Unauthorized: ${msg}` });
  }
}

/**
 * Optional auth: same as requireAuth but doesn't fail — attaches user if valid.
 */
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try { req.user = jwt.verify(token, SECRET); } catch (_) { /* ignore */ }
  }
  next();
}

module.exports = { createToken, requireAuth, optionalAuth };
