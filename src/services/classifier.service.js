const logger = require('../utils/logger');
const config = require('../config/config');

class ClassifierService {
  constructor() {
    this.classificationRules = [
      {
        type: 'total_bill',
        keywords: ['total amount', 'grand total', 'invoice total', 'net amount', 'total', 't0tal', 't0tal:'],
        patterns: [/t[0o]tal/i],
        priority: 10
      },
      {
        type: 'paid',
        keywords: ['amount paid', 'paid', 'received', 'payment', 'cash', 'pald', 'pald:'],
        patterns: [/pa[il]d/i],
        priority: 9
      },
      {
        type: 'due',
        keywords: ['balance due', 'due', 'balance', 'remaining', 'outstanding', 'due:', 'balance:'],
        patterns: [/\bdue\b/i, /\bbalance\b/i],
        priority: 9
      },
      {
        type: 'subtotal',
        keywords: ['subtotal', 'sub-total', 'sub total', 'before tax'],
        patterns: [/sub\s*total/i],
        priority: 8
      },
      {
        type: 'tax',
        keywords: ['tax', 'gst', 'vat', 'cgst', 'sgst', 'igst'],
        patterns: [/\btax\b/i, /\bgst\b/i, /\bvat\b/i],
        priority: 7
      },
      {
        type: 'discount',
        keywords: ['discount', 'off', 'reduction'],
        patterns: [/discount/i],
        priority: 6
      },
      {
        type: 'service_charge',
        keywords: ['room charges', 'consultation', 'lab tests', 'medicines', 'charges'],
        patterns: [/charges/i, /consultation/i],
        priority: 5
      }
    ];
  }

  findContextSnippets(text) {
    const snippets = text.split(/[|\n\r]+/).map(s => s.trim()).filter(s => s.length > 0);
    logger.info(`Found ${snippets.length} context snippets: ${JSON.stringify(snippets)}`);
    return snippets;
  }

  /**
   * Extract and normalize amounts from a snippet - MUST match OCR logic exactly
   */
  extractAmountsFromSnippet(snippet) {
    const amounts = [];
    
    // Use comprehensive pattern that catches all cases
    const patterns = [
      // Pattern 1: Currency symbol followed by number
      /(?:Rs\.?|INR|USD|EUR|GBP|\$|€|£|₹)\s*([l1IO0-9,]+(?:\.[l1IO0-9]{1,2})?)/gi,
      // Pattern 2: Colon followed by optional currency and number
      /:\s*(?:Rs\.?|INR|\$|€|£|₹)?\s*([l1IO0-9,]+(?:\.[l1IO0-9]{1,2})?)/gi,
    ];

    logger.debug(`Extracting amounts from: "${snippet}"`);
    
    for (const pattern of patterns) {
      pattern.lastIndex = 0; // Reset regex state
      const matches = [...snippet.matchAll(pattern)];
      
      for (const match of matches) {
        let valueStr = match[1];
        if (!valueStr) continue;
        
        logger.debug(`  Raw match: "${match[0]}" -> captured: "${valueStr}"`);
        
        // Apply EXACT normalization
        const normalized = valueStr
          .replace(/[,\s]/g, '')
          .replace(/[lL]/g, '1')
          .replace(/[iI]/g, '1')
          .replace(/O/g, '0');
        
        logger.debug(`  Normalized: "${valueStr}" -> "${normalized}"`);
        
        const value = parseFloat(normalized);
        
        if (Number.isFinite(value) && value > 0) {
          const roundedValue = Math.round(value * 100) / 100;
          amounts.push({
            value: roundedValue,
            raw: match[0],
            position: match.index
          });
          logger.debug(`  ✓ Extracted value: ${roundedValue}`);
        } else {
          logger.debug(`  ✗ Invalid value after parsing: ${value}`);
        }
      }
    }

    // Remove duplicate values within this snippet
    const uniqueAmounts = [...new Map(amounts.map(a => [a.value, a])).values()];
    logger.debug(`  Total unique amounts extracted: ${uniqueAmounts.length}`);
    
    return uniqueAmounts;
  }

  /**
   * Match snippet to classification type
   */
  matchSnippetToType(snippet) {
    const lowerSnippet = snippet.toLowerCase();
    let bestMatch = null;
    let highestScore = 0;

    logger.debug(`Matching snippet to type: "${snippet}"`);

    for (const rule of this.classificationRules) {
      let score = 0;
      let matchedKeywords = [];
      let patternMatched = false;

      // Check patterns
      for (const pattern of (rule.patterns || [])) {
        pattern.lastIndex = 0;
        if (pattern.test(snippet)) {
          score += rule.priority * 2;
          patternMatched = true;
          logger.debug(`  Pattern matched for ${rule.type}`);
          break;
        }
      }

      // Check keywords
      for (const keyword of rule.keywords) {
        if (lowerSnippet.includes(keyword.toLowerCase())) {
          score += rule.priority;
          matchedKeywords.push(keyword);
        }
      }

      if (score > highestScore) {
        highestScore = score;
        bestMatch = {
          type: rule.type,
          confidence: Math.min(0.95, 0.5 + (score / 30)),
          keywords: matchedKeywords,
          patternMatched,
          score
        };
      }
    }

    if (bestMatch) {
      logger.debug(`  Best match: ${bestMatch.type} (score: ${bestMatch.score}, confidence: ${bestMatch.confidence.toFixed(2)})`);
    } else {
      logger.debug(`  No match found`);
    }

    return bestMatch;
  }

