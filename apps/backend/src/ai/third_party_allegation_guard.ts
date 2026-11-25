export interface TargetBusinessContext {
  tenantName?: string;
  locationName?: string;
}

export interface ThirdPartyAllegationResult {
  isAllegationDetected: boolean;
  reasonCode: 'THIRD_PARTY_ALLEGATION_DETECTED' | null;
}

/**
 * Third-Party Allegation Guard (Phase 6.7.2)
 *
 * Deterministic, dependency-free guard that prevents AI-assisted review drafts
 * from amplifying unsupported allegations about unrelated third-party businesses,
 * while preserving legitimate customer experiences, genuine negative grievances
 * about the reviewed business, and benign brand comparisons.
 *
 * Invariants:
 * 1. Must only refuse when BOTH conditions are met:
 *    a) A sufficiently explicit third-party reference exists (spatial anchor, neighbor, other venue).
 *    b) A supported severe allegation pattern (health code, pest, food safety, fraud, crime)
 *       is associated with that third-party reference.
 * 2. Grievances directed at the target business are PRESERVED (never censored).
 * 3. Benign brand comparisons (e.g. "Better coffee than Starbucks down the road") are PRESERVED.
 * 4. Input text is NEVER mutated or stripped.
 * 5. Deterministic, runs in memory in < 1ms, zero external calls, zero DB queries.
 */
export class ThirdPartyAllegationGuard {
  // Generic stopwords in business names that must not cause false target collisions
  private static readonly GENERIC_BUSINESS_WORDS = new Set([
    'cafe', 'restaurant', 'hotel', 'shop', 'store', 'bar', 'dhaba', 'kitchen', 'bistro', 'diner',
    'pizzeria', 'bakery', 'lounge', 'outlet', 'branch', 'the', 'and', '&', 'at', 'in', 'on', 'of',
  ]);

  // Explicit spatial / relational third-party indicators
  // English, Hindi (native & Latin), Gujarati (native & Latin)
  private static readonly THIRD_PARTY_ANCHORS = [
    /\b(?:next\s+door|down\s+the\s+(?:road|street)|across\s+the\s+street|other\s+(?:restaurant|cafe|hotel|shop|bakery|place))\b/i,
    /\b(?:neighbour|neighbor|neighbouring|neighboring)\b/i,
    /\b(?:padosi|bagal\s+wala|paas\s+wala|saamne\s+wala)\b/i,
    /\b(?:baju\s+vala|baju\s+valo|baju\s+no|baju\s+ma|saame\s+valu|saame\s+no)\b/i,
    /(?:બાજુવાળા|બાજુવાળું|પાસેના|સામેવાળા|પાસવાળા)/,
    /(?:पास\s+वाले|बगल\s+वाला|पड़ोसी|सामने\s+वाले)/,
  ];

  // Specific third-party competitor entity markers when followed by a proper noun/name
  // e.g. "restaurant Cafe Bella", "competitor X"
  private static readonly THIRD_PARTY_ENTITY_PREFIX =
    /\b(?:restaurant|cafe|hotel|dhaba|bakery)\s+([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+)?)\b/;

  // Severe, high-risk allegation keywords & patterns
  // (Health hazards, vermin, food poisoning, adulteration, theft, scams, police)
  private static readonly SEVERE_ALLEGATION_PATTERNS = [
    /\b(?:rats?|mice|cockroach(?:es)?|insects?|maggots?)\b/i,
    /\b(?:food\s+poisoning|poisoned|spoiled\s+(?:milk|food|meat)|rotten\s+(?:meat|food)|bad\s+stomach|vomiting)\b/i,
    /\b(?:scam(?:s|mer|med)?|fraud(?:ulent)?|stolen|steals?|cheats?|illegal)\b/i,
    /\b(?:baasi\s+khana|food\s+poisoning|nakli|dhoko|thug|chori|chor)\b/i,
    /\b(?:undar|jivda|maakhi|makhi)\b/i,
    /(?:ઉંદર|જીવડાં|માખી|વાસી\s+ખાવાનું|બીમાર)/,
    /(?:चूहे|कीड़े|मक्खी|बासी\s+खाना|बीमार|नकली)/,
  ];

