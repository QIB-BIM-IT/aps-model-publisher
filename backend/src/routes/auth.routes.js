// src/routes/auth.routes.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const logger = require('../config/logger');
const { apsConfig } = require('../config/aps.config');
const apsAuthService = require('../services/apsAuth.service');
const { User } = require('../models');

function b64url(str){ return Buffer.from(str).toString('base64url'); }
function ub64url(str){ try { return Buffer.from(str, 'base64url').toString('utf8'); } catch { return null; } }
function jparse(s){ try{ return JSON.parse(s); } catch { return null; } }

function finalizeAuthResponse(req, res, token, user) {
  let redirect = null;
  if (req.query.state) {
    const raw = ub64url(req.query.state);
    const obj = jparse(raw);
    if (obj?.redirect) redirect = obj.redirect;
  }
  if (!redirect && req.query.redirect) redirect = req.query.redirect;
  if (!redirect) redirect = 'http://localhost:3001/callback';

  try {
    const url = new URL(redirect);
    url.searchParams.set('token', token);
    return res.redirect(url.toString());
  } catch (e) {
    logger.warn(`Redirect invalide, JSON fallback. ${e.message}`);
    return res.json({ success: true, message: 'Authentification réussie', token, user });
  }
}

/**
 * GET /api/auth/login
 * Query supportées:
 *  - redirect=<front-callback>
 *  - force=login (force l’écran de login Autodesk)
 */
router.get('/login', async (req, res) => {
  try {
    const redirectParam = req.query.redirect || 'http://localhost:3001/callback';
    const forceLogin = String(req.query.force || '').toLowerCase() === 'login';
    const state = b64url(JSON.stringify({ redirect: redirectParam }));

    const extraParams = forceLogin ? { prompt: 'login', max_age: 0 } : {};
    const authorizeUrl = apsConfig.buildAuthorizeUrl({
      redirectUri: apsConfig.credentials.callback_url,
      scopes: apsConfig.credentials.scopes,
      state,
      extraParams,
    });
    return res.redirect(authorizeUrl);
  } catch (err) {
    logger.error('Erreur /login:', err);
    return res.status(500).json({ success: false, message: err.message || 'Erreur login' });
  }
});

router.get('/callback', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) return res.status(400).json({ success: false, message: 'Code OAuth manquant' });

    const tokens = await apsAuthService.exchangeCodeForTokens(code, {
      redirectUri: apsConfig.credentials.callback_url,
      scopes: apsConfig.credentials.scopes,
    });

    const profile = await apsAuthService.getUserProfile(tokens.access_token);
    const user = await apsAuthService.createOrUpdateUser(profile, tokens);

    const payload = {
      id: user.id,
      email: user.email,
      name: user.name,
      autodeskId: user.autodeskId,
      permissions: user.permissions || ['read'],
    };
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRE || '7d',
    });

    return finalizeAuthResponse(req, res, token, {
      id: user.id,
      email: user.email,
      name: user.name,
      autodeskId: user.autodeskId,
      permissions: user.permissions,
      preferences: user.preferences,
      lastLogin: user.lastLogin,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  } catch (err) {
    logger.error('Erreur callback OAuth:', err);
    return res.status(500).json({ success: false, message: err.message || 'Erreur callback' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const auth = req.headers.authorization || '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    const token = m ? m[1] : null;
    if (!token) return res.status(401).json({ success: false, message: 'Non authentifié' });

    let payload = null;
    try { payload = jwt.verify(token, process.env.JWT_SECRET); } catch { payload = null; }
    if (!payload?.id) return res.status(401).json({ success: false, message: 'Non authentifié' });

    const user = await User.findByPk(payload.id);
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });

    return res.json({
      success: true,
      user: {
        id: user.id, email: user.email, name: user.name,
        autodeskId: user.autodeskId, permissions: user.permissions,
        preferences: user.preferences, lastLogin: user.lastLogin,
        isActive: user.isActive, createdAt: user.createdAt, updatedAt: user.updatedAt,
      },
    });
  } catch (err) {
    logger.error('Erreur /me:', err);
    return res.status(500).json({ success: false, message: err.message || 'Erreur me' });
  }
});

router.post('/logout', (req, res) => {
  try {
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message || 'Erreur logout' });
  }
});

module.exports = router;
