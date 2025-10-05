const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config/config');

class LLMService {
  constructor() {
    this.enabled = !!config.openaiApiKey;
    this.apiKey = config.openaiApiKey;
    this.model = config.openaiModel;
  }

  /**
   * Validate classification results using LLM
   */
  async validateClassification(text, amounts) {
    if (!this.enabled) {
      logger.info('LLM validation skipped - API key not configured');
      return {
        validated: false,
        suggestions: [],
        reason: 'LLM validation not enabled'
      };
    }

    try {
      const prompt = this.buildValidationPrompt(text, amounts);
      
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: this.model,
          messages: [
            {
              role: 'system',
              content: 'You are an expert at analyzing medical bills and receipts. Validate the extracted amounts and their classifications.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: 500
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      const result = response.data.choices[0].message.content;
      logger.info('LLM validation completed');

      return this.parseValidationResponse(result);
    } catch (error) {
      logger.error('LLM validation failed:', error.message);
      return {
        validated: false,
        suggestions: [],
        reason: `LLM error: ${error.message}`
      };
    }
  }

  /**
   * Build validation prompt for LLM
   */
  buildValidationPrompt(text, amounts) {
    const amountsList = amounts
      .map(a => `- ${a.type}: ${a.value}`)
      .join('\n');

    return `
Analyze this bill/receipt text and validate the extracted amounts:

TEXT:
${text}

EXTRACTED AMOUNTS:
${amountsList}

Please validate:
1. Are the amounts correctly identified?
2. Are the classifications (total_bill, paid, due, etc.) accurate?
3. Are there any missing amounts?
4. Are there any logical inconsistencies?

Respond in JSON format:
{
  "valid": true/false,
  "issues": ["list of issues found"],
  "suggestions": ["suggestions for corrections"]
}
    `.trim();
  }

  /**
   * Parse LLM validation response
   */
  parseValidationResponse(response) {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          validated: true,
          valid: parsed.valid || false,
          issues: parsed.issues || [],
          suggestions: parsed.suggestions || []
        };
      }

      // Fallback if JSON parsing fails
      return {
        validated: true,
        valid: true,
        issues: [],
        suggestions: [],
        raw_response: response
      };
    } catch (error) {
      logger.error('Failed to parse LLM response:', error);
      return {
        validated: false,
        reason: 'Failed to parse LLM response'
      };
    }
  }

  /**
   * Enhance classification with LLM suggestions
   */
  async enhanceClassification(text, amounts) {
    if (!this.enabled) {
      return amounts;
    }

    try {
      const validation = await this.validateClassification(text, amounts);
      
      if (validation.validated && validation.suggestions.length > 0) {
        logger.info(`LLM provided ${validation.suggestions.length} suggestions`);
        // For now, just log suggestions
        // In production, you might want to apply them selectively
      }

      return amounts;
    } catch (error) {
      logger.error('LLM enhancement failed:', error);
      return amounts;
    }
  }
}

module.exports = new LLMService();