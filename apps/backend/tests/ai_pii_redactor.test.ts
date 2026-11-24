import { describe, it, expect } from 'vitest';
import { PiiRedactor, normalizeIndicNumerals } from '../src/ai/pii_redactor';

describe('PiiRedactor Unit Tests', () => {
  describe('Numeral Normalization', () => {
    it('normalizes Devanagari numerals to ASCII digits', () => {
      expect(normalizeIndicNumerals('०१२३४५६७८९')).toBe('0123456789');
    });

    it('normalizes Gujarati numerals to ASCII digits', () => {
      expect(normalizeIndicNumerals('૦૧૨૩૪૫૬૭૮૯')).toBe('0123456789');
    });

    it('leaves standard ASCII digits and text untouched', () => {
      expect(normalizeIndicNumerals('Hello 123 World!')).toBe('Hello 123 World!');
    });
  });

  describe('International & Domestic Phone Redaction', () => {
    it('masks complete unspaced international numbers with + prefix', () => {
      const res1 = PiiRedactor.redact('Call me at +919876543210 immediately.');
      expect(res1.sanitizedText).toBe('Call me at [PHONE] immediately.');
      expect(res1.counts.phones).toBe(1);

      const res2 = PiiRedactor.redact('US support line is +14155552671.');
      expect(res2.sanitizedText).toBe('US support line is [PHONE].');
      expect(res2.counts.phones).toBe(1);
    });

    it('masks separated international numbers with country codes', () => {
      const res1 = PiiRedactor.redact('Reach us at +91 98765 43210.');
      expect(res1.sanitizedText).toBe('Reach us at [PHONE].');

      const res2 = PiiRedactor.redact('Contact +1 (415) 555-2671 for help.');
      expect(res2.sanitizedText).toBe('Contact [PHONE] for help.');

      const res3 = PiiRedactor.redact('UK office: +44 20 7946 0958.');
      expect(res3.sanitizedText).toBe('UK office: [PHONE].');
    });

    it('masks domestic Indian 10-digit mobile numbers', () => {
      const res1 = PiiRedactor.redact('My mobile is 9876543210.');
      expect(res1.sanitizedText).toBe('My mobile is [PHONE].');

      const res2 = PiiRedactor.redact('Alternative number 87654 32109.');
      expect(res2.sanitizedText).toBe('Alternative number [PHONE].');
    });

    it('masks phone numbers written in Devanagari and Gujarati numerals', () => {
      const resGu = PiiRedactor.redact('મારો નંબર ૯૮૭૬૫૪૩૨૧૦ છે.');
      expect(resGu.sanitizedText).toBe('મારો નંબર [PHONE] છે.');
      expect(resGu.counts.phones).toBe(1);

      const resHi = PiiRedactor.redact('मेरा फोन ९८७६५४३२१० है।');
      expect(resHi.sanitizedText).toBe('मेरा फोन [PHONE] है।');
      expect(resHi.counts.phones).toBe(1);

      const resGuIntl = PiiRedactor.redact('ફોન કરો: +૯૧ ૯૮૭૬૫ ૪૩૨૧૦.');
      expect(resGuIntl.sanitizedText).toBe('ફોન કરો: [PHONE].');
      expect(resGuIntl.counts.phones).toBe(1);
    });
  });

  describe('National IDs & Payment Cards', () => {
    it('masks 12-digit Aadhaar-like IDs with spaces or hyphens', () => {
      const res1 = PiiRedactor.redact('Aadhaar number: 1234 5678 9012.');
      expect(res1.sanitizedText).toBe('Aadhaar number: [ID_REDACTED].');
      expect(res1.counts.ids).toBe(1);

      const res2 = PiiRedactor.redact('ID is 1234-5678-9012.');
      expect(res2.sanitizedText).toBe('ID is [ID_REDACTED].');

      const res3 = PiiRedactor.redact('Contiguous ID 123456789012.');
      expect(res3.sanitizedText).toBe('Contiguous ID [ID_REDACTED].');
    });

    it('masks Aadhaar IDs written in Devanagari numerals', () => {
      const res = PiiRedactor.redact('आधार कार्ड: १२३४ ५६७८ ९०१२.');
      expect(res.sanitizedText).toBe('आधार कार्ड: [ID_REDACTED].');
      expect(res.counts.ids).toBe(1);
    });

    it('masks 16-digit payment card numbers', () => {
      const res1 = PiiRedactor.redact('Card 4111 2222 3333 4444 charged twice.');
      expect(res1.sanitizedText).toBe('Card [CARD_REDACTED] charged twice.');
      expect(res1.counts.cards).toBe(1);

      const res2 = PiiRedactor.redact('Charged 4111-2222-3333-4444.');
      expect(res2.sanitizedText).toBe('Charged [CARD_REDACTED].');
    });
  });

  describe('Email Addresses', () => {
    it('masks standard and tagged email addresses', () => {
      const res = PiiRedactor.redact('Send invoice to user@example.com or support+test@domain.co.in.');
      expect(res.sanitizedText).toBe('Send invoice to [EMAIL] or [EMAIL].');
      expect(res.counts.emails).toBe(2);
    });
  });

  describe('False Positives & Non-PII Numbers', () => {
    it('does not mask 6-digit postal PIN codes or ZIP codes', () => {
      const res = PiiRedactor.redact('Delivered to Ahmedabad PIN 380015 and Delhi 110001.');
      expect(res.sanitizedText).toBe('Delivered to Ahmedabad PIN 380015 and Delhi 110001.');
      expect(res.hasRedactions).toBe(false);
    });

    it('does not mask order numbers, room numbers, or dates', () => {
      const res = PiiRedactor.redact('Order #123456 in Room 402 on 24/11/2026.');
      expect(res.sanitizedText).toBe('Order #123456 in Room 402 on 24/11/2026.');
      expect(res.hasRedactions).toBe(false);
    });

    it('does not mask product models or prices', () => {
      const res = PiiRedactor.redact('Bought iPhone 15 for ₹50000 on Boeing 737.');
      expect(res.sanitizedText).toBe('Bought iPhone 15 for ₹50000 on Boeing 737.');
      expect(res.hasRedactions).toBe(false);
    });
  });

  describe('Pattern Execution Order', () => {
    it('masks +919876543210 as a phone number rather than a 12-digit ID with leading +', () => {
      const res = PiiRedactor.redact('Contact: +919876543210.');
      expect(res.sanitizedText).toBe('Contact: [PHONE].');
      expect(res.counts.phones).toBe(1);
      expect(res.counts.ids).toBe(0);
    });
  });
});
