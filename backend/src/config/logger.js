const winston = require('winston');
const path = require('path');
require('winston-daily-rotate-file');

// DÃ©finir le format des logs
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Configuration pour la console
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...metadata }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(metadata).length > 0 && metadata.stack) {
      msg += `\n${metadata.stack}`;
    }
    return msg;
  })
);

// Configuration pour la rotation des fichiers de logs
const fileRotateTransport = new winston.transports.DailyRotateFile({
  filename: path.join(process.env.LOG_DIR || 'logs', 'application-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d',
  format: logFormat,
});

// Configuration pour les erreurs
const errorFileRotateTransport = new winston.transports.DailyRotateFile({
  filename: path.join(process.env.LOG_DIR || 'logs', 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '30d',
  level: 'error',
  format: logFormat,
});

// CrÃ©er le logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [fileRotateTransport, errorFileRotateTransport],
});

// Ajouter la console en dÃ©veloppement
if (process.env.NODE_ENV !== 'production') {
  logger.add(
    new winston.transports.Console({
      format: consoleFormat,
    })
  );
}

// CrÃ©er des mÃ©thodes simplifiÃ©es (fallbacks)
logger.debug = logger.debug || function (message) { this.log('debug', message); };
logger.info = logger.info || function (message) { this.log('info', message); };
logger.warn = logger.warn || function (message) { this.log('warn', message); };
logger.error = logger.error || function (message) { this.log('error', message); };

module.exports = logger;

