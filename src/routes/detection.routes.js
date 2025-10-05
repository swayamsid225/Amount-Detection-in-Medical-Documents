const express = require('express');
const multer = require('multer');
const ocrService = require('../services/ocr.service');
const normalizerService = require('../services/normalizer.service');
const classifierService = require('../services/classifier.service');
const llmService = require('../services/llm.service');
const validators = require('../utils/validators');
const logger = require('../utils/logger');
const config = require('../config/config');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxFileSize
  },
  fileFilter: (req, file, cb) => {
    const validation = validators.validateFile(file);
    if (validation.valid) {
      cb(null, true);
    } else {
      cb(new Error(validation.errors.join(', ')), false);
    }
  }
});

/**
 * POST /api/extract
 * Extract raw tokens from text or image
 */
router.post('/extract', upload.single('file'), async (req, res, next) => {
  try {
    const { text, image_base64 } = req.body;
    const fileBuffer = req.file ? req.file.buffer : null;

    // Validate input
    if (!text && !image_base64 && !fileBuffer) {
      return res.status(400).json({
        error: 'missing_input',
        message: 'Provide either text, image_base64, or file upload'
      });
    }

    if (text) {
      const textValidation = validators.validateText(text);
      if (!textValidation.valid) {
        return res.status(400).json(
          validators.buildErrorResponse(textValidation.errors)
        );
      }
    }

    if (image_base64) {
      const base64Validation = validators.validateBase64Image(image_base64);
      if (!base64Validation.valid) {
        return res.status(400).json(
          validators.buildErrorResponse(base64Validation.errors)
        );
      }
    }

    // Extract tokens
    const sanitizedText = text ? validators.sanitizeText(text) : null;
    const result = await ocrService.extractFromTextOrImage({
      text: sanitizedText,
      image_base64,
      fileBuffer
    });

    // Guardrail: Check if any tokens found
    if (!result.raw_tokens || result.raw_tokens.length === 0) {
      logger.warn('No amounts found in document');
      return res.json({
        status: 'no_amounts_found',
        reason: 'document too noisy or contains no numeric amounts'
      });
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/normalize
 * Normalize raw tokens to numeric values
 */
router.post('/normalize', (req, res, next) => {
  try {
    const { raw_tokens } = req.body;

    // Validate input
    if (!raw_tokens) {
      return res.status(400).json({
        error: 'missing_parameter',
        message: 'raw_tokens is required'
      });
    }

    const validation = validators.validateRawTokens(raw_tokens);
    if (!validation.valid) {
      return res.status(400).json(
        validators.buildErrorResponse(validation.errors)
      );
    }

    // Normalize tokens
    const result = normalizerService.normalizeTokens(raw_tokens);

    // Guardrail: Check if any amounts normalized successfully
    if (result.normalized_amounts.length === 0) {
      logger.warn('Failed to normalize any tokens');
      return res.json({
        status: 'normalization_failed',
        reason: 'could not parse any valid numeric amounts from tokens',
        raw_tokens: raw_tokens
      });
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/classify
 * Classify amounts by context
 */
router.post('/classify', async (req, res, next) => {
  try {
    const { text, normalized_amounts } = req.body;

    // Validate input
    if (!text) {
      return res.status(400).json({
        error: 'missing_parameter',
        message: 'text is required'
      });
    }

    if (!normalized_amounts) {
      return res.status(400).json({
        error: 'missing_parameter',
        message: 'normalized_amounts is required'
      });
    }

    const textValidation = validators.validateText(text);
    if (!textValidation.valid) {
      return res.status(400).json(
        validators.buildErrorResponse(textValidation.errors)
      );
    }

    const amountsValidation = validators.validateNormalizedAmounts(normalized_amounts);
    if (!amountsValidation.valid) {
      return res.status(400).json(
        validators.buildErrorResponse(amountsValidation.errors)
      );
    }

    // Classify amounts
    const sanitizedText = validators.sanitizeText(text);
    const result = classifierService.classifyAmounts(sanitizedText, normalized_amounts);

    // Optional: Enhance with LLM if available
    if (llmService.enabled) {
      await llmService.enhanceClassification(sanitizedText, result.amounts);
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/final
 * Complete pipeline: extract -> normalize -> classify
 */
router.post('/final', upload.single('file'), async (req, res, next) => {
  try {
    const { text, image_base64 } = req.body;
    const fileBuffer = req.file ? req.file.buffer : null;

    // Validate input
    if (!text && !image_base64 && !fileBuffer) {
      return res.status(400).json({
        error: 'missing_input',
        message: 'Provide either text, image_base64, or file upload'
      });
    }

    logger.info('Starting full pipeline');

    // Step 1: Extract
    const sanitizedText = text ? validators.sanitizeText(text) : null;
    const ocrResult = await ocrService.extractFromTextOrImage({
      text: sanitizedText,
      image_base64,
      fileBuffer
    });

    // Guardrail: Check if extraction failed
    if (!ocrResult.raw_tokens || ocrResult.raw_tokens.length === 0) {
      logger.warn('No amounts found in document - pipeline terminated');
      return res.json({
        status: 'no_amounts_found',
        reason: 'document too noisy or contains no numeric amounts',
        extracted_text: ocrResult.extracted_text || ''
      });
    }

    logger.info(`Step 1 complete: Extracted ${ocrResult.raw_tokens.length} tokens`);

    // Step 2: Normalize
    const normalizedResult = normalizerService.normalizeTokens(ocrResult.raw_tokens);

    // Guardrail: Check if normalization failed
    if (normalizedResult.normalized_amounts.length === 0) {
      logger.warn('Normalization failed - no valid amounts');
      return res.json({
        status: 'normalization_failed',
        reason: 'could not parse any valid numeric amounts from extracted tokens',
        raw_tokens: ocrResult.raw_tokens,
        extracted_text: ocrResult.extracted_text
      });
    }

    logger.info(`Step 2 complete: Normalized ${normalizedResult.normalized_amounts.length} amounts`);

    // Step 3: Classify
    const classifiedResult = classifierService.classifyAmounts(
      ocrResult.extracted_text || sanitizedText || '',
      normalizedResult.normalized_amounts
    );

    logger.info(`Step 3 complete: Classified ${classifiedResult.amounts.length} amounts`);

    // Step 4: Build final output with provenance
    const finalOutput = {
      currency: ocrResult.currency_hint || 'UNKNOWN',
      amounts: classifiedResult.amounts.map(a => ({
        type: a.type,
        value: a.value,
        source: a.source || 'inferred'
      })),
      status: 'ok',
      metadata: {
        extraction_confidence: ocrResult.confidence,
        normalization_confidence: normalizedResult.normalization_confidence,
        classification_confidence: classifiedResult.confidence,
        total_tokens_extracted: ocrResult.raw_tokens.length,
        amounts_normalized: normalizedResult.normalized_amounts.length,
        amounts_classified: classifiedResult.amounts.length
      }
    };

    // Optional: LLM validation
    if (llmService.enabled) {
      logger.info('Running LLM validation');
      const validation = await llmService.validateClassification(
        ocrResult.extracted_text || sanitizedText || '',
        finalOutput.amounts
      );
      
      if (validation.validated) {
        finalOutput.llm_validation = {
          valid: validation.valid,
          issues: validation.issues || [],
          suggestions: validation.suggestions || []
        };
      }
    }

    logger.info('Full pipeline completed successfully');
    res.json(finalOutput);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/validate
 * Validate classification results (optional LLM validation)
 */
router.post('/validate', async (req, res, next) => {
  try {
    const { text, amounts } = req.body;

    if (!text || !amounts) {
      return res.status(400).json({
        error: 'missing_parameters',
        message: 'text and amounts are required'
      });
    }

    if (!llmService.enabled) {
      return res.json({
        validated: false,
        message: 'LLM validation not available - OPENAI_API_KEY not configured',
        note: 'The system works perfectly without LLM validation'
      });
    }

    const validation = await llmService.validateClassification(text, amounts);
    res.json(validation);
  } catch (error) {
    next(error);
  }
});

module.exports = router;