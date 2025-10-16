// src/middleware/errorHandler.middleware.js
// Middleware centralisé pour gérer TOUTES les erreurs de l'application
const logger = require('../config/logger');

/**
 * Classes d'erreurs personnalisées pour l'application
 */
class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.timestamp = new Date().toISOString();
    Error.captureStackTrace(this, this.constructor);
  }
}

class AuthError extends AppError {
  constructor(message = 'Non authentifié') {
    super(message, 401);
  }
}

class TokenExpiredError extends AppError {
  constructor(message = 'Token Autodesk expiré, reconnexion requise') {
    super(message, 401);
  }
}

class RateLimitError extends AppError {
  constructor(message = 'Trop de requêtes, réessayez plus tard') {
    super(message, 429);
  }
}

class ValidationError extends AppError {
  constructor(message) {
    super(message, 400);
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Ressource') {
    super(`${resource} introuvable`, 404);
  }
}

class ExternalAPIError extends AppError {
  constructor(service, message) {
    super(`Erreur ${service}: ${message}`, 502);
    this.service = service;
  }
}

/**
 * Middleware de gestion d'erreurs centralisé
 * Doit être le DERNIER middleware dans server.js
 */
function errorHandler(err, req, res, next) {
  let error = { ...err };
  error.message = err.message;

  // Log l'erreur (sans données sensibles)
  const logData = {
    message: error.message,
    statusCode: error.statusCode || 500,
    path: req.path,
    method: req.method,
    userId: req.userId || 'anonymous',
    timestamp: new Date().toISOString(),
  };

  // Log selon la gravité
  if ((error.statusCode || 500) >= 500) {
    logger.error('[ErrorHandler] Erreur serveur:', { ...logData, stack: err.stack });
  } else if ((error.statusCode || 0) >= 400) {
    logger.warn('[ErrorHandler] Erreur client:', logData);
  } else {
    logger.info('[ErrorHandler] Info:', logData);
  }

  // Gérer les erreurs spécifiques de Sequelize
  if (err.name === 'SequelizeValidationError') {
    const messages = err.errors.map((e) => e.message);
    error = new ValidationError(messages.join(', '));
  }

  if (err.name === 'SequelizeUniqueConstraintError') {
    error = new ValidationError('Cette ressource existe déjà');
  }

  if (err.name === 'SequelizeForeignKeyConstraintError') {
    error = new ValidationError('Référence invalide');
  }

  if (err.name === 'SequelizeConnectionError' || err.name === 'SequelizeConnectionRefusedError') {
    error = new AppError('Erreur de connexion à la base de données', 503);
  }

  // Gérer les erreurs JWT
  if (err.name === 'JsonWebTokenError') {
    error = new AuthError('Token invalide');
  }

  if (err.name === 'TokenExpiredError') {
    error = new AuthError('Session expirée');
  }

  // Gérer les erreurs Axios (API externes comme Autodesk)
  if (err.isAxiosError) {
    const status = err.response?.status;
    const apiMessage = err.response?.data?.message || err.response?.data?.error || err.message;

    if (status === 401) {
      error = new TokenExpiredError();
    } else if (status === 429) {
      error = new RateLimitError();
    } else if (status >= 500) {
      error = new ExternalAPIError('Autodesk', apiMessage);
    } else if (status === 404) {
      error = new NotFoundError('Ressource Autodesk');
    } else {
      error = new AppError(apiMessage, status || 502);
    }
  }

  // Réponse standardisée
  const response = {
    success: false,
    message: error.message || 'Erreur serveur interne',
    statusCode: error.statusCode || 500,
    timestamp: error.timestamp || new Date().toISOString(),
  };

  // En développement, inclure plus de détails
  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
    response.originalError = {
      name: err.name,
      message: err.message,
    };
  }

  res.status(error.statusCode || 500).json(response);
}

/**
 * Wrapper pour les routes async
 * Permet d'éviter les try-catch dans chaque route
 *
 * Usage:
 * router.get('/jobs', asyncHandler(async (req, res) => {
 *   const jobs = await PublishJob.findAll();
 *   res.json({ success: true, data: jobs });
 * }));
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Setup des handlers globaux pour les erreurs non catchées
 * À appeler au démarrage de l'application
 */
function setupGlobalErrorHandlers() {
  // Uncaught exceptions (erreurs synchrones non catchées)
  process.on('uncaughtException', (err) => {
    logger.error('[FATAL] Uncaught Exception:', {
      message: err.message,
      stack: err.stack,
    });
    // En production, on devrait faire un graceful shutdown
    // et laisser un process manager (PM2, Docker) redémarrer l'app
    // eslint-disable-next-line no-console
    console.error('💥 Uncaught Exception! Shutting down...');
    process.exit(1);
  });

  // Unhandled promise rejections (Promises non catchées)
  process.on('unhandledRejection', (reason) => {
    logger.error('[FATAL] Unhandled Promise Rejection:', {
      reason: reason?.message || reason,
      stack: reason?.stack,
    });
    // Log mais ne pas crash (pour l'instant)
    // En production stricte, on pourrait exit(1) ici aussi
  });

  logger.info('[ErrorHandler] Global error handlers configured');
}

module.exports = {
  errorHandler,
  asyncHandler,
  setupGlobalErrorHandlers,
  // Classes d'erreurs exportées pour usage dans les routes
  AppError,
  AuthError,
  TokenExpiredError,
  RateLimitError,
  ValidationError,
  NotFoundError,
  ExternalAPIError,
};
