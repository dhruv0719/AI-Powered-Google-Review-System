import { AiAssistantConstants } from './types.js';

export type InstructionSanitizationCategory =
  | 'UNCHANGED'
  | 'SANITIZED'
  | 'INSUFFICIENT_CONTEXT'
  | 'AMBIGUOUS';

export interface SanitizerResult {
  category: InstructionSanitizationCategory;
  acceptedExperienceText: string | null;
  reasonCode: string | null;
}

/**
 * Deterministic Instruction Sanitizer
 *
 * Lightweight, dependency-free preprocessor that separates high-confidence
 * AI-directed instructions from genuine customer experiences before provider invocation.
 *
 * Critical invariants:
 * 1. Reported speech (e.g., "the waiter told me to write...", "Ramesh asked us to tell...")
 *    is strictly preserved as authentic customer experience.
 * 2. Bare conjunctions ("and", "also", "aur", "ane", "pan") are NOT split globally.
 * 3. Ambiguous inputs are conservatively refused (INSUFFICIENT_CONTEXT/AMBIGUOUS) rather
 *    than silently rewriting or inventing customer experiences.
 * 4. Discarded clauses are completely excluded from acceptedExperienceText.
 */
export class DeterministicInstructionSanitizer {
  private static readonly graphemeSegmenter = new Intl.Segmenter(undefined, {
    granularity: 'grapheme',
  });

