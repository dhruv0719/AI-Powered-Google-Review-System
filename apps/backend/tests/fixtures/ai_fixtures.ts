export const BOUNDARY_FIXTURES = {
  exact9Graphemes: {
    text: '123456789',
    expectedGraphemes: 9,
    expectedWords: 1,
  },
  exact10Graphemes2Words: {
    text: 'Good food!',
    expectedGraphemes: 10,
    expectedWords: 2,
  },
  exact10Graphemes1Word: {
    text: 'Incredible',
    expectedGraphemes: 10,
    expectedWords: 1,
  },
  // English 500 graphemes: 9 sentences with trailing space (450) + 1 sentence without trailing space (50) = 500 trimmed graphemes, 90 words
  exact500GraphemesEn: {
    text:
      'The service was very fast and food was wonderful. '.repeat(9) +
      'The service was very fast and food was wonderful.!',
    expectedGraphemes: 500,
    expectedWords: 90,
  },
  exact501GraphemesEn: {
    text:
      'The service was very fast and food was wonderful. '.repeat(9) +
      'The service was very fast and food was wonderful.!+',
    expectedGraphemes: 501,
    expectedWords: 90,
  },
  // Gujarati 500 graphemes: 19 sentences with trailing space (475) + 1 sentence without trailing space (25) = 500 trimmed graphemes, 160 words
  exact500GraphemesGu: {
    text:
      'સર્વિસ ખૂબ જ સારી હતી અને સ્ટાફ સારો. '.repeat(19) +
      'સર્વિસ ખૂબ જ સારી હતી અને સ્ટાફ સારો.!',
    expectedGraphemes: 500,
    expectedWords: 160,
  },
  exact501GraphemesGu: {
    text:
      'સર્વિસ ખૂબ જ સારી હતી અને સ્ટાફ સારો. '.repeat(19) +
      'સર્વિસ ખૂબ જ સારી હતી અને સ્ટાફ સારો.!+',
    expectedGraphemes: 501,
    expectedWords: 160,
  },
  // Hindi 500 graphemes: 19 sentences with trailing space (475) + 1 sentence without trailing space (25) = 500 trimmed graphemes, 160 words
  exact500GraphemesHi: {
    text:
      'खाना बहुत अच्छा था और सेवा बढ़िया थी। '.repeat(19) +
      'खाना बहुत अच्छा था और सेवा बढ़िया थी।!',
    expectedGraphemes: 500,
    expectedWords: 160,
  },
  exact501GraphemesHi: {
    text:
      'खाना बहुत अच्छा था और सेवा बढ़िया थी। '.repeat(19) +
      'खाना बहुत अच्छा था और सेवा बढ़िया थी।!+',
    expectedGraphemes: 501,
    expectedWords: 160,
  },
};

export const MULTILINGUAL_FIXTURES = {
  gujarati: {
    negative: 'સર્વિસ ખૂબ જ ધીમી હતી અને સ્ટાફનું વર્તન તોછડું હતું.',
    positiveMatras: 'ડૉક્ટર સાહેબનું માર્ગદર્શન ઉત્તમ હતું અને સ્ટાફ સારો હતો.',
    conjuncts: 'ગુણવત્તા અને સ્વચ્છતા પ્રશંસનીય છે.',
  },
  hindi: {
    negative: 'खाना बहुत ठंडा था और वेटर ने बात नहीं सुनी।',
    positiveHalants: 'डॉक्टर का व्यवहार बहुत विनम्र और मददगार था।',
    mixedSentiment: 'कमरा अच्छा था लेकिन एसी बिल्कुल काम नहीं कर रहा था।',
  },
  codeMixed: {
    hinglish: 'Doctor was polite lekin clinic ka waiting time bahut zyada tha.',
    gujlishExpressive: 'Service sooooo slow hati ane billing counter par wait karavya.',
    hindiEnglish: 'Staff was extremely rude, bilkul dhyan nahi diya.',
    gujaratiEnglish: 'Doctor was very polite pan clinic ma hygiene maintain nathi.',
  },
  emoji: 'Great food! 👍🏽 Highly recommended 👨‍👩‍👧‍👦',
  repetitiveLegitimate: 'No no no no!',
  conservativeLatinWord: 'The team displayed great strengths and character.',
};
