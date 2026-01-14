// backend/src/routes/admin.routes.js
// Routes d'administration pour le diagnostic

const express = require('express');
const router = express.Router();
const { User } = require('../models');
const logger = require('../config/logger');

/**
 * GET /api/admin/token-status
 * Retourne le statut des tokens de tous les utilisateurs
 * ⚠️ ENDPOINT DE DIAGNOSTIC - À SUPPRIMER EN PRODUCTION
 */
router.get('/token-status', async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: ['id', 'name', 'email', 'refreshToken', 'tokenExpiresAt', 'lastLogin', 'createdAt'],
      order: [['lastLogin', 'DESC']],
    });

    const now = new Date();
    const results = users.map(user => {
      const hasRefreshToken = !!user.refreshToken;
      const tokenExpiresAt = user.tokenExpiresAt ? new Date(user.tokenExpiresAt) : null;
      const isTokenExpired = tokenExpiresAt ? now >= tokenExpiresAt : true;
      const tokenExpiresIn = tokenExpiresAt ? Math.round((tokenExpiresAt - now) / 1000 / 60) : null;

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt,
        tokenStatus: {
          hasRefreshToken: hasRefreshToken ? '✅ OK' : '❌ MANQUANT',
          refreshTokenLength: user.refreshToken ? user.refreshToken.length : 0,
          tokenExpiresAt: tokenExpiresAt?.toISOString() || 'N/A',
          isTokenExpired: isTokenExpired ? '⚠️ EXPIRÉ' : '✅ VALIDE',
          tokenExpiresInMinutes: tokenExpiresIn,
        },
        diagnostic: !hasRefreshToken 
          ? '🔴 L\'utilisateur doit se reconnecter avec le scope offline_access'
          : isTokenExpired 
            ? '🟡 Access token expiré mais refresh_token présent - devrait se rafraîchir'
            : '🟢 Tout est OK',
      };
    });

    // Log pour les logs Azure
    logger.info(`[Admin] Token status check - ${users.length} utilisateurs`);
    results.forEach(r => {
      logger.info(`[Admin] User ${r.email}: refreshToken=${r.tokenStatus.hasRefreshToken}, expired=${r.tokenStatus.isTokenExpired}`);
    });

    res.json({
      success: true,
      timestamp: now.toISOString(),
      totalUsers: users.length,
      summary: {
        withRefreshToken: results.filter(r => r.tokenStatus.hasRefreshToken === '✅ OK').length,
        withoutRefreshToken: results.filter(r => r.tokenStatus.hasRefreshToken === '❌ MANQUANT').length,
        expiredTokens: results.filter(r => r.tokenStatus.isTokenExpired === '⚠️ EXPIRÉ').length,
      },
      users: results,
    });
  } catch (error) {
    logger.error(`[Admin] Erreur token-status: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
