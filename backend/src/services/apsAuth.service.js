// src/services/apsAuth.service.js
const axios = require('axios');
const qs = require('querystring');
const { apsConfig } = require('../config/aps.config');
const logger = require('../config/logger');
const User = require('../models/User');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class APSAuthService {
  constructor() {
    this.twoLegged = {
      access_token: null,
      expires_at: 0,
      scopes: (process.env.APS_TWO_LEGGED_SCOPES || 'data:read data:write data:create bucket:create bucket:read account:read')
        .split(/\s+/)
        .filter(Boolean),
    };
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
    };
    try {
      const { data } = await axios.post(
        apsConfig.endpoints.TOKEN,
        qs.stringify(body),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
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

  /**
   * Retourne un access_token Autodesk valide à partir d’un **userId UUID**.
   * Si on lui passe directement un **access_token** (chaîne non UUID), il le renvoie tel quel.
   */
  async ensureValidToken(userIdOrToken) {
    // 1) Si on nous passe déjà un access_token (pas un UUID), on le renvoie.
    if (!UUID_RE.test(String(userIdOrToken || ''))) {
      return userIdOrToken; // c'est déjà un access_token
    }

    // 2) Flux standard par UUID utilisateur.
    const user = await User.findByPk(userIdOrToken);
    if (!user) throw new Error('Utilisateur introuvable');

    if (!user.accessToken || user.isTokenExpired()) {
      if (!user.refreshToken) throw new Error('Refresh token manquant');
      const refreshed = await this.refreshToken(user.refreshToken);
      await user.updateTokens(
        refreshed.access_token,
        refreshed.refresh_token || user.refreshToken,
        refreshed.expires_in
      );
      return refreshed.access_token;
    }

    return user.accessToken;
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

  // ======== Utils ========

  _extractError(err) {
    if (err?.response?.data) {
      try { return JSON.stringify(err.response.data); } catch { return String(err.response.data); }
    }
    return err?.message || String(err);
  }
}

module.exports = new APSAuthService();
