const Tesseract = require('tesseract.js');
const logger = require('../utils/logger');
const config = require('../config/config');

class OCRService {
  constructor() {
    this.currencyHints = [
      { pattern: /\b(?:inr|rs\.?|rupees?)\b|₹/gi, code: 'INR' },
      { pattern: /\b(?:usd|dollars?)\b|\$/g, code: 'USD' },
      { pattern: /\b(?:eur|euros?)\b|€/gi, code: 'EUR' },
      { pattern: /\b(?:gbp|pounds?)\b|£/gi, code: 'GBP' }
    ];

    // Keywords that indicate a line contains monetary values
    this.monetaryKeywords = [
      'subtotal', 'total', 'amount', 'paid', 'cash', 'change', 
      'due', 'balance', 'discount', 'tax', 'gst', 'vat', 'cgst', 'sgst',
      'price', 'cost', 'bill', 'payment', 'charge', 'fee', 'charges', 'pald'
    ];

    // Patterns to explicitly exclude
    this.excludePatterns = [
      /\b(?:invoice|bill)\s*#?\s*:?\s*\d{5,}\b/gi,  // Invoice #12345 (5+ digits)
      /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/g, // Dates
      /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?/gi,  // Times
      /patient\s*(?:name|id)\s*:?\s*\d+/gi,          // Patient Name/ID
      /doctor\s*(?:name|id)\s*:?\s*\d+/gi,           // Doctor Name/ID
      /room\s*(?:no|number)\s*:?\s*\d+/gi,           // Room No/Number
      /\b(?:phone|tel|mobile|contact)\s*:?\s*\d{10,}/gi // Phone numbers
    ];
  }

  /**
   * Extract text from image buffer using Tesseract OCR
   */
  async imageBufferToText(buffer) {
    logger.info('Starting OCR processing');
    const startTime = Date.now();
    
    try {
      const worker = await Tesseract.createWorker(config.ocrLanguage || 'eng', 1, {
        logger: m => {
          if (m.status === 'recognizing text') {
            logger.debug(`OCR Progress: ${Math.round(m.progress * 100)}%`);
          }
        }
      });
      
      const { data: { text, confidence } } = await worker.recognize(buffer);
      await worker.terminate();
      
      const duration = Date.now() - startTime;
      logger.info(`OCR completed in ${duration}ms with confidence: ${confidence}%`);
      
      return {
        text: text.trim(),
        confidence: confidence / 100
      };
    } catch (error) {
      logger.error('OCR processing failed:', error);
      throw new Error(`OCR failed: ${error.message}`);
    }
  }

