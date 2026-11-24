import { AiAssistantConstants, MAX_DRAFT_LENGTH, OutputValidationResult } from './types.js';
import { normalizeIndicNumerals } from './pii_redactor.js';

interface NumericEntity {
  val: string;
  unit: string | null;
}

export class OutputValidationPipeline {
  private static readonly graphemeSegmenter = new Intl.Segmenter(undefined, {
    granularity: 'grapheme',
  });

  // Canonical Currencies
  private static readonly CANONICAL_CURRENCIES: Record<string, string> = {
    '₹': 'INR',
    'rs': 'INR',
    'rs.': 'INR',
    'rupees': 'INR',
    'રૂપિયા': 'INR',
    'रुपये': 'INR',
    'inr': 'INR',
    '$': 'USD',
    'usd': 'USD',
    '€': 'EUR',
    'eur': 'EUR',
  };

  // Canonical Duration and Measure Units
  private static readonly CANONICAL_UNITS: Record<string, string> = {
    'hour': 'HOUR',
    'hours': 'HOUR',
    'hr': 'HOUR',
    'hrs': 'HOUR',
    'કલાક': 'HOUR',
    'घंटे': 'HOUR',
    'minute': 'MINUTE',
    'minutes': 'MINUTE',
    'min': 'MINUTE',
    'mins': 'MINUTE',
    'મિનિટ': 'MINUTE',
    'मिनट': 'MINUTE',
    'day': 'DAY',
    'days': 'DAY',
    'દિવસ': 'DAY',
    'दिन': 'DAY',
    'week': 'WEEK',
    'weeks': 'WEEK',
    'month': 'MONTH',
    'months': 'MONTH',
    'મહિના': 'MONTH',
    'महीने': 'MONTH',
    'year': 'YEAR',
    'years': 'YEAR',
    'વર્ષ': 'YEAR',
    'साल': 'YEAR',
    '%': 'PERCENT',
    'percent': 'PERCENT',
  };

  // Redaction placeholders that must never appear in customer drafts
  private static readonly PLACEHOLDER_LEAK_REGEX =
    /\[(?:PHONE|EMAIL|ID_REDACTED|CARD_REDACTED)\]/;

  // Meta-text / AI Preambles
  private static readonly META_TEXT_REGEX =
    /(?:here(?:'s| is) (?:a |the |your )?(?:polished |rewritten |revised )?(?:draft|review)|as an ai|i am an ai|language model|hope this helps|i have polished|यहाँ (?:आपका|प्रस्तुत)|यहाँ एक समीक्षा|અહીં તમારી|હું એઆઈ|ભાષા મોડેલ)/i;

  // External URLs and Web Domains
  private static readonly PROHIBITED_URL_REGEX =
    /(?:https?|ftp):\/\/[^\s]+|\bwww\.[^\s]+|\b[a-z0-9-]+(?:\.com|\.org|\.net|\.io|\.co|\.in)\b/i;

  // Sentiment Lexicons
  private static readonly GRIEVANCE_WORDS = [
    'terrible', 'awful', 'worst', 'rude', 'dirty', 'horrible', 'disaster', 'poor', 'bad',
    'खराब', 'घटिया', 'बकवास', 'गंदा', 'बुरा', 'बेकार',
    'ખરાબ', 'તોછડું', 'ગંદુ', 'નકામું', 'બકવાસ',
  ];

  private static readonly PRAISE_WORDS = [
    'must visit', 'highly recommend', 'loved it', 'amazing', 'wonderful', 'best place', 'outstanding', 'five stars', '5 stars',
    'ज़रूर जाएं', 'सर्वश्रेष्ठ', 'बहुत बढ़िया', 'लाजवाब', 'शानदार', 'अद्भुत',
    'જરૂર મુલાકાત લો', 'સર્વશ્રેષ્ઠ', 'ખૂબ સરસ', 'લાજવાબ', 'શાનદાર', 'અદ્ભુત',
  ];

  private static readonly NEGATION_PHRASES = [
    'not good', 'not fresh', 'not satisfied', 'not clean', 'never recommend',
    'સંતોષ નથી', 'સારું નથી', 'તાજું નથી',
    'अच्छा नहीं', 'संतुष्ट नहीं', 'साफ नहीं',
  ];

  /**
   * Helper to extract numeric entities and their adjacent canonical units/currencies.
   */
  private static extractNumericEntities(text: string): NumericEntity[] {
    const norm = normalizeIndicNumerals(text);
    const regex =
      /(?:(₹|rs\.?|rupees|રૂપિયા|रुपये|\$|usd|inr|€|eur)\s*)?(\d+(?:\.\d+)?)\s*(%|percent|₹|rs\.?|rupees|રૂપિયા|रुपये|\$|hours?|hrs?|minutes?|mins?|days?|weeks?|months?|years?|કલાક|મિનિટ|દિવસ|મહિના|વર્ષ|घंटे|मिनट|दिन|महीने|साल)?/gi;

    const entities: NumericEntity[] = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(norm)) !== null) {
      if (match[2]) {
        const prefix = (match[1] || '').trim().toLowerCase();
        const suffix = (match[3] || '').trim().toLowerCase();

        const unit =
          this.CANONICAL_CURRENCIES[prefix] ||
          this.CANONICAL_CURRENCIES[suffix] ||
          this.CANONICAL_UNITS[suffix] ||
          null;

        entities.push({
          val: match[2],
          unit,
        });
      }
    }

    return entities;
  }

