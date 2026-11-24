/**
 * Deterministic PII Redaction Utility.
 *
 * Masks email addresses, payment card numbers, international/domestic phone numbers,
 * and 12-digit Aadhaar-like IDs before feedback is transmitted to any AI provider.
 *
 * NOTE: Regex-based masking is best-effort defense in depth, not an absolute
 * guarantee of complete natural-language PII elimination.
 */

/**
 * Normalizes Devanagari and Gujarati numerals to standard ASCII 0-9 digits.
 */
export function normalizeIndicNumerals(text: string): string {
  return text
    .replace(/[\u0966-\u096F]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x0966 + 48))
    .replace(/[\u0AE6-\u0AEF]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0x0AE6 + 48));
}

export interface RedactionResult {
  sanitizedText: string;
  hasRedactions: boolean;
  counts: {
    emails: number;
    cards: number;
    phones: number;
    ids: number;
  };
}

export class PiiRedactor {
  // 1. Email Addresses
  private static readonly EMAIL_REGEX =
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

  // 2. 16-Digit Payment Cards (blocks of 4 or 16 contiguous digits)
  private static readonly CARD_REGEX =
    /\b(?:\d{4}[ -]?){3}\d{4}\b/g;

  // 3. International Phone with '+' prefix (allows +CountryCode and varying digit groupings)
  // Lookbehind (?<=^|[^\w+]) avoids word boundary failure for leading '+'
  private static readonly INTL_PHONE_REGEX =
    /(?:(?<=^|[^\w+]))\+[1-9]\d{0,2}[\s.-]?(?:\(?\d{1,5}\)?[\s.-]?)?\d{2,5}[\s.-]?\d{3,5}\b/g;

  // 4. 12-Digit IDs (Aadhaar-like format: 4-4-4 or 12 continuous digits)
  private static readonly ID_REGEX =
    /\b\d{4}[ -]\d{4}[ -]\d{4}\b|\b\d{12}\b/g;

  // 5. Domestic Phone numbers (Indian mobile starting 6-9, or US formatted (xxx) xxx-xxxx or xxx-xxx-xxxx)
  private static readonly DOMESTIC_PHONE_REGEX =
    /\b(?:[6-9]\d{4}[\s.-]?\d{5}|[6-9]\d{9}|(?:\(?\d{3}\)?[\s.-])\d{3}[\s.-]\d{4})\b/g;

  /**
   * Redacts detectable PII from the input text.
   * Operates on a normalized digit copy to ensure Devanagari and Gujarati numerals are matched.
   */
  public static redact(input: string): RedactionResult {
    let text = normalizeIndicNumerals(input);
    let hasRedactions = false;
    const counts = { emails: 0, cards: 0, phones: 0, ids: 0 };

    // Step 1: Emails
    text = text.replace(this.EMAIL_REGEX, () => {
      hasRedactions = true;
      counts.emails++;
      return '[EMAIL]';
    });

    // Step 2: Payment Cards
    text = text.replace(this.CARD_REGEX, () => {
      hasRedactions = true;
      counts.cards++;
      return '[CARD_REDACTED]';
    });

    // Step 3: International Phone Numbers with '+' (Must run before 12-digit ID check)
    text = text.replace(this.INTL_PHONE_REGEX, () => {
      hasRedactions = true;
      counts.phones++;
      return '[PHONE]';
    });

    // Step 4: 12-digit Aadhaar-like IDs
    text = text.replace(this.ID_REGEX, () => {
      hasRedactions = true;
      counts.ids++;
      return '[ID_REDACTED]';
    });

    // Step 5: Domestic Phone numbers
    text = text.replace(this.DOMESTIC_PHONE_REGEX, () => {
      hasRedactions = true;
      counts.phones++;
      return '[PHONE]';
    });

    return {
      sanitizedText: text,
      hasRedactions,
      counts,
    };
  }
}