  // Explicit bracketed system/admin instruction tags
  private static readonly BRACKETED_INSTRUCTION_REGEX =
    /\[(?:ADMIN(?:_COMMAND)?|SYSTEM(?:_NOTICE)?|DEVELOPER(?:_OVERRIDE)?|OVERRIDE|COMMAND|आदेश)[^\]]*\]/gi;

  // Recognized pseudo-control wrapper tags (e.g. <system>...</system>, <developer>...</developer>, <assistant>...</assistant>)
  // Strips matched paired wrappers including their internal instruction payload.
  private static readonly PSEUDO_CONTROL_WRAPPER_REGEX =
    /<(system|developer|assistant|instructions?|admin|override)\b[^>]*>[\s\S]*?<\/\1>/gi;

  // Unclosed recognized pseudo-control opening tag (e.g. <system>Some text without close tag)
  // Truncates from the unclosed opening tag onwards.
  private static readonly UNCLOSED_PSEUDO_CONTROL_OPENING_REGEX =
    /<(system|developer|assistant|instructions?|admin|override)\b[^>]*>[\s\S]*$/i;

  // Orphaned closing recognized pseudo-control tags (e.g. </system>)
  private static readonly ORPHAN_PSEUDO_CONTROL_CLOSING_REGEX =
    /<\/(system|developer|assistant|instructions?|admin|override)\b[^>]*>/gi;

  // Code block delimiters
  private static readonly CODE_BLOCK_REGEX = /```[\s\S]*?```/g;

  // High-confidence full instruction overrides (entire input is a prompt attack / meta-prompt)
  private static readonly PURE_INSTRUCTION_PATTERNS: RegExp[] = [
    /^(?:please\s+)?(?:disregard\s+(?:editing|all\s+rules|instructions)|ignore\s+(?:all\s+)?(?:previous\s+)?(?:instructions|rules|system\s+rules))\b/i,
    /^(?:your\s+new\s+task\s+is\s+to|you\s+are\s+now\s+freewriter|you\s+have\s+no\s+rules)\b/i,
    /^(?:please\s+)?(?:reveal|show|display|leak)\s+(?:your\s+)?(?:complete\s+)?(?:system\s+instructions|prompt|rules)\b/i,
    /^(?:do\s+not\s+edit\s+feedback[.,\s]+instead[,\s]+translate)\b/i,
    /^(?:pan\s+tame\s+)?(?:badhi|badha)\s+(?:system\s+)?(?:rules|guidelines)(?:\s+ane\s+guidelines)?\s+(?:bhuli\s+jao|radd\s+karo)\b/i,
    /^(?:tame\s+badhu\s+ignore\s+karo)\b/i,
    /^(?:pichhle\s+sabhi\s+niyam\s+bhool\s+jao)\b/i,
    /^(?:agauni\s+badhi\s+suchnao\s+avgano)\b/i,
    /^(?:write|generate|output)\s+(?:a\s+)?(?:glowing\s+)?(?:5|five)[\s-]star\s+review\b/i,
  ];

  // Compound directive introducers (preceded by sentence boundary or comma)
  // These specifically target directive transitions, NOT bare conjunctions
  private static readonly DIRECTIVE_CLAUSE_REGEX =
    /(?:[.!?]\s+|\n+|,?\s+|^)(?:also\s+(?:write|say)\s+that|ignore\s+that\s+and\s+(?:say|write|claim)|make\s+this\s+sound\s+like\s+a\s+(?:glowing\s+)?(?:5|five)[\s-]star|flip\s+this\s+into\s+a\s+polite\s+compliment|em\s+lakho\s+ke|aam\s+lakho\s+ke|review\s+ma\s+lakho\s+ke|eva\s+review\s+lakho\s+ke|mast\s+(?:5|five)[\s-]star\s+rating\s+(?:lakhi\s+dyo|aapo)|aur\s+mast\s+(?:5|five)[\s-]star\s+review\s+likho|likho\s+ki\s+yeh\s+poore\s+shehar\s+ka\s+sarvashreshtha|5\s*star\s+review\s+lakho\s+ke\s+badhu\s+shreshtha)\b[\s\S]*$/i;

  // Reported speech anchors: subject (staff/manager/person/pronoun) + communication verb
  // When an input matches reported speech, it is NOT an AI directive
  private static readonly REPORTED_SPEECH_REGEX =
    /\b(?:the\s+waiter|the\s+manager|the\s+staff|the\s+owner|the\s+server|the\s+host|the\s+barista|[A-Z][a-z]+)\s+(?:told\s+(?:me|us)|asked\s+(?:me|us)|said(?:\s+that|\s+to|\s*,)?|recommended|suggested)\b|\b(?:ramesh|priya|manager|waiter|staff|owner)\s+(?:ne\s+(?:bola|kaha|likh)|e\s+(?:kidhu|kahyu|bolyo))\b|\b(?:સ્ટાફે|વેઈટરે|માલિકે|મેનેજરે)\s+(?:કહ્યું|પૂછ્યું|બોલ્યા)\b|\b(?:वेटर|मैनेजर|शेफ|मालिक)\s+(?:ने\s+(?:कहा|बोला)|बोले)\b/i;

  /**
   * Helper to count graphemes of any string.
   */
  public static countGraphemes(text: string): number {
    const normalized = text.normalize('NFC').trim();
    if (normalized.length === 0) return 0;
    return Array.from(this.graphemeSegmenter.segment(normalized)).length;
  }

  /**
   * Sanitizes customer feedback deterministically.
   */
  public static sanitize(input: string, _languageHint?: string): SanitizerResult {
    const normalized = input.normalize('NFC').trim();

    if (normalized.length === 0) {
      return {
        category: 'UNCHANGED',
        acceptedExperienceText: '',
        reasonCode: null,
      };
    }

    // 1. Check for pure high-confidence instruction overrides
    for (const pattern of this.PURE_INSTRUCTION_PATTERNS) {
      if (pattern.test(normalized)) {
        return {
          category: 'INSUFFICIENT_CONTEXT',
          acceptedExperienceText: null,
          reasonCode: 'PURE_INSTRUCTION_OVERRIDE',
        };
      }
    }

    // 2. Check for reported speech protection
    const isReportedSpeech = this.REPORTED_SPEECH_REGEX.test(normalized);

    // 3. Check for bracketed instruction delimiters [ADMIN_COMMAND: ...], ```...```, and pseudo-control tags
    let workingText = normalized;
    let tagRemoved = false;

    if (this.BRACKETED_INSTRUCTION_REGEX.test(workingText)) {
      workingText = workingText.replace(this.BRACKETED_INSTRUCTION_REGEX, ' ').trim();
      tagRemoved = true;
    }

    if (this.CODE_BLOCK_REGEX.test(workingText)) {
      workingText = workingText.replace(this.CODE_BLOCK_REGEX, ' ').trim();
      tagRemoved = true;
    }

    if (this.PSEUDO_CONTROL_WRAPPER_REGEX.test(workingText)) {
      workingText = workingText.replace(this.PSEUDO_CONTROL_WRAPPER_REGEX, ' ').trim();
      tagRemoved = true;
    }

    // If an unclosed pseudo-control opening tag exists, discard the entire unclosed payload
    if (this.UNCLOSED_PSEUDO_CONTROL_OPENING_REGEX.test(workingText)) {
      workingText = workingText.replace(this.UNCLOSED_PSEUDO_CONTROL_OPENING_REGEX, ' ').trim();
      tagRemoved = true;
    }

    // Strip any remaining orphan closing tags (e.g. </system>)
    if (this.ORPHAN_PSEUDO_CONTROL_CLOSING_REGEX.test(workingText)) {
      workingText = workingText.replace(this.ORPHAN_PSEUDO_CONTROL_CLOSING_REGEX, ' ').trim();
      tagRemoved = true;
    }

    // Collapse any redundant internal whitespace created by tag removal
    if (tagRemoved) {
      workingText = workingText.replace(/\s{2,}/g, ' ').trim();
      const remainingGraphemes = this.countGraphemes(workingText);
      if (remainingGraphemes < AiAssistantConstants.MIN_FEEDBACK_LENGTH) {
        return {
          category: 'INSUFFICIENT_CONTEXT',
          acceptedExperienceText: null,
          reasonCode: 'INSUFFICIENT_AFTER_TAG_STRIPPING',
        };
      }
      return {
        category: 'SANITIZED',
        acceptedExperienceText: workingText,
        reasonCode: 'TAG_DELIMITER_STRIPPED',
      };
    }

    // 4. Check for compound directive clause detachment
    const directiveMatch = this.DIRECTIVE_CLAUSE_REGEX.exec(normalized);

    if (directiveMatch && directiveMatch.index !== undefined) {
      // If the directive match starts at index 0, the entire input is a directive
      if (directiveMatch.index === 0) {
        if (!isReportedSpeech) {
          return {
            category: 'INSUFFICIENT_CONTEXT',
            acceptedExperienceText: null,
            reasonCode: 'INSTRUCTION_ONLY_INPUT',
          };
        }
      }

      // If reported speech is present at sentence start, protect it
      if (isReportedSpeech && directiveMatch.index === 0) {
        return {
          category: 'UNCHANGED',
          acceptedExperienceText: normalized,
          reasonCode: null,
        };
      }

      let cleanedExperience = normalized.slice(0, directiveMatch.index).trim();
      const boundaryChar = normalized[directiveMatch.index];
      if (boundaryChar === '.' || boundaryChar === '!' || boundaryChar === '?') {
        cleanedExperience += boundaryChar;
      }
      cleanedExperience = cleanedExperience.replace(/[,;]+$/, '').trim();

      const acceptedGraphemes = this.countGraphemes(cleanedExperience);

      if (acceptedGraphemes < AiAssistantConstants.MIN_FEEDBACK_LENGTH) {
        return {
          category: 'INSUFFICIENT_CONTEXT',
          acceptedExperienceText: null,
          reasonCode: 'EXPERIENCE_BELOW_THRESHOLD',
        };
      }

      return {
        category: 'SANITIZED',
        acceptedExperienceText: cleanedExperience,
        reasonCode: 'DIRECTIVE_CLAUSE_CLEAVED',
      };
    }

    // 5. Default: No high-confidence instruction detected
    return {
      category: 'UNCHANGED',
      acceptedExperienceText: normalized,
      reasonCode: null,
    };
  }
}
