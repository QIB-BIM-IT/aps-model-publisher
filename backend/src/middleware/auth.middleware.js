// src/middleware/auth.middleware.js
const jwt = require('jsonwebtoken');
const logger = require('../config/logger');
const { User } = require('../models');

/**
 * Extrait un JWT depuis plusieurs emplacements possibles :
 * - Authorization: Bearer <token>
 * - cookie: jwt_token / token
 * - query: ?token=<token>  (fallback)
 */
function extractToken(req) {
  const auth = req.headers.authorization || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m && m[1]) return m[1];

  if (req.cookies) {
    if (req.cookies.jwt_token) return req.cookies.jwt_token;
    if (req.cookies.token) return req.cookies.token;
  }

  if (req.query && req.query.token) return req.query.token;

  return null;
}

/**
 * Middleware strict : exige un JWT valide
 */
async function authenticateToken(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return res.status(401).json({ success: false, message: 'Non authentifié (token manquant)' });

    let payload = null;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
      return res.status(401).json({ success: false, message: 'Non authentifié (token invalide/expiré)' });
    }

    const user = await User.findByPk(payload.id);
    if (!user) return res.status(401).json({ success: false, message: 'Utilisateur introuvable' });

    // Attache au request
    req.token = token;
    req.userId = user.id;
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      autodeskId: user.autodeskId,
      permissions: user.permissions || ['read'],
    };

    return next();
  } catch (err) {
    logger.error(`authenticateToken error: ${err.message}`);
    return res.status(500).json({ success: false, message: 'Erreur authentification' });
  }
}

/**
 * Middleware souple : n’échoue pas si pas de JWT,
 * mais remplit req.user/req.userId si présent.
 */
async function optionalAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return next();

    let payload = null;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
      return next(); // ignore les erreurs; route accessible anonymement
    }

    const user = await User.findByPk(payload.id);
    if (!user) return next();

    req.token = token;
    req.userId = user.id;
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      autodeskId: user.autodeskId,
      permissions: user.permissions || ['read'],
    };

    return next();
  } catch (err) {
    logger.error(`optionalAuth error: ${err.message}`);
    return next();
  }
}

module.exports = {
  authenticateToken,
  optionalAuth,
};