  /**
   * Check if a line matches exclude patterns
   */
  matchesExcludePattern(line) {
    for (const pattern of this.excludePatterns) {
      if (pattern.test(line)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if a line is likely to contain monetary information
   */
  isMonetaryLine(line) {
    const lowerLine = line.toLowerCase();
    
    // Skip lines that match exclude patterns
    if (this.matchesExcludePattern(line)) {
      return false;
    }
    
    // Check for monetary keywords
    for (const keyword of this.monetaryKeywords) {
      if (lowerLine.includes(keyword)) {
        return true;
      }
    }

    // Check if line has currency symbol or Rs
    if (/[\$€£₹]/.test(line) || /rs\.?\s/i.test(line)) {
      return true;
    }

    // Check for colon followed by anything that looks like a number
    if (/:\s*(?:Rs\.?|INR|\$|€|£|₹)?\s*[l1IO0-9,]+/i.test(line)) {
      return true;
    }

    return false;
  }

  /**
   * Extract numeric tokens from text with comprehensive OCR error handling
   */
  extractNumericTokensFromText(text) {
    const tokens = [];
    const seenValues = new Set();
    
    // Split text by common delimiters while preserving context
    const segments = text.split(/[|\n\r]+/).map(s => s.trim()).filter(s => s.length > 0);

    logger.info(`Processing ${segments.length} text segments for token extraction`);

    for (const segment of segments) {
      logger.debug(`Processing segment: "${segment}"`);
      
      // Skip non-monetary segments
      if (!this.isMonetaryLine(segment)) {
        logger.debug(`Skipping non-monetary segment: ${segment}`);
        continue;
      }

      // Comprehensive extraction patterns that handle OCR errors
      // Pattern matches: Rs l200, Rs. 1O00, Paid: 2OO, Total: l200, etc.
      const pattern = /(?:Rs\.?|INR|USD|EUR|GBP|\$|€|£|₹|:)\s*([l1IO0-9,]+(?:\.[l1IO0-9]{1,2})?)/gi;
      
      const matches = [...segment.matchAll(pattern)];
      
      logger.debug(`Found ${matches.length} potential matches in segment`);
      
      for (const match of matches) {
        let token = match[1];
        if (!token) continue;
        
        token = token.trim();
        
        // Skip empty tokens
        if (!token || token.length === 0) continue;
        
        // Create a normalized version for deduplication
        // Handle OCR errors: l->1, O->0, I->1
        const normalizedValue = token
          .replace(/[,\s]/g, '')
          .replace(/[lLiI]/g, '1')
          .replace(/O/g, '0');
        
        // Skip if empty after normalization
        if (!normalizedValue || normalizedValue.length === 0) continue;
        
        // Skip percentages
        if (token.includes('%') || normalizedValue.includes('%')) {
          logger.debug(`Skipping percentage: "${token}"`);
          continue;
        }
        
        // Validate that we have a reasonable number after normalization
        const testValue = parseFloat(normalizedValue);
        if (!Number.isFinite(testValue) || testValue <= 0) {
          logger.debug(`Invalid numeric value: "${token}" -> ${testValue}`);
          continue;
        }
        
        // Skip unrealistically small values (less than 1)
        if (testValue < 1) {
          logger.debug(`Value too small: "${token}" -> ${testValue}`);
          continue;
        }
        
        // Skip if we've already seen this normalized value
        if (seenValues.has(normalizedValue)) {
          logger.debug(`Skipping duplicate token: "${token}" (normalized: ${normalizedValue})`);
          continue;
        }
        
        seenValues.add(normalizedValue);
        tokens.push(token);
        
        logger.debug(`✓ Extracted token: "${token}" (normalized: ${normalizedValue}) from: "${segment}"`);
      }
    }

    logger.info(`Extracted ${tokens.length} unique monetary tokens`);
    
    return tokens;
  }

  /**
   * Detect currency from text
   */
  detectCurrency(text) {
    const lowerText = text.toLowerCase();
    
    // Check each currency pattern and count matches
    const currencyMatches = [];
    
    for (const { pattern, code } of this.currencyHints) {
      // Reset regex lastIndex
      pattern.lastIndex = 0;
      
      const matches = [...lowerText.matchAll(pattern)];
      if (matches.length > 0) {
        currencyMatches.push({ code, count: matches.length });
        logger.debug(`Found ${matches.length} matches for ${code}`);
      }
    }
    
    // Return currency with most matches
    if (currencyMatches.length > 0) {
      currencyMatches.sort((a, b) => b.count - a.count);
      logger.info(`Detected currency: ${currencyMatches[0].code}`);
      return currencyMatches[0].code;
    }
    
    logger.info('No currency detected, defaulting to USD');
    return 'USD';
  }

  /**
   * Main extraction method - handles both text and image inputs
   */
  async extractFromTextOrImage({ text, image_base64, fileBuffer }) {
    let extractedText = text || '';
    let ocrConfidence = 0.0;

    // Process image if provided
    if (fileBuffer || image_base64) {
      let buffer = fileBuffer;
      
      // Convert base64 to buffer if needed
      if (image_base64 && !buffer) {
        try {
          const base64Data = image_base64.replace(/^data:image\/[a-z]+;base64,/, '');
          buffer = Buffer.from(base64Data, 'base64');
        } catch (error) {
          logger.error('Failed to decode base64 image:', error);
          throw new Error('Invalid base64 image format');
        }
      }

      if (buffer) {
        const ocrResult = await this.imageBufferToText(buffer);
        extractedText = extractedText 
          ? `${extractedText}\n${ocrResult.text}` 
          : ocrResult.text;
        ocrConfidence = ocrResult.confidence;
      }
    }

    // Validate extracted text
    if (!extractedText || extractedText.trim().length === 0) {
      logger.warn('No text extracted from input');
      return {
        raw_tokens: [],
        currency_hint: null,
        confidence: 0,
        extracted_text: ''
      };
    }

    // Extract tokens with improved filtering
    const rawTokens = this.extractNumericTokensFromText(extractedText);
    const currencyHint = this.detectCurrency(extractedText);

    // Calculate confidence
    const confidence = this.calculateConfidence(ocrConfidence, rawTokens.length, extractedText);

    logger.info(`Extracted ${rawTokens.length} tokens with ${(confidence * 100).toFixed(1)}% confidence`);

    return {
      raw_tokens: rawTokens,
      currency_hint: currencyHint,
      confidence: parseFloat(confidence.toFixed(2)),
      extracted_text: extractedText
    };
  }

  /**
   * Calculate overall confidence score
   */
  calculateConfidence(ocrConfidence, tokenCount, text = '') {
    if (tokenCount === 0) return 0;
    
    // Base confidence
    let confidence = ocrConfidence > 0 ? ocrConfidence : 0.8;
    
    // Adjust based on token count
    if (tokenCount >= 2 && tokenCount <= 10) {
      // Optimal range
      confidence = Math.min(0.95, confidence + 0.1);
    } else if (tokenCount === 1) {
      // Single token is less confident
      confidence *= 0.9;
    } else if (tokenCount > 15) {
      // Too many tokens suggests noise
      confidence *= 0.8;
    }

    // Boost confidence if we see clear monetary keywords
    const monetaryKeywordCount = this.monetaryKeywords.filter(
      kw => text.toLowerCase().includes(kw)
    ).length;
    
    if (monetaryKeywordCount >= 2) {
      confidence = Math.min(0.95, confidence + 0.05);
    }
    
    // Clamp between min threshold and 0.95
    return Math.max(
      config.minOcrConfidence || 0.5,
      Math.min(0.95, confidence)
    );
  }
}

module.exports = new OCRService();