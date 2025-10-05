const express = require('express');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const config = require('./config/config');
const detectionRoutes = require('./routes/detection.routes');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./utils/logger');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: config.allowedOrigins,
  credentials: true
}));

// Compression middleware
app.use(compression());

// Request logging
if (config.nodeEnv === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// Body parsing middleware
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: config.nodeEnv,
    version: '1.0.0'
  });
});

// API routes
app.use('/api', detectionRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'not_found',
    message: `Route ${req.method} ${req.path} not found`,
    availableEndpoints: {
      health: 'GET /health',
      extract: 'POST /api/extract',
      normalize: 'POST /api/normalize',
      classify: 'POST /api/classify',
      final: 'POST /api/final'
    }
  });
});

// Global error handler
app.use(errorHandler);

// Log startup
logger.info('Application initialized');

module.exports = app;