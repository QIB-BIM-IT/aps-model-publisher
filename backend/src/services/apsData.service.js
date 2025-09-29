// src/services/apsData.service.js
const axios = require('axios');
const { apsConfig } = require('../config/aps.config');
const logger = require('../config/logger');

class APSDataService {
  constructor() {
    this.baseUrl = apsConfig.apis.baseUrl;
  }

  _headers(accessToken) {
    return { Authorization: `Bearer ${accessToken}` };
  }

  async _get(url, accessToken, params) {
    try {
      const { data } = await axios.get(url, {
        headers: this._headers(accessToken),
        params,
      });
      return data;
    } catch (err) {
      const msg = err?.response?.data ? JSON.stringify(err.response.data) : err.message;
      logger.error(`APS GET ${url} failed: ${msg}`);
      throw new Error(`Impossible d'appeler ACC (${msg})`);
    }
  }

  // --------- Hubs ----------
  async getHubs(accessToken) {
    const url = `${this.baseUrl}${apsConfig.apis.dataManagement.hubs}`;
    const data = await this._get(url, accessToken);
    return Array.isArray(data?.data) ? data.data : data;
  }

  // --------- Projects ----------
  async getProjects(hubId, accessToken) {
    const path = apsConfig.apis.dataManagement.projects.replace('{hub_id}', encodeURIComponent(hubId));
    const url = `${this.baseUrl}${path}`;
    const data = await this._get(url, accessToken);
    return Array.isArray(data?.data) ? data.data : data;
  }

  // --------- Top Folders (root) ----------
  async getTopFolders(hubId, projectId, accessToken) {
    const path = apsConfig.apis.dataManagement.topFolders
      .replace('{hub_id}', encodeURIComponent(hubId))
      .replace('{project_id}', encodeURIComponent(projectId));
    const url = `${this.baseUrl}${path}`;
    const data = await this._get(url, accessToken);
    return Array.isArray(data?.data) ? data.data : data;
  }

  // --------- Folder Contents (subfolders + items) ----------
  async getFolderContents(projectId, folderId, accessToken) {
    const path = apsConfig.apis.dataManagement.folderContents
      .replace('{project_id}', encodeURIComponent(projectId))
      .replace('{folder_id}', encodeURIComponent(folderId));
    const url = `${this.baseUrl}${path}`;
    const data = await this._get(url, accessToken);
    return Array.isArray(data?.data) ? data.data : data;
  }
}

module.exports = new APSDataService();