  /**
   * Main classification method
   */
  classifyAmounts(text, normalizedAmounts) {
    if (!text || !normalizedAmounts || normalizedAmounts.length === 0) {
      logger.warn('No text or normalized amounts provided');
      return { amounts: [], confidence: 0.0, classification_details: [] };
    }

    logger.info(`\n========== CLASSIFICATION START ==========`);
    logger.info(`Normalized amounts to classify: ${JSON.stringify(normalizedAmounts)}`);

    const snippets = this.findContextSnippets(text);
    const amounts = [];
    const classificationDetails = [];
    const amountUsage = new Map(normalizedAmounts.map(a => [a, false]));

    // Track which type+value combinations we've seen
    const classifiedPairs = new Set();

    // Phase 1: Context-based classification
    for (let i = 0; i < snippets.length; i++) {
      const snippet = snippets[i];
      logger.info(`\n--- Snippet ${i + 1}/${snippets.length}: "${snippet}" ---`);
      
      const snippetAmounts = this.extractAmountsFromSnippet(snippet);
      logger.info(`Extracted ${snippetAmounts.length} amount(s) from snippet`);
      
      if (snippetAmounts.length === 0) {
        logger.warn(`No amounts extracted from snippet: "${snippet}"`);
        continue;
      }

      for (const { value } of snippetAmounts) {
        logger.info(`\nProcessing extracted value: ${value}`);
        
        // Find matching normalized amount
        const matchedAmount = normalizedAmounts.find(na => Math.abs(na - value) < 0.01);

        if (!matchedAmount) {
          logger.warn(`  No matching normalized amount for ${value}`);
          logger.warn(`  Available normalized amounts: ${JSON.stringify(normalizedAmounts)}`);
          continue;
        }

        logger.info(`  ✓ Matched with normalized amount: ${matchedAmount}`);

        // Get classification type
        const classification = this.matchSnippetToType(snippet);

        if (!classification) {
          logger.warn(`  Could not classify snippet`);
          continue;
        }

        if (classification.confidence <= 0.5) {
          logger.warn(`  Classification confidence too low: ${classification.confidence}`);
          continue;
        }

        // Check if we've already classified this exact type+value combination
        const pairKey = `${classification.type}:${matchedAmount}`;
        if (classifiedPairs.has(pairKey)) {
          logger.info(`  Already classified this pair: ${pairKey}, skipping`);
          continue;
        }

        // Add classification
        const truncatedSnippet = snippet.length > 80 ? snippet.substring(0, 80) + '...' : snippet;
        
        amounts.push({
          type: classification.type,
          value: matchedAmount,
          source: `text: '${truncatedSnippet}'`,
          confidence: classification.confidence
        });

        classificationDetails.push({
          amount: matchedAmount,
          snippet: snippet,
          type: classification.type,
          matched_keywords: classification.keywords,
          pattern_matched: classification.patternMatched
        });

        classifiedPairs.add(pairKey);
        amountUsage.set(matchedAmount, true);
        
        logger.info(`  ✓✓✓ CLASSIFIED: ${matchedAmount} as '${classification.type}' from: "${truncatedSnippet}"`);
      }
    }

    logger.info(`\n========== CLASSIFICATION COMPLETE ==========`);
    logger.info(`Successfully classified: ${amounts.length}/${normalizedAmounts.length} amounts`);

    // Calculate confidence
    const confidence = this.calculateClassificationConfidence(amounts, normalizedAmounts.length);

    return {
      amounts: amounts.map(a => ({ type: a.type, value: a.value, source: a.source })),
      confidence: parseFloat(confidence.toFixed(2)),
      classification_details: classificationDetails
    };
  }

  calculateClassificationConfidence(amounts, totalAmounts) {
    if (totalAmounts === 0) return 0;

    const classificationRate = amounts.length / totalAmounts;
    let confidence = 0.4 + (classificationRate * 0.3);

    const explicitMatches = amounts.filter(a => !a.source?.includes('heuristic')).length;
    if (amounts.length > 0) {
      confidence += (explicitMatches / amounts.length) * 0.3;
    }

    const types = new Set(amounts.map(a => a.type));
    if (types.has('total_bill')) confidence += 0.05;
    if (types.has('paid')) confidence += 0.05;
    if (types.has('due')) confidence += 0.05;

    return Math.max(config.minClassificationConfidence || 0.3, Math.min(0.95, confidence));
  }

  validateClassification(amounts) {
    const issues = [];
    const typeMap = {};
    
    for (const amount of amounts) {
      if (!typeMap[amount.type]) {
        typeMap[amount.type] = [];
      }
      typeMap[amount.type].push(amount.value);
    }

    const singletonTypes = ['total_bill', 'subtotal', 'paid'];
    for (const type of singletonTypes) {
      if (typeMap[type] && typeMap[type].length > 1) {
        issues.push(`Multiple ${type} amounts found: ${typeMap[type].join(', ')}`);
      }
    }

    if (typeMap.total_bill && typeMap.paid && typeMap.due) {
      const total = typeMap.total_bill[0];
      const paid = typeMap.paid[0];
      const due = Math.max(...typeMap.due);
      const expectedDue = total - paid;
      
      if (Math.abs(expectedDue - due) > 1) {
        issues.push(`Inconsistent amounts: Total(${total}) - Paid(${paid}) ≠ Due(${due})`);
      }
    }

    return {
      valid: issues.length === 0,
      issues: issues
    };
  }
}



module.exports = new ClassifierService();