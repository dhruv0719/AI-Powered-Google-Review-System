import { describe, it, expect } from 'vitest';
import { MeaningfulInputValidator } from '../src/ai/input_validator';
import { BOUNDARY_FIXTURES, MULTILINGUAL_FIXTURES } from './fixtures/ai_fixtures';

describe('MeaningfulInputValidator Unit Tests', () => {
  describe('Boundary Tests (Grapheme & Word Bounds)', () => {
    it('rejects input with exactly 9 graphemes (INPUT_TOO_SHORT)', () => {
      const res = MeaningfulInputValidator.validate(BOUNDARY_FIXTURES.exact9Graphemes.text);
      expect(res.isValid).toBe(false);
      if (!res.isValid) {
        expect(res.reasonCode).toBe('INPUT_TOO_SHORT');
      }
    });

    it('accepts input with exactly 10 graphemes and 2 substantive words', () => {
      const res = MeaningfulInputValidator.validate(BOUNDARY_FIXTURES.exact10Graphemes2Words.text);
      expect(res.isValid).toBe(true);
      if (res.isValid) {
        expect(res.graphemeCount).toBe(10);
        expect(res.wordCount).toBe(2);
      }
    });

    it('rejects input with exactly 10 graphemes but only 1 substantive word (INSUFFICIENT_WORDS)', () => {
      const res = MeaningfulInputValidator.validate(BOUNDARY_FIXTURES.exact10Graphemes1Word.text);
      expect(res.isValid).toBe(false);
      if (!res.isValid) {
        expect(res.reasonCode).toBe('INSUFFICIENT_WORDS');
      }
    });

    it('accepts English input with exactly 500 graphemes', () => {
      const res = MeaningfulInputValidator.validate(BOUNDARY_FIXTURES.exact500GraphemesEn.text);
      expect(res.isValid).toBe(true);
      if (res.isValid) {
        expect(res.graphemeCount).toBe(500);
        expect(res.wordCount).toBe(90);
      }
    });

    it('rejects English input with exactly 501 graphemes (INPUT_TOO_LONG)', () => {
      const res = MeaningfulInputValidator.validate(BOUNDARY_FIXTURES.exact501GraphemesEn.text);
      expect(res.isValid).toBe(false);
      if (!res.isValid) {
        expect(res.reasonCode).toBe('INPUT_TOO_LONG');
      }
    });

    it('accepts Gujarati input with exactly 500 graphemes', () => {
      const res = MeaningfulInputValidator.validate(
        BOUNDARY_FIXTURES.exact500GraphemesGu.text,
        'gu'
      );
      expect(res.isValid).toBe(true);
      if (res.isValid) {
        expect(res.graphemeCount).toBe(500);
        expect(res.wordCount).toBe(160);
      }
    });

    it('rejects Gujarati input with exactly 501 graphemes (INPUT_TOO_LONG)', () => {
      const res = MeaningfulInputValidator.validate(
        BOUNDARY_FIXTURES.exact501GraphemesGu.text,
        'gu'
      );
      expect(res.isValid).toBe(false);
      if (!res.isValid) {
        expect(res.reasonCode).toBe('INPUT_TOO_LONG');
      }
    });

    it('accepts Hindi input with exactly 500 graphemes', () => {
      const res = MeaningfulInputValidator.validate(
        BOUNDARY_FIXTURES.exact500GraphemesHi.text,
        'hi'
      );
      expect(res.isValid).toBe(true);
      if (res.isValid) {
        expect(res.graphemeCount).toBe(500);
        expect(res.wordCount).toBe(160);
      }
    });

    it('rejects Hindi input with exactly 501 graphemes (INPUT_TOO_LONG)', () => {
      const res = MeaningfulInputValidator.validate(
        BOUNDARY_FIXTURES.exact501GraphemesHi.text,
        'hi'
      );
      expect(res.isValid).toBe(false);
      if (!res.isValid) {
        expect(res.reasonCode).toBe('INPUT_TOO_LONG');
      }
    });
  });

  describe('Multilingual & Script Support', () => {
    it('accepts authentic Gujarati feedback with matras and conjuncts', () => {
      const res1 = MeaningfulInputValidator.validate(MULTILINGUAL_FIXTURES.gujarati.negative, 'gu');
      expect(res1.isValid).toBe(true);

      const res2 = MeaningfulInputValidator.validate(
        MULTILINGUAL_FIXTURES.gujarati.positiveMatras,
        'gu'
      );
      expect(res2.isValid).toBe(true);

      const res3 = MeaningfulInputValidator.validate(
        MULTILINGUAL_FIXTURES.gujarati.conjuncts,
        'gu'
      );
      expect(res3.isValid).toBe(true);
    });

    it('accepts authentic Hindi feedback with halants and conjuncts', () => {
      const res1 = MeaningfulInputValidator.validate(MULTILINGUAL_FIXTURES.hindi.negative, 'hi');
      expect(res1.isValid).toBe(true);

      const res2 = MeaningfulInputValidator.validate(
        MULTILINGUAL_FIXTURES.hindi.positiveHalants,
        'hi'
      );
      expect(res2.isValid).toBe(true);

      const res3 = MeaningfulInputValidator.validate(
        MULTILINGUAL_FIXTURES.hindi.mixedSentiment,
        'hi'
      );
      expect(res3.isValid).toBe(true);
    });

    it('accepts mixed-script Hinglish and Gujlish reviews', () => {
      const res1 = MeaningfulInputValidator.validate(MULTILINGUAL_FIXTURES.codeMixed.hinglish);
      expect(res1.isValid).toBe(true);

      const res2 = MeaningfulInputValidator.validate(
        MULTILINGUAL_FIXTURES.codeMixed.gujlishExpressive
      );
      expect(res2.isValid).toBe(true);

      const res3 = MeaningfulInputValidator.validate(
        MULTILINGUAL_FIXTURES.codeMixed.hindiEnglish
      );
      expect(res3.isValid).toBe(true);

      const res4 = MeaningfulInputValidator.validate(
        MULTILINGUAL_FIXTURES.codeMixed.gujaratiEnglish
      );
      expect(res4.isValid).toBe(true);
    });

    it('correctly handles complex emoji clusters without corrupting grapheme counts', () => {
      const res = MeaningfulInputValidator.validate(MULTILINGUAL_FIXTURES.emoji);
      expect(res.isValid).toBe(true);
      if (res.isValid) {
        expect(res.graphemeCount).toBe(34);
      }
    });
  });

  describe('Conservative Anti-Spam Heuristics', () => {
    it('permits expressive human elongations under 8 characters', () => {
      expect(MeaningfulInputValidator.validate('Food was sooooo good!').isValid).toBe(true);
      expect(MeaningfulInputValidator.validate('Nooooo way this happened.').isValid).toBe(true);
      expect(MeaningfulInputValidator.validate('Yaaay we loved it!').isValid).toBe(true);
    });

    it('rejects mechanical key-down flood of 8 or more identical graphemes', () => {
      const resEn = MeaningfulInputValidator.validate('Food was soooooooo cold!');
      expect(resEn.isValid).toBe(false);
      if (!resEn.isValid) {
        expect(resEn.reasonCode).toBe('REPEATED_GRAPHEME_FLOOD');
      }

      const resGu = MeaningfulInputValidator.validate('સર્વિસ બહુ ખરાબ હતીઈઈઈઈઈઈઈઈ');
      expect(resGu.isValid).toBe(false);
      if (!resGu.isValid) {
        expect(resGu.reasonCode).toBe('REPEATED_GRAPHEME_FLOOD');
      }
    });

    it('permits legitimate repetitive short customer phrases', () => {
      expect(MeaningfulInputValidator.validate('No no no no!').isValid).toBe(true);
      expect(MeaningfulInputValidator.validate('Ha ha ha ha!').isValid).toBe(true);
      expect(MeaningfulInputValidator.validate('Bad, bad, bad!').isValid).toBe(true);
    });

    it('rejects single-character and alternating low-diversity floods', () => {
      const res1 = MeaningfulInputValidator.validate('a a a a a a a a a a');
      expect(res1.isValid).toBe(false);
      if (!res1.isValid) {
        expect(res1.reasonCode).toBe('LOW_CHARACTER_DIVERSITY');
      }

      const res2 = MeaningfulInputValidator.validate('ab ab ab ab ab');
      expect(res2.isValid).toBe(false);
      if (!res2.isValid) {
        expect(res2.reasonCode).toBe('LOW_CHARACTER_DIVERSITY');
      }

      // Single word repetition fails either by low diversity or insufficient substantive words
      const resSingle = MeaningfulInputValidator.validate('aaaaaaaaaa');
      expect(resSingle.isValid).toBe(false);
    });

    it('rejects home-row keyboard walks and consonant mashes', () => {
      const resHome = MeaningfulInputValidator.validate('asdfghjkl is my review');
      expect(resHome.isValid).toBe(false);
      if (!resHome.isValid) {
        expect(resHome.reasonCode).toBe('LATIN_KEYBOARD_MASH');
      }

      const resCons = MeaningfulInputValidator.validate('bcdfghjkl was experienced');
      expect(resCons.isValid).toBe(false);
      if (!resCons.isValid) {
        expect(resCons.reasonCode).toBe('LATIN_KEYBOARD_MASH');
      }
    });

    it('never rejects legitimate English words with consonant clusters (Regression Test: strengths)', () => {
      const res1 = MeaningfulInputValidator.validate(MULTILINGUAL_FIXTURES.conservativeLatinWord);
      expect(res1.isValid).toBe(true);

      const res2 = MeaningfulInputValidator.validate('Our lengths and strengths mattered.');
      expect(res2.isValid).toBe(true);

      const res3 = MeaningfulInputValidator.validate('The catchphrase was memorable.');
      expect(res3.isValid).toBe(true);
    });

    it('never triggers Latin keyboard-mash rules on Gujarati or Devanagari conjuncts', () => {
      const resGu = MeaningfulInputValidator.validate('સત્યવાન વ્યક્તિની વાત છે.');
      expect(resGu.isValid).toBe(true);

      const resHi = MeaningfulInputValidator.validate('प्रबंधन की व्यवस्था देखिए।');
      expect(resHi.isValid).toBe(true);
    });
  });
});