  // Benign comparison introducers that indicate a positive/favorable benchmark rather than an allegation
  // e.g. "Better than...", "beats ...", "Dominos thi saru...", "CCD se sasta..."
  private static readonly BENIGN_COMPARISON_PATTERNS = [
    /\b(?:better\s+(?:coffee|tea|food|service|taste|crust|quality|place)?\s+than|warmer\s+service\s+than|beats|cheaper\s+than|more\s+honest\s+than)\b/i,
    /\b(?:thi\s+(?:ghanu\s+)?saru|thi\s+vadhare\s+swadisht|karata\s+vadhare)\b/i,
    /\b(?:se\s+(?:kafi\s+)?(?:sasta|better|accha|behtar))\b/i,
    /(?:કરતાં\s+(?:અહીંની|વધારે|સારું))/,
    /(?:से\s+(?:बहुत\s+)?(?:बेहतर|अच्छा|सस्ता))/,
  ];

  /**
   * Normalizes and extracts meaningful tokens from a business name.
   */
  private static extractDistinctiveTokens(name: string): string[] {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2 && !this.GENERIC_BUSINESS_WORDS.has(token));
  }

  /**
   * Checks whether a matched entity name refers to the reviewed target business.
   */
  private static matchesTargetBusiness(
    entityName: string,
    targetContext?: TargetBusinessContext
  ): boolean {
    if (!targetContext) return false;

    const normalizedEntity = entityName.toLowerCase().trim();
    if (normalizedEntity.length === 0) return false;

    const targets = [targetContext.tenantName, targetContext.locationName]
      .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
      .map((n) => n.toLowerCase().trim());

    for (const target of targets) {
      if (normalizedEntity === target) return true;

      // Extract distinctive tokens (ignoring cafe, restaurant, etc.)
      const entityTokens = this.extractDistinctiveTokens(normalizedEntity);
      const targetTokens = this.extractDistinctiveTokens(target);

      if (entityTokens.length > 0 && targetTokens.length > 0) {
        // If all distinctive tokens of the entity match the target tokens
        const allMatch = entityTokens.every((t) => targetTokens.includes(t));
        if (allMatch) return true;
      }
    }

    return false;
  }

  /**
   * Evaluates accepted customer experience text for unsupported third-party allegations.
   */
  public static check(
    acceptedExperienceText: string,
    targetContext?: TargetBusinessContext
  ): ThirdPartyAllegationResult {
    const text = acceptedExperienceText.normalize('NFC').trim();
    if (text.length === 0) {
      return { isAllegationDetected: false, reasonCode: null };
    }

    // Split text into coherent sentence clauses
    const clauses = text
      .split(/(?:[.!?\n]+|\b(?:but|par|pan|lekin|halanki|parantu)\b)/i)
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    for (const clause of clauses) {
      // 1. Check if this clause is purely a benign comparison
      const isBenignComparison = this.BENIGN_COMPARISON_PATTERNS.some((pat) =>
        pat.test(clause)
      );
      if (isBenignComparison) {
        // Benign comparisons with competitors are legitimate customer sentiment
        continue;
      }

      // 2. Check if a severe allegation exists in this clause
      const hasSevereAllegation = this.SEVERE_ALLEGATION_PATTERNS.some((pat) =>
        pat.test(clause)
      );

      if (!hasSevereAllegation) {
        continue;
      }

      // 3. Condition A: Check for explicit spatial/relational third-party anchors
      const hasSpatialAnchor = this.THIRD_PARTY_ANCHORS.some((pat) => pat.test(clause));

      // 4. Condition B: Check for explicit named third-party entity in the allegation clause
      let isNamedThirdParty = false;
      const entityMatch = this.THIRD_PARTY_ENTITY_PREFIX.exec(clause);
      if (entityMatch && entityMatch[1]) {
        const potentialName = entityMatch[1].trim();
        // If it does NOT match our target business, it's a named third party
        if (!this.matchesTargetBusiness(potentialName, targetContext)) {
          isNamedThirdParty = true;
        }
      }

      // Check multiple competitor mention (e.g. "Cafe Mocha and Cafe Bella both cheat...")
      const multiCompetitorMatch = /\b(?:cafe|restaurant|hotel)\s+[A-Z][a-z0-9]+\s+and\s+(?:cafe|restaurant|hotel)\s+[A-Z][a-z0-9]+\b/i.test(clause);
      if (multiCompetitorMatch) {
        isNamedThirdParty = true;
      }

      // Refusal requires BOTH: An explicit third-party reference (spatial or named)
      // AND an associated severe allegation pattern
      if (hasSpatialAnchor || isNamedThirdParty) {
        return {
          isAllegationDetected: true,
          reasonCode: 'THIRD_PARTY_ALLEGATION_DETECTED',
        };
      }
    }

    // Default: No third-party allegation detected (target grievances and clean feedback pass through)
    return {
      isAllegationDetected: false,
      reasonCode: null,
    };
  }
}
