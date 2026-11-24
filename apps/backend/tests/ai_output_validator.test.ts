import { describe, it, expect } from 'vitest';
import { OutputValidationPipeline } from '../src/ai/output_validator';

describe('OutputValidationPipeline Unit Tests', () => {
  describe('Draft Grapheme Length Bounds', () => {
    it('rejects candidate draft shorter than 10 graphemes (OUTPUT_TOO_SHORT)', () => {
      const res = OutputValidationPipeline.validate('Too short', 'Valid customer feedback text.');
      expect(res.isValid).toBe(false);
      if (!res.isValid) {
        expect(res.reasonCode).toBe('OUTPUT_TOO_SHORT');
      }
    });

    it('rejects candidate draft exceeding 600 graphemes (OUTPUT_TOO_LONG)', () => {
      const longDraft = 'The service was very prompt and the food was great. '.repeat(13); // > 600 graphemes
      const res = OutputValidationPipeline.validate(longDraft, 'Valid feedback.');
      expect(res.isValid).toBe(false);
      if (!res.isValid) {
        expect(res.reasonCode).toBe('OUTPUT_TOO_LONG');
      }
    });

    it('accepts candidate draft within 10 to 600 graphemes', () => {
      const draft = 'The service was prompt and the staff was courteous.';
      const res = OutputValidationPipeline.validate(draft, 'service was prompt, staff courteous');
      expect(res.isValid).toBe(true);
      if (res.isValid) {
        expect(res.draft).toBe(draft);
      }
    });
  });

  describe('Prohibited Redaction Placeholders', () => {
    it('rejects candidate draft containing [PHONE] placeholder', () => {
      const res = OutputValidationPipeline.validate(
        'Call us back at [PHONE] for details.',
        'Call us back for details.'
      );
      expect(res.isValid).toBe(false);
      if (!res.isValid) {
        expect(res.reasonCode).toBe('PROHIBITED_PLACEHOLDER_LEAK');
      }
    });

    it('rejects candidate draft containing [EMAIL] or [ID_REDACTED]', () => {
      const res = OutputValidationPipeline.validate(
        'Reach me at [EMAIL] with updates.',
        'Reach me with updates.'
      );
      expect(res.isValid).toBe(false);
      if (!res.isValid) {
        expect(res.reasonCode).toBe('PROHIBITED_PLACEHOLDER_LEAK');
      }
    });
  });

  describe('Meta-Text & AI Preambles', () => {
    it('rejects English conversational preambles', () => {
      const res1 = OutputValidationPipeline.validate(
        'Here is your review: The food was fresh.',
        'The food was fresh.'
      );
      expect(res1.isValid).toBe(false);
      if (!res1.isValid) {
        expect(res1.reasonCode).toBe('META_TEXT_DETECTED');
      }

      const res2 = OutputValidationPipeline.validate(
        'As an AI language model, I found the service quick.',
        'Service was quick.'
      );
      expect(res2.isValid).toBe(false);
      if (!res2.isValid) {
        expect(res2.reasonCode).toBe('META_TEXT_DETECTED');
      }
    });

    it('rejects Hindi and Gujarati conversational preambles', () => {
      const resHi = OutputValidationPipeline.validate(
        'यहाँ आपका ड्राफ्ट है: कमरा बहुत साफ था।',
        'कमरा बहुत साफ था।'
      );
      expect(resHi.isValid).toBe(false);
      if (!resHi.isValid) {
        expect(resHi.reasonCode).toBe('META_TEXT_DETECTED');
      }

      const resGu = OutputValidationPipeline.validate(
        'અહીં તમારી સમીક્ષા છે: સર્વિસ સારી હતી.',
        'સર્વિસ સારી હતી.'
      );
      expect(resGu.isValid).toBe(false);
      if (!resGu.isValid) {
        expect(resGu.reasonCode).toBe('META_TEXT_DETECTED');
      }
    });
  });

  describe('Prohibited External URLs', () => {
    it('rejects drafts containing web URLs and links', () => {
      const res1 = OutputValidationPipeline.validate(
        'Check out https://scam.example.com for photos.',
        'Check out photos.'
      );
      expect(res1.isValid).toBe(false);
      if (!res1.isValid) {
        expect(res1.reasonCode).toBe('PROHIBITED_URL_DETECTED');
      }

      const res2 = OutputValidationPipeline.validate(
        'Visit www.myblog.in for our review.',
        'Visit my blog for review.'
      );
      expect(res2.isValid).toBe(false);
      if (!res2.isValid) {
        expect(res2.reasonCode).toBe('PROHIBITED_URL_DETECTED');
      }
    });
  });

  describe('Numeric, Quantity, and Unit Grounding', () => {
    it('accepts matched numbers and canonical units', () => {
      const res = OutputValidationPipeline.validate(
        'We waited 2 hours and paid ₹500 for the service.',
        'waited 2 hours and paid 500 rupees'
      );
      expect(res.isValid).toBe(true);
    });

    it('rejects unit change from hours to days (2 hours -> 2 days)', () => {
      const res = OutputValidationPipeline.validate(
        'We waited 2 days for the technician.',
        'We waited 2 hours for the technician.'
      );
      expect(res.isValid).toBe(false);
      if (!res.isValid) {
        expect(res.reasonCode).toBe('UNGROUNDED_NUMERIC_ENTITY');
      }
    });

    it('rejects currency change from INR to USD (₹500 -> $500)', () => {
      const res = OutputValidationPipeline.validate(
        'The total charge was $500 for the repair.',
        'The total charge was ₹500 for the repair.'
      );
      expect(res.isValid).toBe(false);
      if (!res.isValid) {
        expect(res.reasonCode).toBe('UNGROUNDED_NUMERIC_ENTITY');
      }
    });

    it('rejects introducing an ungrounded unit when source had no unit', () => {
      const res = OutputValidationPipeline.validate(
        'We waited 20 minutes at the clinic.',
        'We sat at room 20 at the clinic.'
      );
      expect(res.isValid).toBe(false);
      if (!res.isValid) {
        expect(res.reasonCode).toBe('UNGROUNDED_NUMERIC_ENTITY');
      }
    });

    it('rejects completely ungrounded numbers invented by the model', () => {
      const res = OutputValidationPipeline.validate(
        'Food was bad and cost $80 extra.',
        'Food was bad and cost extra.'
      );
      expect(res.isValid).toBe(false);
      if (!res.isValid) {
        expect(res.reasonCode).toBe('UNGROUNDED_NUMERIC_ENTITY');
      }
    });

    it('supports grounding across Indic numerals and Western digits with canonical units', () => {
      const resGu = OutputValidationPipeline.validate(
        'We waited 2 hours and paid ₹500.',
        '૨ કલાક રાહ જોઈ અને ૫૦૦ રૂપિયા ચૂકવ્યા.'
      );
      expect(resGu.isValid).toBe(true);
    });
  });

  describe('Conservative Sentiment Preservation', () => {
    it('rejects inverting pure negative feedback into promotional praise', () => {
      const res = OutputValidationPipeline.validate(
        'Amazing service, loved it and highly recommend!',
        'The service was terrible and the staff was extremely rude.'
      );
      expect(res.isValid).toBe(false);
      if (!res.isValid) {
        expect(res.reasonCode).toBe('SENTIMENT_INVERSION_DETECTED');
      }
    });

    it('permits positive compliments in mixed-sentiment reviews', () => {
      const res = OutputValidationPipeline.validate(
        'The food was amazing, although the waiter was rude.',
        'Food was amazing but waiter was rude.'
      );
      expect(res.isValid).toBe(true);
    });

    it('rejects dropping explicit negation present in the feedback', () => {
      const res = OutputValidationPipeline.validate(
        'The service was good and the food was fresh.',
        'The service was not good and the food was not fresh.'
      );
      expect(res.isValid).toBe(false);
      if (!res.isValid) {
        expect(res.reasonCode).toBe('SENTIMENT_INVERSION_DETECTED');
      }
    });
  });
});
