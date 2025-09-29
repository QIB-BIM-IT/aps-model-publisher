// src/routes/aps.routes.js
const express = require('express');
const router = express.Router();
const logger = require('../config/logger');
const { authenticateToken } = require('../middleware/auth.middleware');
const apsDataService = require('../services/apsData.service');
const apsAuthService = require('../services/apsAuth.service');

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

module.exports = router;
