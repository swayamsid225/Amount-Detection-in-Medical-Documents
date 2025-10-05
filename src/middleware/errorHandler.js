const logger = require('../utils/logger');
const config = require('../config/config');

/**
 * Global error handler middleware
 */
function errorHandler(err, req, res, next) {
  // Log the error
  logger.error('Error occurred:', {
    message: err.message,
    stack: config.nodeEnv === 'development' ? err.stack : undefined,
    path: req.path,
    method: req.method
  });

  // Default error response
  let statusCode = err.statusCode || 500;
  let errorResponse = {
    error: err.code || 'internal_error',
    message: err.message || 'An unexpected error occurred'
  };

  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = 400;
    errorResponse = {
      error: 'validation_error',
      message: err.message,
      details: err.details || {}
    };
  } else if (err.name === 'MulterError') {
    statusCode = 400;
    errorResponse = {
      error: 'file_upload_error',
      message: handleMulterError(err)
    };
  } else if (err.message && err.message.includes('OCR failed')) {
    statusCode = 500;
    errorResponse = {
      error: 'ocr_error',
      message: 'Failed to process image with OCR',
      details: config.nodeEnv === 'development' ? err.message : undefined
    };
  } else if (err.message && err.message.includes('Invalid base64')) {
    statusCode = 400;
    errorResponse = {
      error: 'invalid_image',
      message: 'Invalid base64 image format'
    };
  }

  // Add stack trace in development
  if (config.nodeEnv === 'development') {
    errorResponse.stack = err.stack;
    errorResponse.timestamp = new Date().toISOString();
  }

  res.status(statusCode).json(errorResponse);
}

/**
 * Handle Multer-specific errors
 */
function handleMulterError(err) {
  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
      return `File too large. Maximum size is ${config.maxFileSize / 1024 / 1024}MB`;
    case 'LIMIT_FILE_COUNT':
      return 'Too many files uploaded';
    case 'LIMIT_UNEXPECTED_FILE':
      return 'Unexpected file field';
    default:
      return err.message || 'File upload failed';
  }
}

module.exports = errorHandler;