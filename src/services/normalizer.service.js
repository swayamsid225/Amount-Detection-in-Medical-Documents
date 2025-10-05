const logger = require('../utils/logger');
const config = require('../config/config');

class NormalizerService {
  constructor() {
    // OCR error correction mappings - comprehensive list
    this.digitCorrections = {
      'l': '1', 'L': '1', 'I': '1', 'i': '1',
      'O': '0', 'o': '0', 'D': '0',
      'S': '5', 's': '5',
      'Z': '2', 'z': '2',
      'B': '8', 'b': '8',
      'G': '6', 'g': '6',
      'T': '7', 't': '7'
    };
  }

  /**
   * Fix common OCR digit errors with improved logic
   */
  fixOcrDigits(token) {
    if (!token) return '';
    
    let fixed = token.trim();
    
    // Remove currency symbols and whitespace
    fixed = fixed.replace(/[Rs\.\$€£₹]/gi, '');
    fixed = fixed.replace(/\s+/g, '');
    
    // Apply digit corrections character by character
    // Only apply corrections if the character is adjacent to digits
    let result = '';
    for (let i = 0; i < fixed.length; i++) {
      const char = fixed[i];
      const prevChar = i > 0 ? fixed[i - 1] : '';
      const nextChar = i < fixed.length - 1 ? fixed[i + 1] : '';
      
      // Check if previous or next character is a digit
      const hasAdjacentDigit = /\d/.test(prevChar) || /\d/.test(nextChar);
      
      // Apply correction if it's a known OCR error and has adjacent digit
      if (this.digitCorrections[char] && hasAdjacentDigit) {
        result += this.digitCorrections[char];
      } else if (/[0-9.,]/.test(char)) {
        // Keep digits, dots, and commas
        result += char;
      }
      // Skip other characters
    }
    
    fixed = result;
    
    // Remove commas (thousand separators)
    fixed = fixed.replace(/,/g, '');
    
    // Ensure we only have valid numeric characters
    fixed = fixed.replace(/[^0-9\.]/g, '');
    
    // Handle multiple decimal points (keep only first one)
    const parts = fixed.split('.');
    if (parts.length > 2) {
      fixed = parts[0] + '.' + parts.slice(1).join('');
    }
    
    return fixed;
  }

  /**
   * Parse a token into a numeric value
   */
  parseNumeric(token) {
    try {
      const fixed = this.fixOcrDigits(token);
      
      if (!fixed || fixed === '.') return null;

      // Handle percentages (skip them in normalization)
      if (token.includes('%')) {
        logger.debug(`Skipping percentage token: ${token}`);
        return null;
      }

      // Handle regular numbers
      const value = parseFloat(fixed);
      
      if (!Number.isFinite(value) || value < 0) {
        logger.debug(`Invalid numeric value from token "${token}": ${value}`);
        return null;
      }

      // Skip unrealistically small amounts (likely OCR noise)
      if (value < 0.01) {
        logger.debug(`Skipping too small value: ${value} from token "${token}"`);
        return null;
      }

      // Round to 2 decimal places for currency
      const roundedValue = Math.round(value * 100) / 100;

      return {
        type: 'number',
        value: roundedValue,
        original: token,
        normalized: fixed
      };
    } catch (error) {
      logger.warn(`Failed to parse token "${token}":`, error.message);
      return null;
    }
  }

  /**
   * Normalize an array of raw tokens
   */
  normalizeTokens(rawTokens) {
    if (!Array.isArray(rawTokens) || rawTokens.length === 0) {
      return {
        normalized_amounts: [],
        normalization_confidence: 0.0,
        details: []
      };
    }

    const normalizedAmounts = [];
    const details = [];
    const seenValues = new Set();
    let successfulParsed = 0;

    logger.info(`Starting normalization of ${rawTokens.length} tokens`);

    for (const token of rawTokens) {
      logger.debug(`Normalizing token: "${token}"`);
      
      const parsed = this.parseNumeric(token);
      
      if (parsed && parsed.type === 'number') {
        // Check for duplicates
        if (seenValues.has(parsed.value)) {
          logger.debug(`Skipping duplicate value: ${parsed.value}`);
          details.push({
            original: parsed.original,
            normalized: parsed.normalized,
            value: parsed.value,
            success: false,
            reason: 'duplicate'
          });
          continue;
        }
        
        seenValues.add(parsed.value);
        normalizedAmounts.push(parsed.value);
        details.push({
          original: parsed.original,
          normalized: parsed.normalized,
          value: parsed.value,
          success: true
        });
        successfulParsed++;
        
        logger.debug(`✓ Successfully normalized: "${token}" -> ${parsed.value}`);
      } else {
        details.push({
          original: token,
          normalized: this.fixOcrDigits(token),
          value: null,
          success: false,
          reason: parsed ? 'percentage' : 'invalid_format'
        });
        
        logger.debug(`✗ Failed to normalize: "${token}"`);
      }
    }

    // Calculate confidence based on success rate
    const successRate = rawTokens.length > 0 
      ? successfulParsed / rawTokens.length 
      : 0;
    
    const confidence = this.calculateNormalizationConfidence(
      successRate, 
      normalizedAmounts.length
    );

    logger.info(
      `Normalized ${successfulParsed}/${rawTokens.length} tokens ` +
      `(${normalizedAmounts.length} unique) with ${(confidence * 100).toFixed(1)}% confidence`
    );

    return {
      normalized_amounts: normalizedAmounts,
      normalization_confidence: parseFloat(confidence.toFixed(2)),
      details: details
    };
  }

  /**
   * Calculate normalization confidence score
   */
  calculateNormalizationConfidence(successRate, amountCount) {
    if (amountCount === 0) return 0;

    // Base confidence from success rate
    let confidence = 0.5 + (successRate * 0.4);

    // Bonus for having multiple amounts (validates consistency)
    if (amountCount >= 2 && amountCount <= 10) {
      confidence += 0.1;
    }

    // Penalty for too few amounts
    if (amountCount === 1) {
      confidence *= 0.9;
    }

    // Clamp to valid range
    return Math.max(
      config.minNormalizationConfidence || 0.3,
      Math.min(0.99, confidence)
    );
  }

  /**
   * Validate normalized amounts for common issues
   */
  validateAmounts(amounts) {
    const issues = [];

    if (!amounts || amounts.length === 0) {
      issues.push('No amounts to validate');
      return { valid: false, issues };
    }

    // Check for unrealistic values
    for (const amount of amounts) {
      if (amount < 0) {
        issues.push(`Negative amount detected: ${amount}`);
      }
      if (amount > 10000000) { // 10 million threshold
        issues.push(`Unrealistically large amount: ${amount}`);
      }
      if (amount < 0.01) {
        issues.push(`Amount too small: ${amount}`);
      }
    }

    // Check for too many duplicates
    const uniqueAmounts = new Set(amounts);
    if (uniqueAmounts.size < amounts.length * 0.5) {
      issues.push(`Too many duplicate amounts detected`);
    }

    return {
      valid: issues.length === 0,
      issues: issues
    };
  }
}

module.exports = new NormalizerService();