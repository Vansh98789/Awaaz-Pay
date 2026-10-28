import { describe, expect, it } from 'vitest';
import { evaluatePayment } from '../src/rules/engine.js';
import type { PaymentContext, PaymentRequest } from '../src/rules/types.js';

describe('Payment Rules Engine', () => {
  const baseContext: PaymentContext = {
    todayTotalAmount: 0,
    todayNewPayeesTotalAmount: 0,
    todayNewPayeesCount: 0,
    isNewPayeeForToday: false,
    cumulativeAmountToThisPayee: 0,
    contactStatus: 'active',
    contactActivatedAt: new Date(Date.now() - 48 * 3600 * 1000).toISOString(), // 48 hrs ago
    recentPaymentTimestamps: [],
    medianPastPaymentAmount: 200,
    scamRisk: 'low',
    isBlocklisted: false,
    currentTimestamp: '2026-10-29T12:00:00Z',
  };

  // Test 1: Verified merchant spot payment (Cab demo scenario)
  it('allows a cab payment of ₹250 to a verified new merchant (Tier 2)', () => {
    const request: PaymentRequest = {
      amount: 250,
      currency: 'INR',
      payeeType: 'new_merchant_verified',
      payeeId: 'merchant_ravi_cabs',
    };

    const decision = evaluatePayment(request, {
      ...baseContext,
      isNewPayeeForToday: true,
      todayNewPayeesCount: 0,
    });

    expect(decision.action).toBe('allow_with_confirmation');
    expect(decision.tier).toBe(2);
    expect(decision.spoken_reason).toContain('confirm out loud');
  });

  // Test 2: Verified merchant exactly at cap
  it('allows a payment of ₹500 to a verified new merchant (Tier 2 max)', () => {
    const request: PaymentRequest = {
      amount: 500,
      currency: 'INR',
      payeeType: 'new_merchant_verified',
    };

    const decision = evaluatePayment(request, {
      ...baseContext,
      isNewPayeeForToday: true,
      todayNewPayeesCount: 0,
    });

    expect(decision.action).toBe('allow_with_confirmation');
    expect(decision.tier).toBe(2);
  });

  // Test 3: Verified merchant exceeding ₹500 cap
  it('requires guardian approval for verified merchant payment over ₹500', () => {
    const request: PaymentRequest = {
      amount: 501,
      currency: 'INR',
      payeeType: 'new_merchant_verified',
    };

    const decision = evaluatePayment(request, baseContext);

    expect(decision.action).toBe('need_guardian_approval');
    expect(decision.tier).toBe(3);
    expect(decision.reasons.some((r) => r.includes('exceeds per-payment cap'))).toBe(true);
  });

  // Test 4: Trusted contact routine payment
  it('allows payment of ₹500 to an active trusted contact (Tier 1)', () => {
    const request: PaymentRequest = {
      amount: 500,
      currency: 'INR',
      payeeType: 'trusted_contact',
      payeeId: 'contact_bhaiya',
    };

    const decision = evaluatePayment(request, baseContext);

    expect(decision.action).toBe('allow_with_confirmation');
    expect(decision.tier).toBe(1);
  });

  // Test 5: Trusted contact at ₹5,000 limit
  it('allows payment of ₹5,000 to an active trusted contact (Tier 1 max)', () => {
    const request: PaymentRequest = {
      amount: 5000,
      currency: 'INR',
      payeeType: 'trusted_contact',
    };

    const decision = evaluatePayment(request, {
      ...baseContext,
      medianPastPaymentAmount: 2000,
    });

    expect(decision.action).toBe('allow_with_confirmation');
    expect(decision.tier).toBe(1);
  });

  // Test 6: Trusted contact over ₹5,000 limit
  it('requires guardian approval when trusted contact payment exceeds ₹5,000', () => {
    const request: PaymentRequest = {
      amount: 5001,
      currency: 'INR',
      payeeType: 'trusted_contact',
    };

    const decision = evaluatePayment(request, baseContext);

    expect(decision.action).toBe('need_guardian_approval');
    expect(decision.tier).toBe(3);
    expect(decision.reasons.some((r) => r.includes('exceeds Tier 1'))).toBe(true);
  });

  // Test 7: Salami slicing attack (10 payments of 100 to 10 different payees)
  it('stops a salami-slicing attack: 10 payments of 100 to 10 different payees stopped by new payee count', () => {
    const request: PaymentRequest = {
      amount: 100,
      currency: 'INR',
      payeeType: 'new_personal',
    };

    // Payee 1: Allowed (count 0 -> 1)
    const decision1 = evaluatePayment(request, {
      ...baseContext,
      isNewPayeeForToday: true,
      todayNewPayeesCount: 0,
      todayNewPayeesTotalAmount: 0,
    });
    expect(decision1.action).toBe('allow_with_confirmation');

    // Payee 2: Allowed (count 1 -> 2)
    const decision2 = evaluatePayment(request, {
      ...baseContext,
      isNewPayeeForToday: true,
      todayNewPayeesCount: 1,
      todayNewPayeesTotalAmount: 100,
    });
    expect(decision2.action).toBe('allow_with_confirmation');

    // Payee 3: Blocked / approval needed because max new payees per day is 2
    const decision3 = evaluatePayment(request, {
      ...baseContext,
      isNewPayeeForToday: true,
      todayNewPayeesCount: 2,
      todayNewPayeesTotalAmount: 200,
    });
    expect(decision3.action).toBe('need_guardian_approval');
    expect(decision3.reasons.some((r) => r.includes('exceeds limit of 2 new payees'))).toBe(true);
  });

  // Test 8: Salami slicing aggregate cap (cumulative ₹1,000 daily to new payees)
  it('stops salami slicing when aggregate daily cap across new payees (₹1,000) is exceeded', () => {
    const request: PaymentRequest = {
      amount: 250,
      currency: 'INR',
      payeeType: 'new_merchant_verified',
    };

    const decision = evaluatePayment(request, {
      ...baseContext,
      isNewPayeeForToday: false,
      todayNewPayeesTotalAmount: 800, // 800 + 250 = 1050 > 1000
    });

    expect(decision.action).toBe('need_guardian_approval');
    expect(decision.reasons.some((r) => r.includes('exceeds cap of ₹1000'))).toBe(true);
  });

  // Test 9: Cumulative cap per single new payee (max ₹500)
  it('stops repeated payments to one new payee when cumulative cap of ₹500 is exceeded', () => {
    const request: PaymentRequest = {
      amount: 250,
      currency: 'INR',
      payeeType: 'new_merchant_verified',
    };

    // First payment: ₹300 paid previously, now attempting ₹250 (300 + 250 = 550 > 500)
    const decision = evaluatePayment(request, {
      ...baseContext,
      cumulativeAmountToThisPayee: 300,
    });

    expect(decision.action).toBe('need_guardian_approval');
    expect(decision.reasons.some((r) => r.includes('Cumulative spending to this new payee'))).toBe(
      true
    );
  });

  // Test 10: Cooling-off contact treated as new personal payee
  it('treats contacts with status cooling_off as new personal payees (capped at ₹300)', () => {
    const request: PaymentRequest = {
      amount: 250,
      currency: 'INR',
      payeeType: 'trusted_contact',
    };

    const decision = evaluatePayment(request, {
      ...baseContext,
      contactStatus: 'cooling_off',
    });

    // 250 is <= 300 cap for new personal accounts
    expect(decision.action).toBe('need_guardian_approval');
    expect(decision.reasons.some((r) => r.includes('cooling-off'))).toBe(true);
  });

  // Test 11: Cooling-off contact exceeding new payee limit requires approval
  it('requires guardian approval when cooling-off contact payment exceeds ₹300', () => {
    const request: PaymentRequest = {
      amount: 400,
      currency: 'INR',
      payeeType: 'trusted_contact',
    };

    const decision = evaluatePayment(request, {
      ...baseContext,
      contactStatus: 'cooling_off',
    });

    expect(decision.action).toBe('need_guardian_approval');
    expect(decision.tier).toBe(3);
  });

  // Test 12: Contact within 24 hours of creation is in cooling-off
  it('detects cooling-off based on contactActivatedAt within 24 hours', () => {
    const request: PaymentRequest = {
      amount: 200,
      currency: 'INR',
      payeeType: 'trusted_contact',
    };

    const decision = evaluatePayment(request, {
      ...baseContext,
      contactStatus: 'active',
      contactActivatedAt: '2026-10-29T08:00:00Z', // 4 hours before currentTimestamp
      currentTimestamp: '2026-10-29T12:00:00Z',
    });

    expect(decision.action).toBe('need_guardian_approval');
    expect(decision.reasons.some((r) => r.includes('cooling-off'))).toBe(true);
  });

  // Test 13: Contact past 24 hours is treated as Tier 1 trusted contact
  it('treats contact past 24 hours as Tier 1 trusted contact', () => {
    const request: PaymentRequest = {
      amount: 2000,
      currency: 'INR',
      payeeType: 'trusted_contact',
    };

    const decision = evaluatePayment(request, {
      ...baseContext,
      medianPastPaymentAmount: 1000,
      contactStatus: 'active',
      contactActivatedAt: '2026-10-28T10:00:00Z', // 26 hours before currentTimestamp
      currentTimestamp: '2026-10-29T12:00:00Z',
    });

    expect(decision.action).toBe('allow_with_confirmation');
    expect(decision.tier).toBe(1);
  });

  // Test 14: High scam risk blocks immediately
  it('blocks payment immediately when scam risk is high', () => {
    const request: PaymentRequest = {
      amount: 200,
      currency: 'INR',
      payeeType: 'trusted_contact',
    };

    const decision = evaluatePayment(request, {
      ...baseContext,
      scamRisk: 'high',
    });

    expect(decision.action).toBe('block');
    expect(decision.tier).toBe(3);
    expect(decision.spoken_reason).toContain('blocked due to high scam risk');
  });

  // Test 15: Medium scam risk requires guardian approval
  it('requires guardian approval when scam risk is medium', () => {
    const request: PaymentRequest = {
      amount: 200,
      currency: 'INR',
      payeeType: 'trusted_contact',
    };

    const decision = evaluatePayment(request, {
      ...baseContext,
      scamRisk: 'medium',
    });

    expect(decision.action).toBe('need_guardian_approval');
    expect(decision.tier).toBe(3);
    expect(decision.reasons.some((r) => r.includes('Medium scam risk'))).toBe(true);
  });

  // Test 16: Blocklisted payee blocks immediately
  it('blocks payment immediately when payee is blocklisted', () => {
    const request: PaymentRequest = {
      amount: 100,
      currency: 'INR',
      payeeType: 'new_merchant_verified',
    };

    const decision = evaluatePayment(request, {
      ...baseContext,
      isBlocklisted: true,
    });

    expect(decision.action).toBe('block');
    expect(decision.tier).toBe(3);
    expect(decision.spoken_reason).toContain('blocked for your safety');
  });

  // Test 17: Velocity check: 3 payments in 10 minutes triggers approval
  it('requires guardian approval when 3 payments occurred within 10 minutes', () => {
    const request: PaymentRequest = {
      amount: 100,
      currency: 'INR',
      payeeType: 'trusted_contact',
    };

    const now = new Date('2026-10-29T12:10:00Z').getTime();
    const decision = evaluatePayment(request, {
      ...baseContext,
      currentTimestamp: now,
      recentPaymentTimestamps: [
        new Date('2026-10-29T12:02:00Z').toISOString(),
        new Date('2026-10-29T12:05:00Z').toISOString(),
        new Date('2026-10-29T12:08:00Z').toISOString(),
      ],
    });

    expect(decision.action).toBe('need_guardian_approval');
    expect(decision.reasons.some((r) => r.includes('Velocity check failed'))).toBe(true);
  });

  // Test 18: Velocity check: 2 payments in 10 minutes allowed
  it('allows payment when only 2 payments occurred within 10 minutes', () => {
    const request: PaymentRequest = {
      amount: 100,
      currency: 'INR',
      payeeType: 'trusted_contact',
    };

    const now = new Date('2026-10-29T12:10:00Z').getTime();
    const decision = evaluatePayment(request, {
      ...baseContext,
      currentTimestamp: now,
      recentPaymentTimestamps: [
        new Date('2026-10-29T12:05:00Z').toISOString(),
        new Date('2026-10-29T12:08:00Z').toISOString(),
      ],
    });

    expect(decision.action).toBe('allow_with_confirmation');
  });

  // Test 19: Velocity check: 3 payments spaced out over 20 minutes allowed
  it('allows payment when 3 payments are spaced outside the 10-minute window', () => {
    const request: PaymentRequest = {
      amount: 100,
      currency: 'INR',
      payeeType: 'trusted_contact',
    };

    const now = new Date('2026-10-29T12:30:00Z').getTime();
    const decision = evaluatePayment(request, {
      ...baseContext,
      currentTimestamp: now,
      recentPaymentTimestamps: [
        new Date('2026-10-29T12:05:00Z').toISOString(), // 25 mins ago
        new Date('2026-10-29T12:12:00Z').toISOString(), // 18 mins ago
        new Date('2026-10-29T12:25:00Z').toISOString(), // 5 mins ago
      ],
    });

    expect(decision.action).toBe('allow_with_confirmation');
  });

  // Test 20: Median anomaly detection (> 3x median past amount)
  it('requires guardian approval when payment is greater than 3x the past median', () => {
    const request: PaymentRequest = {
      amount: 700,
      currency: 'INR',
      payeeType: 'trusted_contact',
    };

    // Median is 200, 3x threshold is 600, amount is 700
    const decision = evaluatePayment(request, {
      ...baseContext,
      medianPastPaymentAmount: 200,
    });

    expect(decision.action).toBe('need_guardian_approval');
    expect(decision.reasons.some((r) => r.includes('more than 3x your past median'))).toBe(true);
  });

  // Test 21: Median anomaly detection (<= 3x median allowed)
  it('allows payment when amount is within 3x of past median', () => {
    const request: PaymentRequest = {
      amount: 600,
      currency: 'INR',
      payeeType: 'trusted_contact',
    };

    const decision = evaluatePayment(request, {
      ...baseContext,
      medianPastPaymentAmount: 200,
    });

    expect(decision.action).toBe('allow_with_confirmation');
  });

  // Test 22: New personal account payment within ₹300 allowed
  it('allows spot payment of ₹300 to a new personal account (Tier 2)', () => {
    const request: PaymentRequest = {
      amount: 300,
      currency: 'INR',
      payeeType: 'new_personal',
    };

    const decision = evaluatePayment(request, {
      ...baseContext,
      isNewPayeeForToday: true,
      todayNewPayeesCount: 0,
    });

    expect(decision.action).toBe('allow_with_confirmation');
    expect(decision.tier).toBe(2);
  });

  // Test 23: New personal account payment over ₹300 requires approval
  it('requires guardian approval for new personal account payment over ₹300', () => {
    const request: PaymentRequest = {
      amount: 301,
      currency: 'INR',
      payeeType: 'new_personal',
    };

    const decision = evaluatePayment(request, baseContext);

    expect(decision.action).toBe('need_guardian_approval');
    expect(decision.tier).toBe(3);
    expect(decision.reasons.some((r) => r.includes('exceeds per-payment cap of ₹300'))).toBe(true);
  });

  // Test 24: Total daily spending limit exceeded
  it('requires guardian approval when total daily budget is exceeded', () => {
    const request: PaymentRequest = {
      amount: 500,
      currency: 'INR',
      payeeType: 'trusted_contact',
    };

    const decision = evaluatePayment(request, {
      ...baseContext,
      userLimits: { daily_total: 1000 },
      todayTotalAmount: 700, // 700 + 500 = 1200 > 1000
    });

    expect(decision.action).toBe('need_guardian_approval');
    expect(decision.reasons.some((r) => r.includes('exceeds daily limit'))).toBe(true);
  });

  // Test 25: Zero or negative amount blocks
  it('blocks transactions with zero or negative amounts', () => {
    const decisionZero = evaluatePayment(
      { amount: 0, currency: 'INR', payeeType: 'trusted_contact' },
      baseContext
    );
    expect(decisionZero.action).toBe('block');

    const decisionNegative = evaluatePayment(
      { amount: -50, currency: 'INR', payeeType: 'trusted_contact' },
      baseContext
    );
    expect(decisionNegative.action).toBe('block');
  });

  // Test 26: Custom config overrides default limits
  it('allows custom config to override default thresholds', () => {
    const request: PaymentRequest = {
      amount: 800,
      currency: 'INR',
      payeeType: 'new_merchant_verified',
    };

    // By default 800 > 500 fails. With custom cap 1000 it passes:
    const decision = evaluatePayment(
      request,
      {
        ...baseContext,
        medianPastPaymentAmount: 500,
        isNewPayeeForToday: true,
        todayNewPayeesCount: 0,
      },
      {
        tier2NewMerchantPerPaymentMax: 1000,
        tier2SingleNewPayeeCumulativeMax: 1000,
      }
    );

    expect(decision.action).toBe('allow_with_confirmation');
    expect(decision.tier).toBe(2);
  });
});