  /**
   * Validates generated review draft against source text and security guardrails.
   */
  public static validate(
    candidateDraft: string,
    sanitizedSourceText: string
  ): OutputValidationResult {
    const draft = candidateDraft.trim();

    // 1. Grapheme length validation
    const graphemeCount = Array.from(this.graphemeSegmenter.segment(draft)).length;

    if (graphemeCount < AiAssistantConstants.MIN_FEEDBACK_LENGTH) {
      return {
        isValid: false,
        reasonCode: 'OUTPUT_TOO_SHORT',
        message: `Draft must be at least ${AiAssistantConstants.MIN_FEEDBACK_LENGTH} characters`,
      };
    }

    if (graphemeCount > MAX_DRAFT_LENGTH) {
      return {
        isValid: false,
        reasonCode: 'OUTPUT_TOO_LONG',
        message: `Draft exceeds maximum length of ${MAX_DRAFT_LENGTH} characters`,
      };
    }

    // 2. Prohibited Redaction Placeholder Leakage
    if (this.PLACEHOLDER_LEAK_REGEX.test(draft)) {
      return {
        isValid: false,
        reasonCode: 'PROHIBITED_PLACEHOLDER_LEAK',
        message: 'Draft contains an unreplaced redaction placeholder',
      };
    }

    // 3. Meta-Text & AI Preambles
    if (this.META_TEXT_REGEX.test(draft)) {
      return {
        isValid: false,
        reasonCode: 'META_TEXT_DETECTED',
        message: 'Draft contains conversational meta-text or preamble',
      };
    }

    // 4. Prohibited External URLs
    if (this.PROHIBITED_URL_REGEX.test(draft)) {
      return {
        isValid: false,
        reasonCode: 'PROHIBITED_URL_DETECTED',
        message: 'Draft contains an unapproved external URL or link',
      };
    }

    // 5. Numeric and Unit Grounding
    const sourceEntities = this.extractNumericEntities(sanitizedSourceText);
    const draftEntities = this.extractNumericEntities(draft);

    for (const draftEnt of draftEntities) {
      // Find matching number in source
      const matchingSource = sourceEntities.find((s) => s.val === draftEnt.val);

      if (!matchingSource) {
        return {
          isValid: false,
          reasonCode: 'UNGROUNDED_NUMERIC_ENTITY',
          message: `Draft introduces ungrounded number: ${draftEnt.val}`,
        };
      }

      // If draft associated a unit/currency, verify source also had it
      if (draftEnt.unit !== null) {
        if (matchingSource.unit !== draftEnt.unit) {
          return {
            isValid: false,
            reasonCode: 'UNGROUNDED_NUMERIC_ENTITY',
            message: `Draft altered unit/currency for ${draftEnt.val} to ${draftEnt.unit}`,
          };
        }
      }
    }

    // 6. Conservative Sentiment Preservation
    const lowerSource = sanitizedSourceText.toLowerCase();
    const lowerDraft = draft.toLowerCase();

    // Check if input was purely negative
    const hasGrievance = this.GRIEVANCE_WORDS.some((w) => lowerSource.includes(w));
    const hasPositiveInSource = this.PRAISE_WORDS.some((w) => lowerSource.includes(w));

    if (hasGrievance && !hasPositiveInSource) {
      const hasHallucinatedPraise = this.PRAISE_WORDS.some((w) => lowerDraft.includes(w));
      if (hasHallucinatedPraise) {
        return {
          isValid: false,
          reasonCode: 'SENTIMENT_INVERSION_DETECTED',
          message: 'Draft inverts negative feedback into promotional praise',
        };
      }
    }

    // Check negation dropping (e.g. input had 'not good', draft has 'good' without negation)
    for (const negPhrase of this.NEGATION_PHRASES) {
      if (lowerSource.includes(negPhrase)) {
        // If draft drops the negation phrase
        const keyWord = negPhrase.replace(/^(?:not|સારું|સંતોષ|अच्छा|संतुष्ट)\s*/, '');
        if (keyWord.length > 2 && lowerDraft.includes(keyWord) && !lowerDraft.includes(negPhrase)) {
          return {
            isValid: false,
            reasonCode: 'SENTIMENT_INVERSION_DETECTED',
            message: 'Draft dropped explicit negation present in feedback',
          };
        }
      }
    }

    return {
      isValid: true,
      graphemeCount,
      draft,
    };
  }
}
