require('dotenv').config();

const config = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  // OpenAI configuration (optional)
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
  
  // File upload configuration
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/jpg', 'image/bmp'],
  
  // OCR configuration
  tessdataPrefix: process.env.TESSDATA_PREFIX || './tessdata',
  ocrLanguage: process.env.OCR_LANGUAGE || 'eng',
  
  // Confidence thresholds
  minOcrConfidence: parseFloat(process.env.MIN_OCR_CONFIDENCE) || 0.2,
  minNormalizationConfidence: parseFloat(process.env.MIN_NORMALIZATION_CONFIDENCE) || 0.3,
  minClassificationConfidence: parseFloat(process.env.MIN_CLASSIFICATION_CONFIDENCE) || 0.4,
  
  // CORS
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:3001').split(','),
  
  // Logging
  logLevel: process.env.LOG_LEVEL || 'info'
};

module.exports = config;