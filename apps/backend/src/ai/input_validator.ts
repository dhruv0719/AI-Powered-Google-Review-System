import { AiAssistantConstants, InputValidationResult } from './types.js';

export class MeaningfulInputValidator {
  // Singleton grapheme segmenter for user-perceived cluster counting
  private static readonly graphemeSegmenter = new Intl.Segmenter(undefined, {
    granularity: 'grapheme',
  });

  // Cached word segmenters per supported language
  private static readonly wordSegmenters: Record<string, Intl.Segmenter> = {
    en: new Intl.Segmenter('en', { granularity: 'word' }),
    hi: new Intl.Segmenter('hi', { granularity: 'word' }),
    gu: new Intl.Segmenter('gu', { granularity: 'word' }),
  };

  // Enforces at least 7 consecutive characters along a standard QWERTY keyboard row
  private static readonly LATIN_HOME_ROW_REGEX =
    /(?:asdfghj|sdfghjk|dfghjkl|qwertyu|wertyui|ertyuio|rtyuiop|zxcvbnm|lkjhgfd|kjhgfdsa|poiuytr|oiuytre|iuytrew|uytrewq|mnbvcxz)/i;

  // Enforces >= 9 consecutive Latin consonants to avoid false positives on words like 'strengths' or 'catchphrase'
  private static readonly LATIN_CONSONANT_RUN_REGEX =
    /[bcdfghjklmnpqrstvwxyz]{9,}/i;

  /**
   * Helper to count graphemes of any string.
   */
  public static countGraphemes(text: string): number {
    const normalized = text.normalize('NFC').trim();
    if (normalized.length === 0) return 0;
    return Array.from(this.graphemeSegmenter.segment(normalized)).length;
  }

  /**
   * Validates customer feedback according to multilingual, length, and anti-spam heuristics.
   */
  public static validate(rawInput: string, languageHint?: string): InputValidationResult {
    const normalized = rawInput.normalize('NFC').trim();
    if (normalized.length === 0) {
      return {
        isValid: true,
        graphemeCount: 0,
        wordCount: 0,
      };
    }

    // 1. Grapheme cluster extraction
    const graphemeSegments = Array.from(
      this.graphemeSegmenter.segment(normalized),
      (s) => s.segment
    );
    const graphemeCount = graphemeSegments.length;

    // 2. Grapheme length bounds
    if (graphemeCount > AiAssistantConstants.MAX_FEEDBACK_LENGTH) {
      return {
        isValid: false,
        reasonCode: 'INPUT_TOO_LONG',
        message: `Feedback cannot exceed ${AiAssistantConstants.MAX_FEEDBACK_LENGTH} characters`,
      };
    }

    // 3. Substantive word extraction
    const langKey = languageHint && languageHint in this.wordSegmenters ? languageHint : 'en';
    const wordSegmenter = this.wordSegmenters[langKey];
    const wordSegments = Array.from(wordSegmenter.segment(normalized));

    const substantiveWords = wordSegments
      .filter((s) => s.isWordLike && /[\p{L}\p{N}]/u.test(s.segment))
      .map((s) => s.segment);

    // 4. Repeated grapheme flood check (consecutive run >= 8)
    let maxRun = 1;
    let currentRun = 1;
    for (let i = 1; i < graphemeSegments.length; i++) {
      if (graphemeSegments[i] === graphemeSegments[i - 1]) {
        currentRun++;
        if (currentRun > maxRun) {
          maxRun = currentRun;
        }
      } else {
        currentRun = 1;
      }
    }

    if (maxRun >= 8) {
      return {
        isValid: false,
        reasonCode: 'REPEATED_GRAPHEME_FLOOD',
        message: 'Feedback contains excessive repeated characters',
      };
    }

    // 5. Low character diversity check
    const nonWs = graphemeSegments.filter((g) => g.trim().length > 0);
    const distinctGraphemes = new Set(nonWs.map((g) => g.toLowerCase()));

    if (nonWs.length >= 6 && distinctGraphemes.size <= 2) {
      return {
        isValid: false,
        reasonCode: 'LOW_CHARACTER_DIVERSITY',
        message: 'Feedback lacks sufficient character diversity',
      };
    }

    // Check single character dominance (> 75% of non-whitespace characters)
    const charCounts = new Map<string, number>();
    for (const g of nonWs) {
      const lower = g.toLowerCase();
      charCounts.set(lower, (charCounts.get(lower) || 0) + 1);
    }
    for (const count of charCounts.values()) {
      if (nonWs.length >= 4 && count / nonWs.length > 0.75) {
        return {
          isValid: false,
          reasonCode: 'LOW_CHARACTER_DIVERSITY',
          message: 'Feedback is dominated by a single repeated character',
        };
      }
    }

    // 6. Latin-only keyboard mash detection (Never applied to Indic text)
    for (const word of substantiveWords) {
      // Only evaluate purely Latin words
      if (/^[a-zA-Z]+$/.test(word)) {
        if (this.LATIN_HOME_ROW_REGEX.test(word)) {
          return {
            isValid: false,
            reasonCode: 'LATIN_KEYBOARD_MASH',
            message: 'Feedback contains invalid keyboard patterns',
          };
        }

        if (this.LATIN_CONSONANT_RUN_REGEX.test(word)) {
          return {
            isValid: false,
            reasonCode: 'LATIN_KEYBOARD_MASH',
            message: 'Feedback contains unpronounceable consonant clusters',
          };
        }
      }
    }

    return {
      isValid: true,
      graphemeCount,
      wordCount: substantiveWords.length,
    };
  }
}
