// src/routes/aps.routes.js
const express = require('express');
const axios = require('axios');
const router = express.Router();
const logger = require('../config/logger');
const { authenticateToken } = require('../middleware/auth.middleware');
const apsDataService = require('../services/apsData.service');
const apsAuthService = require('../services/apsAuth.service');

// Route de debug SANS authentification (temporaire)
router.get('/debug/folder-contents-noauth', async (req, res) => {
  try {
    const { projectId, folderId } = req.query;

    if (!projectId || !folderId) {
      return res.status(400).json({
        error: 'Paramètres manquants',
        usage: 'projectId et folderId requis',
      });
    }

    // Trouvez un userId existant dans votre DB
    const { User } = require('../models');
    const user = await User.findOne({ order: [['createdAt', 'DESC']] });

    if (!user) {
      return res.status(500).json({ error: 'Aucun utilisateur trouvé dans la DB' });
    }

    const accessToken = await require('../services/apsAuth.service').ensureValidToken(user.id);

    const url = `https://developer.api.autodesk.com/data/v2/projects/${encodeURIComponent(
      projectId
    )}/folders/${encodeURIComponent(folderId)}/contents`;

    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { 'page[limit]': 50 },
    });

    const revitFiles = response.data?.data
      ?.filter((item) => {
        const name = item.attributes?.displayName || '';
        return name.toLowerCase().endsWith('.rvt');
      })
      .map((item) => ({
        id: item.id,
        type: item.type,
        displayName: item.attributes?.displayName,
        tipVersionId: item.relationships?.tip?.data?.id,
        relationships: item.relationships,
      }));

    res.json({
      success: true,
      projectId,
      folderId,
      revitFilesCount: revitFiles?.length || 0,
      revitFiles,
      fullResponse: response.data,
    });
  } catch (e) {
    res.status(500).json({
      error: e.message,
      details: e.response?.data,
    });
  }
});

router.use(authenticateToken);

// Hubs
router.get('/hubs', async (req, res) => {
  try {
    const accessToken = await apsAuthService.ensureValidToken(req.userId);
    const hubs = await apsDataService.getHubs(accessToken);
    res.json({ success: true, data: hubs });
  } catch (err) {
    logger.error(`GET /api/aps/hubs error: ${err.message}`);
    res.status(500).json({ success: false, message: 'Erreur hubs' });
  }
});

// Projects
router.get('/projects', async (req, res) => {
  try {
    const hubId = req.query.hubId;
    if (!hubId) return res.status(400).json({ success: false, message: 'hubId requis' });
    const accessToken = await apsAuthService.ensureValidToken(req.userId);
    const projects = await apsDataService.getProjects(hubId, accessToken);
    res.json({ success: true, data: projects });
  } catch (err) {
    logger.error(`GET /api/aps/projects error: ${err.message}`);
    res.status(500).json({ success: false, message: 'Erreur projects' });
  }
});

router.get('/hubs/:hubId/projects', async (req, res) => {
  try {
    const accessToken = await apsAuthService.ensureValidToken(req.userId);
    const projects = await apsDataService.getProjects(req.params.hubId, accessToken);
    res.json({ success: true, data: projects });
  } catch (err) {
    logger.error(`GET /api/aps/hubs/:hubId/projects error: ${err.message}`);
    res.status(500).json({ success: false, message: 'Erreur projects' });
  }
});

// ----- NEW: Project tree -----
// Top folders
router.get('/projects/:projectId/top-folders', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { hubId } = req.query;
    if (!hubId) return res.status(400).json({ success: false, message: 'hubId requis' });

    const accessToken = await apsAuthService.ensureValidToken(req.userId);
    const folders = await apsDataService.getTopFolders(hubId, projectId, accessToken);
    res.json({ success: true, data: folders });
  } catch (err) {
    logger.error(`GET /api/aps/projects/:projectId/top-folders error: ${err.message}`);
    res.status(500).json({ success: false, message: 'Erreur top-folders' });
  }
});

// Folder contents (subfolders + items)
router.get('/projects/:projectId/folders/:folderId/contents', async (req, res) => {
  try {
    const { projectId, folderId } = req.params;
    const accessToken = await apsAuthService.ensureValidToken(req.userId);
    const contents = await apsDataService.getFolderContents(projectId, folderId, accessToken);
    res.json({ success: true, data: contents });
  } catch (err) {
    logger.error(`GET /api/aps/projects/:projectId/folders/:folderId/contents error: ${err.message}`);
    res.status(500).json({ success: false, message: 'Erreur folder-contents' });
  }
});

// Route de diagnostic temporaire
router.get('/debug/folder-contents', async (req, res) => {
  try {
    const { projectId, folderId } = req.query;

    if (!projectId || !folderId) {
      return res.status(400).json({
        error: 'projectId et folderId requis',
        example: '/api/aps/debug/folder-contents?projectId=b.xxx&folderId=urn:adsk.wipprod:fs.folder:co.xxx',
      });
    }

    const userId = req.user?.id || req.userId;
    const accessToken = await apsAuthService.ensureValidToken(userId);

    const url = `https://developer.api.autodesk.com/data/v2/projects/${encodeURIComponent(projectId)}/folders/${encodeURIComponent(folderId)}/contents`;

    logger.info(`[DEBUG] Fetching: ${url}`);

    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { 'page[limit]': 50 },
    });

    const revitFiles = response.data?.data
      ?.filter((item) => {
        const name = item.attributes?.displayName || '';
        return name.toLowerCase().endsWith('.rvt');
      })
      .map((item) => ({
        id: item.id,
        type: item.type,
        displayName: item.attributes?.displayName,
        createTime: item.attributes?.createTime,
        extension: item.attributes?.extension,
        relationships: item.relationships,
        tipVersionId: item.relationships?.tip?.data?.id,
        rawItem: item,
      }));

    const includedVersions = response.data?.included?.filter((inc) => inc.type === 'versions');

    res.json({
      projectId,
      folderId,
      revitFilesCount: revitFiles?.length || 0,
      revitFiles,
      includedVersions,
      fullResponseData: response.data?.data,
      fullResponseIncluded: response.data?.included,
    });
  } catch (e) {
    logger.error(`[DEBUG] Error: ${e.message}`);
    res.status(500).json({
      error: e.message,
      response: e.response?.data,
      stack: e.stack,
    });
  }
});

module.exports = router;
