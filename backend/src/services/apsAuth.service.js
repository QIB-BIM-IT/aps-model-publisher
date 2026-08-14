// src/services/apsAuth.service.js
const axios = require('axios');
const qs = require('querystring');
const { apsConfig } = require('../config/aps.config');
const logger = require('../config/logger');
const User = require('../models/User');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Buffer avant expiration : refresh 5 minutes AVANT l'expiration réelle
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

class APSAuthService {
  constructor() {
    this.twoLegged = {
      access_token: null,
      expires_at: 0,
      scopes: (process.env.APS_TWO_LEGGED_SCOPES || 'data:read data:write data:create bucket:create bucket:read account:read viewables:read')
        .split(/\s+/)
        .filter(Boolean),
    };
    // Cache SÉPARÉ du 2-legged générique : jeton Viewer = viewables:read uniquement.
    // Ne jamais réutiliser this.twoLegged (scopes larges) ni l'écraser.
    this.viewerToken = {
      access_token: null,
      expires_at: 0,
    };
    // Mutex par userId pour éviter les refresh concurrents
    this._refreshLocks = new Map();
  }

  // ======== 3-LEGGED ========

  async exchangeCodeForTokens(code, { redirectUri, scopes } = {}) {
    const body = {
      grant_type: 'authorization_code',
      client_id: apsConfig.credentials.client_id,
      client_secret: apsConfig.credentials.client_secret,
      code,
      redirect_uri: redirectUri || apsConfig.credentials.callback_url,
      scope: (scopes && scopes.length ? scopes : apsConfig.credentials.scopes).join(' '),
    };
    try {
      const { data } = await axios.post(
        apsConfig.endpoints.TOKEN,
        qs.stringify(body),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      return data; // { token_type, access_token, expires_in, refresh_token, scope }
    } catch (err) {
      const msg = this._extractError(err);
      logger.error(`exchangeCodeForTokens failed: ${msg}`);
      throw new Error(`APS auth exchange failed: ${msg}`);
    }
  }

  async refreshToken(refreshToken) {
    const body = {
      grant_type: 'refresh_token',
      client_id: apsConfig.credentials.client_id,
      client_secret: apsConfig.credentials.client_secret,
      refresh_token: refreshToken,
      scope: apsConfig.credentials.scopes.join(' '),
    };
    try {
      const { data } = await axios.post(
        apsConfig.endpoints.TOKEN,
        qs.stringify(body),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      logger.info(`[APSAuth] Token refreshed - scopes: ${data.scope || 'NONE'}`);
      return data;
    } catch (err) {
      const msg = this._extractError(err);
      logger.error(`refreshToken failed: ${msg}`);
      throw new Error(`APS refresh failed: ${msg}`);
    }
  }

  async getUserProfile(accessToken) {
    try {
      const { data } = await axios.get(apsConfig.endpoints.USERINFO, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return {
        userId: data.sub,
        email: data.email,
        name: data.name || data.preferred_username || 'Autodesk User',
      };
    } catch (err) {
      const msg = this._extractError(err);
      logger.error(`getUserProfile failed: ${msg}`);
      throw new Error(`APS userinfo failed: ${msg}`);
    }
  }

  // ======== Token validation helpers ========

  /**
   * Vérifie si le token est expiré ou sur le point d'expirer (buffer de 5 min)
   */
  _isTokenExpiredOrSoon(user) {
    if (!user.accessToken || !user.tokenExpiresAt) return true;
    // Refresh 5 minutes AVANT l'expiration réelle pour éviter les erreurs en plein appel API
    return new Date() >= new Date(new Date(user.tokenExpiresAt).getTime() - TOKEN_EXPIRY_BUFFER_MS);
  }

  /**
   * Mutex simple par userId : évite que 2 jobs ne refreshent le même token en parallèle
   * (le refresh_token Autodesk est à usage unique — si 2 jobs refresh en même temps, le 2e échoue)
   */
  async _acquireRefreshLock(userId) {
    const maxWait = 30000; // 30 secondes max d'attente
    const start = Date.now();
    while (this._refreshLocks.has(userId)) {
      if (Date.now() - start > maxWait) {
        logger.warn(`[APSAuth] Timeout lock refresh pour userId=${userId.substring(0, 8)}..., forçage`);
        this._refreshLocks.delete(userId);
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    this._refreshLocks.set(userId, Date.now());
  }

  _releaseRefreshLock(userId) {
    this._refreshLocks.delete(userId);
  }

  /**
   * Retourne un access_token Autodesk valide à partir d'un **userId UUID**.
   * Si on lui passe directement un **access_token** (chaîne non UUID), il le renvoie tel quel.
   *
   * Améliorations :
   * - Buffer de 5 min avant expiration (refresh proactif)
   * - Mutex pour éviter les refresh concurrents (refresh_token Autodesk est à usage unique)
   * - Retry : si le refresh échoue, recharge le user depuis la DB au cas où un autre thread a déjà rafraîchi
   */
  async ensureValidToken(userIdOrToken) {
    // 1) Si on nous passe déjà un access_token (pas un UUID), on le renvoie.
    if (!UUID_RE.test(String(userIdOrToken || ''))) {
      return userIdOrToken; // c'est déjà un access_token
    }

    const userId = userIdOrToken;

    // 2) Charger l'utilisateur
    let user = await User.findByPk(userId);
    if (!user) throw new Error('Utilisateur introuvable');

    // 3) Si le token est encore valide (avec buffer de 5 min), le retourner directement
    if (!this._isTokenExpiredOrSoon(user)) {
      return user.accessToken;
    }

    // 4) Le token est expiré ou va expirer bientôt : on doit refresh
    logger.info(`[APSAuth] Token expiré/bientôt expiré pour ${user.name || userId.substring(0, 8)}, refresh nécessaire`);

    // Acquérir le lock pour éviter les refresh concurrents
    await this._acquireRefreshLock(userId);

    try {
      // Re-charger le user depuis la DB : un autre thread a peut-être déjà refreshé pendant qu'on attendait le lock
      user = await User.findByPk(userId);
      if (!user) throw new Error('Utilisateur introuvable après lock');

      // Re-vérifier : le token a-t-il été rafraîchi par un autre thread entre-temps ?
      if (!this._isTokenExpiredOrSoon(user)) {
        logger.info(`[APSAuth] Token déjà rafraîchi par un autre thread pour ${user.name || userId.substring(0, 8)}`);
        return user.accessToken;
      }

      if (!user.refreshToken) {
        throw new Error(
          `Refresh token manquant pour ${user.name || user.email || userId.substring(0, 8)} — l'utilisateur doit se reconnecter`
        );
      }

      // Tenter le refresh
      try {
        const refreshed = await this.refreshToken(user.refreshToken);
        await user.updateTokens(
          refreshed.access_token,
          refreshed.refresh_token || user.refreshToken,
          refreshed.expires_in
        );
        logger.info(
          `[APSAuth] Token rafraîchi avec succès pour ${user.name || userId.substring(0, 8)}, expire dans ${refreshed.expires_in}s`
        );
        return refreshed.access_token;
      } catch (refreshError) {
        // Le refresh a échoué — peut-être que le refresh_token a déjà été utilisé par un autre process/instance
        logger.warn(
          `[APSAuth] Refresh échoué pour ${user.name || userId.substring(0, 8)}: ${refreshError.message}`
        );

        // Dernière chance : recharger le user, une autre instance Azure a peut-être rafraîchi le token en DB
        user = await User.findByPk(userId);
        if (user && user.accessToken && !this._isTokenExpiredOrSoon(user)) {
          logger.info(
            `[APSAuth] Token trouvé valide après rechargement DB pour ${user.name || userId.substring(0, 8)}`
          );
          return user.accessToken;
        }

        // Échec complet : le refresh_token est invalide ou expiré
        const lastLogin = user?.lastLogin ? new Date(user.lastLogin).toISOString() : 'jamais';
        throw new Error(
          `Impossible de rafraîchir le token Autodesk pour ${user?.name || user?.email || userId.substring(0, 8)}. ` +
          `Dernière connexion: ${lastLogin}. ` +
          `L'utilisateur doit se reconnecter à l'application.`
        );
      }
    } finally {
      this._releaseRefreshLock(userId);
    }
  }

  async createOrUpdateUser(profile, tokens) {
    let user = await User.findOne({ where: { autodeskId: profile.userId } });
    if (!user) {
      user = await User.create({
        email: profile.email,
        name: profile.name,
        autodeskId: profile.userId,
        permissions: ['read'],
      });
    } else {
      user.email = profile.email || user.email;
      user.name = profile.name || user.name;
    }

    await user.updateTokens(tokens.access_token, tokens.refresh_token, tokens.expires_in);
    user.lastLogin = new Date();
    await user.save();

    return user;
  }

  // ======== 2-LEGGED (serveur) ========

  async getTwoLeggedToken(scopes = this.twoLegged.scopes) {
    const now = Date.now();
    if (this.twoLegged.access_token && now < this.twoLegged.expires_at - 10_000) {
      return {
        access_token: this.twoLegged.access_token,
        token_type: 'Bearer',
        expires_in: Math.max(1, Math.floor((this.twoLegged.expires_at - now) / 1000)),
        scope: (this.twoLegged.scopes || []).join(' '),
      };
    }

    const body = {
      grant_type: 'client_credentials',
      client_id: apsConfig.credentials.client_id,
      client_secret: apsConfig.credentials.client_secret,
      scope: (scopes || []).join(' '),
    };

    try {
      const { data } = await axios.post(
        apsConfig.endpoints.TOKEN,
        qs.stringify(body),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      this.twoLegged.access_token = data.access_token;
      this.twoLegged.expires_at = Date.now() + data.expires_in * 1000;
      this.twoLegged.scopes = scopes;
      return data;
    } catch (err) {
      const msg = this._extractError(err);
      logger.error(`getTwoLeggedToken failed: ${msg}`);
      throw new Error(`APS 2-legged failed: ${msg}`);
    }
  }

  /**
   * Jeton applicatif destiné UNIQUEMENT au Viewer (navigateur).
   * Scope unique : viewables:read. Cache dédié — ne touche pas au 2-legged large.
   */
  async getViewerToken() {
    const SCOPES = ['viewables:read'];
    const now = Date.now();
    if (this.viewerToken.access_token && now < this.viewerToken.expires_at - 60_000) {
      return {
        access_token: this.viewerToken.access_token,
        expires_in: Math.max(1, Math.floor((this.viewerToken.expires_at - now) / 1000)),
        expires_at: this.viewerToken.expires_at,
        scope: SCOPES.join(' '),
      };
    }

    const body = {
      grant_type: 'client_credentials',
      client_id: apsConfig.credentials.client_id,
      client_secret: apsConfig.credentials.client_secret,
      scope: SCOPES.join(' '),
    };

    try {
      const { data } = await axios.post(
        apsConfig.endpoints.TOKEN,
        qs.stringify(body),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
      const expiresIn = Number(data.expires_in) || 3600;
      this.viewerToken.access_token = data.access_token;
      this.viewerToken.expires_at = Date.now() + expiresIn * 1000;
      const scope = String(data.scope || SCOPES.join(' ')).trim();
      if (scope && !scope.split(/\s+/).every((s) => s === 'viewables:read')) {
        this.viewerToken.access_token = null;
        this.viewerToken.expires_at = 0;
        throw new Error('Jeton Viewer refusé : la portée n’est pas limitée à viewables:read');
      }
      return {
        access_token: data.access_token,
        expires_in: expiresIn,
        expires_at: this.viewerToken.expires_at,
        scope: 'viewables:read',
      };
    } catch (err) {
      if (err.message && err.message.includes('Jeton Viewer refusé')) throw err;
      const msg = this._extractError(err);
      logger.error(`getViewerToken failed: ${msg}`);
      throw new Error(`APS Viewer token failed: ${msg}`);
    }
  }

  // ======== Utils ========

  _extractError(err) {
    if (err?.response?.data) {
      try { return JSON.stringify(err.response.data); } catch { return String(err.response.data); }
    }
    return err?.message || String(err);
  }
}

module.exports = new APSAuthService();
