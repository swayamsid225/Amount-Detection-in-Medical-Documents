const config = require('../config/config');

class Validators {
  /**
   * Validate file upload
   */
  validateFile(file) {
    const errors = [];

    if (!file) {
      return { valid: false, errors: ['No file provided'] };
    }

    // Check file size
    if (file.size > config.maxFileSize) {
      errors.push(
        `File too large: ${(file.size / 1024 / 1024).toFixed(2)}MB ` +
        `(max: ${config.maxFileSize / 1024 / 1024}MB)`
      );
    }

    // Check MIME type
    if (!config.allowedMimeTypes.includes(file.mimetype)) {
      errors.push(
        `Invalid file type: ${file.mimetype}. ` +
        `Allowed types: ${config.allowedMimeTypes.join(', ')}`
      );
    }

    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  /**
   * Validate text input
   */
  validateText(text) {
    const errors = [];

    if (!text || typeof text !== 'string') {
      errors.push('Text must be a non-empty string');
    } else if (text.trim().length === 0) {
      errors.push('Text cannot be empty or whitespace only');
    } else if (text.length > 50000) {
      errors.push('Text too long (max 50,000 characters)');
    }

    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  /**
   * Validate base64 image
   */
  validateBase64Image(base64String) {
    const errors = [];

    if (!base64String || typeof base64String !== 'string') {
      errors.push('Base64 image must be a string');
      return { valid: false, errors: errors };
    }

    // Check format
    const base64Regex = /^data:image\/(jpeg|jpg|png|bmp);base64,/;
    if (!base64Regex.test(base64String)) {
      errors.push(
        'Invalid base64 format. Expected: data:image/[jpeg|jpg|png|bmp];base64,...'
      );
    }

    // Estimate size (base64 is ~33% larger than original)
    const sizeEstimate = (base64String.length * 0.75) / 1024 / 1024;
    if (sizeEstimate > config.maxFileSize / 1024 / 1024) {
      errors.push(`Estimated file size too large: ${sizeEstimate.toFixed(2)}MB`);
    }

    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  /**
   * Validate raw tokens array
   */
  validateRawTokens(tokens) {
    const errors = [];

    if (!Array.isArray(tokens)) {
      errors.push('raw_tokens must be an array');
    } else if (tokens.length === 0) {
      errors.push('raw_tokens cannot be empty');
    } else if (tokens.length > 100) {
      errors.push('Too many tokens (max 100)');
    } else {
      // Check that all tokens are strings
      const invalidTokens = tokens.filter(t => typeof t !== 'string');
      if (invalidTokens.length > 0) {
        errors.push('All tokens must be strings');
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  /**
   * Validate normalized amounts array
   */
  validateNormalizedAmounts(amounts) {
    const errors = [];

    if (!Array.isArray(amounts)) {
      errors.push('normalized_amounts must be an array');
    } else if (amounts.length === 0) {
      errors.push('normalized_amounts cannot be empty');
    } else if (amounts.length > 100) {
      errors.push('Too many amounts (max 100)');
    } else {
      // Check that all amounts are valid numbers
      const invalidAmounts = amounts.filter(
        a => typeof a !== 'number' || !Number.isFinite(a) || a < 0
      );
      if (invalidAmounts.length > 0) {
        errors.push('All amounts must be positive finite numbers');
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  /**
   * Sanitize text input
   */
  sanitizeText(text) {
    if (!text) return '';
    
    // Remove null bytes and control characters (except newlines and tabs)
    return text
      .replace(/\x00/g, '')
      .replace(/[\x01-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
  }

  /**
   * Build validation error response
   */
  buildErrorResponse(errors) {
    return {
      error: 'validation_error',
      message: 'Request validation failed',
      details: {
        errors: errors
      }
    };
  }
}

module.exports = new Validators();