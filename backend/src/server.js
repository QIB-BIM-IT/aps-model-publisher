// src/server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');

const logger = require('./config/logger');
const { connectDB } = require('./config/database');
// ✅ Import du error handler
const {
  errorHandler,
  setupGlobalErrorHandlers,
} = require('./middleware/errorHandler.middleware');

// ✅ Setup handlers globaux (doit être fait avant tout le reste)
setupGlobalErrorHandlers();

// Routes
const authRoutes = require('./routes/auth.routes');
const apsRoutes = require('./routes/aps.routes');
const publishRoutes = require('./routes/publish.routes');
const publishDirectRoutes = require('./routes/publish.direct.routes');
const pdfExportRoutes = require('./routes/pdfExport.routes');

const app = express();

// -------- Middlewares globaux
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3001';
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(helmet());
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// -------- Healthcheck
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    env: process.env.NODE_ENV || 'development',
    time: new Date().toISOString(),
  });
});

// -------- Routes applicatives
app.use('/api/auth', authRoutes);
app.use('/api/aps', apsRoutes);
app.use('/api/publish', publishRoutes);
app.use('/api/publish', publishDirectRoutes);
app.use('/api/pdf-export', pdfExportRoutes);

// -------- 404 handler (doit être AVANT le error handler)
app.use((req, res, next) => {
  const error = new Error(`Route non trouvée: ${req.method} ${req.path}`);
  error.statusCode = 404;
  next(error);
});

// -------- ✅ Error handler centralisé (doit être le DERNIER middleware)
app.use(errorHandler);

// -------- Bootstrap
const PORT = parseInt(process.env.PORT || '3000', 10);

(async () => {
  try {
    const alter = String(process.env.DB_SYNC_ALTER || 'false').toLowerCase() === 'true';
    await connectDB(alter);
    logger.info(`Synchronisation Sequelize terminée (alter=${alter})`);

    const server = app.listen(PORT, () => {
      logger.info(`🚀 Serveur démarré sur le port ${PORT}`);
      logger.info(`📊 Environnement: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`🌐 URL: http://localhost:${PORT}`);
    });

    // Arrêt propre
    const graceful = (signal) => {
      logger.info(`${signal} reçu. Fermeture gracieuse du serveur…`);
      server.close(() => {
        logger.info('Serveur fermé');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => graceful('SIGTERM'));
    process.on('SIGINT', () => graceful('SIGINT'));
  } catch (e) {
    logger.error(`❌ Erreur de démarrage: ${e.message}`);
    process.exit(1);
  }
})();

module.exports = app;
