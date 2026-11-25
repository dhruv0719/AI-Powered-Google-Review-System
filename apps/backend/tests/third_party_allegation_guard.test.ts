import { describe, it, expect } from 'vitest';
import {
  ThirdPartyAllegationGuard,
  TargetBusinessContext,
} from '../src/ai/third_party_allegation_guard.js';

describe('ThirdPartyAllegationGuard Unit Tests (Phase 6.7.2)', () => {
  const targetContext: TargetBusinessContext = {
    tenantName: 'The Royal Bistro',
    locationName: 'Downtown Branch',
  };

  // 1. Third-Party Allegation Detection (G-01 to G-07, G-24)
  describe('Third-Party Allegation Detection (Refusal Cases)', () => {
    it('refuses third-party health allegation across the street (G-01)', () => {
      const input = 'Food was fine here. Avoid the bakery across the street, they sell spoiled milk.';
      const res = ThirdPartyAllegationGuard.check(input, targetContext);

      expect(res.isAllegationDetected).toBe(true);
      expect(res.reasonCode).toBe('THIRD_PARTY_ALLEGATION_DETECTED');
    });

    it('refuses third-party fraud allegation next door (G-02)', () => {
      const input = 'Great pasta here, but the restaurant next door is a total scam.';
      const res = ThirdPartyAllegationGuard.check(input, targetContext);

      expect(res.isAllegationDetected).toBe(true);
      expect(res.reasonCode).toBe('THIRD_PARTY_ALLEGATION_DETECTED');
    });

    it('refuses third-party vermin/pest allegation next door (G-03)', () => {
      const input = 'Our dinner was okay, but the cafe next door has rats in the kitchen.';
      const res = ThirdPartyAllegationGuard.check(input, targetContext);

      expect(res.isAllegationDetected).toBe(true);
      expect(res.reasonCode).toBe('THIRD_PARTY_ALLEGATION_DETECTED');
    });

    it('refuses third-party stale food allegation in Hindi (G-04)', () => {
      const input = 'खाना ठीक था लेकिन पास वाले ढाबा में बासी खाना मिलता है।';
      const res = ThirdPartyAllegationGuard.check(input, targetContext);

      expect(res.isAllegationDetected).toBe(true);
      expect(res.reasonCode).toBe('THIRD_PARTY_ALLEGATION_DETECTED');
    });

    it('refuses third-party rat allegation in Gujarati (G-05)', () => {
      const input = 'જમવાનું સારું હતું પણ બાજુવાળા કાફેમાં ઉંદર દોડે છે.';
      const res = ThirdPartyAllegationGuard.check(input, targetContext);

      expect(res.isAllegationDetected).toBe(true);
      expect(res.reasonCode).toBe('THIRD_PARTY_ALLEGATION_DETECTED');
    });

    it('refuses third-party food poisoning allegation in Gujlish (G-06)', () => {
      const input = 'Food saru hatu pan baju vala restaurant ma food poisoning thai che.';
      const res = ThirdPartyAllegationGuard.check(input, targetContext);

      expect(res.isAllegationDetected).toBe(true);
      expect(res.reasonCode).toBe('THIRD_PARTY_ALLEGATION_DETECTED');
    });

    it('refuses third-party fraud allegation in Hinglish (G-07)', () => {
      const input = 'Burger accha tha par bagal wala shop fraud karta hai.';
      const res = ThirdPartyAllegationGuard.check(input, targetContext);

      expect(res.isAllegationDetected).toBe(true);
      expect(res.reasonCode).toBe('THIRD_PARTY_ALLEGATION_DETECTED');
    });

    it('refuses multi-competitor narrative smear (G-24)', () => {
      const input = 'Cafe Mocha and Cafe Bella both cheat their staff and serve rotten meat.';
      const res = ThirdPartyAllegationGuard.check(input, targetContext);

      expect(res.isAllegationDetected).toBe(true);
      expect(res.reasonCode).toBe('THIRD_PARTY_ALLEGATION_DETECTED');
    });
  });

  // 2. Benign Brand Comparisons (G-08 to G-12)
  describe('Benign Brand Comparisons (Permitted Cases)', () => {
    it('permits benign brand comparison with Starbucks down the road (G-08)', () => {
      const input = 'Better coffee and warmer service than Starbucks down the road.';
      const res = ThirdPartyAllegationGuard.check(input, targetContext);

      expect(res.isAllegationDetected).toBe(false);
      expect(res.reasonCode).toBeNull();
    });

    it('permits benign tea comparison in Hindi (G-09)', () => {
      const input = 'यहाँ की चाय पास वाले कैफे से बहुत बेहतर है।';
      const res = ThirdPartyAllegationGuard.check(input, targetContext);

      expect(res.isAllegationDetected).toBe(false);
      expect(res.reasonCode).toBeNull();
    });

    it('permits benign coffee comparison in Gujarati (G-10)', () => {
      const input = 'સ્ટારબક્સ કરતાં અહીંની કોફી વધારે સ્વાદિષ્ટ છે.';
      const res = ThirdPartyAllegationGuard.check(input, targetContext);

      expect(res.isAllegationDetected).toBe(false);
      expect(res.reasonCode).toBeNull();
    });

    it('permits benign pizza comparison in Gujlish (G-11)', () => {
      const input = 'Dominos thi ghanu saru pizza che ane rate pan barabar che.';
      const res = ThirdPartyAllegationGuard.check(input, targetContext);

      expect(res.isAllegationDetected).toBe(false);
      expect(res.reasonCode).toBeNull();
    });

    it('permits benign price comparison in Hinglish (G-12)', () => {
      const input = 'CCD se kafi sasta aur better taste hai yahan ka.';
      const res = ThirdPartyAllegationGuard.check(input, targetContext);

      expect(res.isAllegationDetected).toBe(false);
      expect(res.reasonCode).toBeNull();
    });
  });

  // 3. Target Business Grievance Preservation (G-13 to G-17, G-20)
  describe('Target Business Grievance Preservation (Permitted Cases)', () => {
    it('permits direct cockroach grievance at target venue (G-13)', () => {
      const input = 'Terrible hygiene, we found a cockroach under our table.';
      const res = ThirdPartyAllegationGuard.check(input, targetContext);

      expect(res.isAllegationDetected).toBe(false);
      expect(res.reasonCode).toBeNull();
    });

    it('permits food poisoning grievance at target venue (G-14)', () => {
      const input = 'Both my wife and I got food poisoning after eating prawns here.';
      const res = ThirdPartyAllegationGuard.check(input, targetContext);

      expect(res.isAllegationDetected).toBe(false);
      expect(res.reasonCode).toBeNull();
    });

    it('permits insect grievance in Hindi at target venue (G-15)', () => {
      const input = 'समोसे में कीड़ा निकला, बहुत ही गंदी सर्विस थी।';
      const res = ThirdPartyAllegationGuard.check(input, targetContext);

      expect(res.isAllegationDetected).toBe(false);
      expect(res.reasonCode).toBeNull();
    });

    it('permits fly grievance in Gujarati at target venue (G-16)', () => {
      const input = 'દાળમાં માખી પડી હતી અને મેનેજરે કઈ ધ્યાન ન આપ્યું.';
      const res = ThirdPartyAllegationGuard.check(input, targetContext);

      expect(res.isAllegationDetected).toBe(false);
      expect(res.reasonCode).toBeNull();
    });

    it('permits insect grievance in Gujlish at target venue (G-17)', () => {
      const input = 'Ahiya soup thando hato ane table par jivda hata.';
      const res = ThirdPartyAllegationGuard.check(input, targetContext);

      expect(res.isAllegationDetected).toBe(false);
      expect(res.reasonCode).toBeNull();
    });

    it('permits valet theft accusation at target venue without third-party spatial anchor (G-20)', () => {
      const input = 'The valet stole money from my glove box.';
      const res = ThirdPartyAllegationGuard.check(input, targetContext);

      expect(res.isAllegationDetected).toBe(false);
      expect(res.reasonCode).toBeNull();
    });
  });

  // 4. Neutral Third-Party & Multi-Business Context (G-18, G-19)
  describe('Neutral Third-Party Mentions (Permitted Cases)', () => {
    it('permits neutral parking mention of neighboring gym (G-18)', () => {
      const input = 'Parking was tight because of the gym next door, but food was delicious.';
      const res = ThirdPartyAllegationGuard.check(input, targetContext);

      expect(res.isAllegationDetected).toBe(false);
      expect(res.reasonCode).toBeNull();
    });

    it('permits multi-business customer journey with neighboring bookstore (G-19)', () => {
      const input = 'Visited the bookstore next door and then had tea here; lovely afternoon.';
      const res = ThirdPartyAllegationGuard.check(input, targetContext);

      expect(res.isAllegationDetected).toBe(false);
      expect(res.reasonCode).toBeNull();
    });
  });

  // 5. Target Business Identity Disambiguation & Safeguards
  describe('Target Business Disambiguation & Safeguards', () => {
    it('does not confuse target business with similar named third party', () => {
      // Target is "The Royal Bistro"
      // Third party is "Royal Sweets"
      const input = 'Had lunch here. Royal Sweets next door has insects in the display.';
      const res = ThirdPartyAllegationGuard.check(input, targetContext);

      expect(res.isAllegationDetected).toBe(true);
      expect(res.reasonCode).toBe('THIRD_PARTY_ALLEGATION_DETECTED');
    });

    it('permits complaint mentioning target business by its distinctive name', () => {
      const input = 'The Royal Bistro has terrible service and cockroaches in the bathroom.';
      const res = ThirdPartyAllegationGuard.check(input, targetContext);

      expect(res.isAllegationDetected).toBe(false);
      expect(res.reasonCode).toBeNull();
    });

    it('does not mutate or alter the input text', () => {
      const input = 'Food was fine here. Avoid the bakery across the street, they sell spoiled milk.';
      const originalCopy = input.slice();
      ThirdPartyAllegationGuard.check(input, targetContext);

      expect(input).toBe(originalCopy);
    });
  });
});
