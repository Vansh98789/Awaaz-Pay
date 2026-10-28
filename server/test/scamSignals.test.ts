import { describe, expect, it } from 'vitest';
import { combineRisk, detectScamSignals } from '../src/safety/scamSignals.js';

describe('Rule-Based Scam Signal Detector', () => {
  const scamExamples = [
    {
      text: 'jaldi 500 bhej do abhi time khatam ho raha hai',
      category: 'urgency',
      expectedMinScore: 0.2,
      expectedRisk: 'medium',
      lang: 'Hinglish',
    },
    {
      text: 'तुरंत पैसे भेजो अभी समय खत्म हो जाएगा',
      category: 'urgency',
      expectedMinScore: 0.2,
      expectedRisk: 'medium',
      lang: 'Hindi Devanagari',
    },
    {
      text: 'Hurry up and pay immediately within 5 minutes',
      category: 'urgency',
      expectedMinScore: 0.2,
      expectedRisk: 'medium',
      lang: 'English',
    },
    {
      text: 'police aa jayegi agar payment nahi kiya abhi ke abhi',
      category: 'threat_authority',
      expectedMinScore: 0.6,
      expectedRisk: 'high',
      lang: 'Hinglish',
    },
    {
      text: 'पुलिस आ जाएगी तुरंत पैसे दो वारंट जारी हुआ है',
      category: 'threat_authority',
      expectedMinScore: 0.6,
      expectedRisk: 'high',
      lang: 'Hindi Devanagari',
    },
    {
      text: 'Court warrant issued, arrest will happen if you do not pay customs',
      category: 'threat_authority',
      expectedMinScore: 0.6,
      expectedRisk: 'high',
      lang: 'English',
    },
    {
      text: 'kisi ko mat batana chup chap paise transfer kar do',
      category: 'secrecy',
      expectedMinScore: 0.6,
      expectedRisk: 'high',
      lang: 'Hinglish',
    },
    {
      text: 'किसी को मत बताना और फ़ोन मत काटना लाइन पर रहो',
      category: 'secrecy',
      expectedMinScore: 0.6,
      expectedRisk: 'high',
      lang: 'Hindi Devanagari',
    },
    {
      text: 'Keep it secret, do not tell anyone and stay on the line',
      category: 'secrecy',
      expectedMinScore: 0.6,
      expectedRisk: 'high',
      lang: 'English',
    },
    {
      text: 'aapki lottery lagi hai 25 lakh ki kbc lottery inaam mila hai',
      category: 'prize_lottery',
      expectedMinScore: 0.5,
      expectedRisk: 'high',
      lang: 'Hinglish',
    },
    {
      text: 'लॉटरी लगी है इनाम जीता है तुरंत क्लेम करो',
      category: 'prize_lottery',
      expectedMinScore: 0.5,
      expectedRisk: 'high',
      lang: 'Hindi Devanagari',
    },
    {
      text: 'Congratulations you won a cash prize in the lucky draw',
      category: 'prize_lottery',
      expectedMinScore: 0.5,
      expectedRisk: 'high',
      lang: 'English',
    },
    {
      text: 'apna otp batao nahi to account block ho jayega jaldi',
      category: 'otp_kyc',
      expectedMinScore: 0.6,
      expectedRisk: 'high',
      lang: 'Hinglish',
    },
    {
      text: 'ओटीपी बताओ खाता बंद हो गया है बैंक वेरिफिकेशन के लिए',
      category: 'otp_kyc',
      expectedMinScore: 0.6,
      expectedRisk: 'high',
      lang: 'Hindi Devanagari',
    },
    {
      text: 'Share your pin and verify otp to complete kyc update',
      category: 'otp_kyc',
      expectedMinScore: 0.6,
      expectedRisk: 'high',
      lang: 'English',
    },
    {
      text: 'rbi se bol raha hu beta musibat me hai turant bhej do',
      category: 'impersonation',
      expectedMinScore: 0.3,
      expectedRisk: 'medium',
      lang: 'Hinglish',
    },
    {
      text: 'बिजली विभाग से बोल रहा हूँ तुरंत बिल भरो नहीं तो कनेक्शन कटेगा',
      category: 'impersonation',
      expectedMinScore: 0.3,
      expectedRisk: 'medium',
      lang: 'Hindi Devanagari',
    },
    {
      text: 'Calling from PayPal support, relative in hospital needs payment',
      category: 'impersonation',
      expectedMinScore: 0.3,
      expectedRisk: 'medium',
      lang: 'English',
    },
    {
      text: 'customs fee bharna padega tabhi parcel release hoga',
      category: 'refund_or_fee',
      expectedMinScore: 0.3,
      expectedRisk: 'medium',
      lang: 'Hinglish',
    },
    {
      text: 'Pay processing fee of 500 to receive tax refund',
      category: 'refund_or_fee',
      expectedMinScore: 0.3,
      expectedRisk: 'medium',
      lang: 'English',
    },
    {
      text: 'abhi payment karo nahi to account band ho jayega',
      category: 'pressure_to_pay_now',
      expectedMinScore: 0.3,
      expectedRisk: 'medium',
      lang: 'Hinglish',
    },
    {
      text: 'अभी पैसे भेजो नहीं तो खाता बंद हो जाएगा',
      category: 'pressure_to_pay_now',
      expectedMinScore: 0.3,
      expectedRisk: 'medium',
      lang: 'Hindi Devanagari',
    },
  ];

  const benignExamples = [
    'Mere paas kitna paisa hai?',
    'Balance check karo please',
    'Aapke paas kitne rupaye hain',
    'Bhaiya ko 500 rupaye bhej do',
    'Sabzi wale ko 120 rupaye dene hain',
    'Doodh wale ko payment kar do',
    'Auto wale bhaiya ko 80 rupaye de do',
    'Send 200 rupees to Ramesh',
    'Dukaan wale ko ration ke 450 rupaye transfer karo',
    'Ravi Cabs ko 250 rupaye de do',
    'Can you repeat the last transaction details?',
    'Aakhri payment kahan hui thi?',
    'Mummy ko 1000 rupaye bhejne hain',
    'Pay the tea stall 30 rupees',
  ];

  describe('Scam Phrase Detection across Categories and Languages', () => {
    scamExamples.forEach(({ text, category, expectedMinScore, expectedRisk, lang }) => {
      it(`identifies [${category}] in ${lang}: "${text.slice(0, 35)}..."`, () => {
        const result = detectScamSignals(text);

        expect(result.categories).toContain(category);
        expect(result.score).toBeGreaterThanOrEqual(expectedMinScore);
        expect(result.matches.length).toBeGreaterThan(0);

        const risk = combineRisk(result);
        if (expectedRisk === 'high') {
          expect(risk).toBe('high');
        } else {
          expect(['medium', 'high']).toContain(risk);
        }
      });
    });
  });

  describe('Benign & Harmless Phrases (Safety Invariant)', () => {
    benignExamples.forEach((phrase) => {
      it(`never flags harmless phrase as scam or high risk: "${phrase}"`, () => {
        const result = detectScamSignals(phrase);

        expect(result.score).toBe(0);
        expect(result.categories).toHaveLength(0);
        expect(result.matches).toHaveLength(0);

        const risk = combineRisk(result);
        expect(risk).toBe('low');
      });
    });
  });

  describe('Context Combination & Risk Escalation', () => {
    it('escalates benign phrase to high risk if payee is blocklisted', () => {
      const result = detectScamSignals('Bhaiya ko 500 rupaye bhej do');
      const risk = combineRisk(result, { payeeOnBlocklist: true });
      expect(risk).toBe('high');
    });

    it('escalates to medium risk if user was told to pay by caller with no scam keywords', () => {
      const result = detectScamSignals('Bhaiya ko 500 rupaye bhej do');
      const risk = combineRisk(result, { toldToPayBySomeone: true });
      expect(risk).toBe('medium');
    });

    it('escalates to high risk if user was told to pay by caller AND payee is unverified', () => {
      const result = detectScamSignals('Ravi ko 500 rupaye bhej do');
      const risk = combineRisk(result, {
        toldToPayBySomeone: true,
        unverifiedPayee: true,
      });
      expect(risk).toBe('high');
    });

    it('escalates to high risk if user was told to pay by caller AND urgency words present', () => {
      const result = detectScamSignals('jaldi bhej do');
      expect(result.categories).toContain('urgency');

      const risk = combineRisk(result, { toldToPayBySomeone: true });
      expect(risk).toBe('high');
    });

    it('escalates to medium risk when unverified payee has unusually high amount', () => {
      const result = detectScamSignals('Bhaiya ko 10000 rupaye transfer karo');
      const risk = combineRisk(result, {
        unverifiedPayee: true,
        unusuallyHighAmount: true,
      });
      expect(risk).toBe('medium');
    });

    it('handles empty or blank transcripts gracefully', () => {
      const result = detectScamSignals('   ');
      expect(result.score).toBe(0);
      expect(result.categories).toEqual([]);
      expect(combineRisk(result)).toBe('low');
    });
  });
});
