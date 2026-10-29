import {
  DEFAULT_RULES_CONFIG,
  type Decision,
  type PaymentContext,
  type PaymentRequest,
  type PayeeType,
  type RulesConfig,
} from './types.js';

function getRecentPaymentCount(
  timestamps: (string | Date | number)[],
  nowMs: number,
  windowMinutes: number
): number {
  const windowMs = windowMinutes * 60 * 1000;
  return timestamps.filter((ts) => {
    const timeMs = new Date(ts).getTime();
    return nowMs - timeMs >= 0 && nowMs - timeMs <= windowMs;
  }).length;
}

function isContactInCoolingOff(
  context: PaymentContext,
  nowMs: number,
  coolingOffHours: number
): boolean {
  if (context.contactStatus === 'cooling_off') {
    return true;
  }
  if (context.contactActivatedAt) {
    const activatedMs = new Date(context.contactActivatedAt).getTime();
    const requiredDurationMs = coolingOffHours * 60 * 60 * 1000;
    return nowMs - activatedMs < requiredDurationMs;
  }
  return false;
}

export function evaluatePayment(
  request: PaymentRequest,
  context: PaymentContext,
  userConfig?: Partial<RulesConfig>
): Decision {
  const config: RulesConfig = { ...DEFAULT_RULES_CONFIG, ...userConfig };
  const nowMs = context.currentTimestamp
    ? new Date(context.currentTimestamp).getTime()
    : Date.now();

  if (context.isBlocklisted) {
    return {
      action: 'block',
      tier: 3,
      reasons: ['Payee is on safety blocklist'],
      spoken_reason: 'This payee is blocked for your safety.',
    };
  }

  if (context.scamRisk === 'high') {
    return {
      action: 'block',
      tier: 3,
      reasons: ['High scam risk detected by safety analysis'],
      spoken_reason: 'This payment was blocked due to high scam risk.',
    };
  }

  if (request.amount <= 0) {
    return {
      action: 'block',
      tier: 3,
      reasons: ['Payment amount must be greater than zero'],
      spoken_reason: 'Payment amount must be greater than zero.',
    };
  }

  const approvalReasons: string[] = [];
  let primarySpokenReason: string | null = null;

  if (context.scamRisk === 'medium') {
    approvalReasons.push('Medium scam risk detected');
    primarySpokenReason = 'Suspicious activity detected. Ramesh must approve this payment.';
  }

  const recentPaymentsCount = getRecentPaymentCount(
    context.recentPaymentTimestamps,
    nowMs,
    config.velocityWindowMinutes
  );
  if (recentPaymentsCount >= config.velocityMaxPayments) {
    approvalReasons.push(
      `Velocity check failed: ${recentPaymentsCount} payments in the last ${config.velocityWindowMinutes} minutes`
    );
    primarySpokenReason =
      primarySpokenReason ?? 'Too many rapid payments. Guardian approval is required.';
  }

  if (
    context.medianPastPaymentAmount !== undefined &&
    context.medianPastPaymentAmount !== null &&
    context.medianPastPaymentAmount > 0
  ) {
    const threshold = config.medianMultiplierMax * context.medianPastPaymentAmount;
    if (request.amount > threshold) {
      approvalReasons.push(
        `Amount ₹${request.amount} is more than ${config.medianMultiplierMax}x your past median of ₹${context.medianPastPaymentAmount}`
      );
      primarySpokenReason =
        primarySpokenReason ??
        'This payment is unusually large for your history. Guardian approval is required.';
    }
  }

  const effectiveDailyLimit =
    context.userLimits?.daily_total ?? config.tier1DailyTotalDefault;
  if (context.todayTotalAmount + request.amount > effectiveDailyLimit) {
    approvalReasons.push(
      `Total spending today (₹${context.todayTotalAmount + request.amount}) exceeds daily limit of ₹${effectiveDailyLimit}`
    );
    primarySpokenReason =
      primarySpokenReason ??
      'This payment exceeds your daily spending limit. Guardian approval is required.';
  }

  let effectivePayeeType: PayeeType = request.payeeType;
  if (request.payeeType === 'trusted_contact') {
    if (isContactInCoolingOff(context, nowMs, config.coolingOffHours)) {
      effectivePayeeType = 'new_personal';
      approvalReasons.push(
        'Contact is in 24-hour cooling-off period and treated as a new payee'
      );
      primarySpokenReason =
        primarySpokenReason ??
        'This contact is newly added and in cooling-off. Guardian approval is required.';
    }
  }

  if (effectivePayeeType === 'trusted_contact') {
    if (request.amount > config.tier1PerPaymentMax) {
      approvalReasons.push(
        `Amount ₹${request.amount} exceeds Tier 1 trusted contact per-payment cap of ₹${config.tier1PerPaymentMax}`
      );
      primarySpokenReason =
        primarySpokenReason ??
        'Amount exceeds trusted contact limit. Guardian approval is required.';
    }

    if (approvalReasons.length > 0) {
      return {
        action: 'need_guardian_approval',
        tier: 3,
        reasons: approvalReasons,
        spoken_reason:
          primarySpokenReason ?? 'Guardian approval is required for this transaction.',
      };
    }

    return {
      action: 'allow_with_confirmation',
      tier: 1,
      reasons: ['Trusted contact within Tier 1 limits'],
      spoken_reason: 'Payment allowed. Please confirm out loud.',
    };
  }

  const isMerchant = effectivePayeeType === 'new_merchant_verified';
  const perPaymentCap = isMerchant
    ? (context.userLimits?.per_transaction_new_payee ?? config.tier2NewMerchantPerPaymentMax)
    : config.tier2NewPersonalPerPaymentMax;

  if (request.amount > perPaymentCap) {
    approvalReasons.push(
      `Amount ₹${request.amount} exceeds per-payment cap of ₹${perPaymentCap} for new ${isMerchant ? 'merchant' : 'personal account'}`
    );
  }

  if (
    context.todayNewPayeesTotalAmount + request.amount >
    config.tier2NewPayeesDailyTotalMax
  ) {
    approvalReasons.push(
      `Combined spending on new payees today (₹${context.todayNewPayeesTotalAmount + request.amount}) exceeds cap of ₹${config.tier2NewPayeesDailyTotalMax}`
    );
  }

  const maxNewPayees =
    context.userLimits?.max_new_payees_per_day ?? config.tier2NewPayeesDailyCountMax;
  if (context.isNewPayeeForToday && context.todayNewPayeesCount >= maxNewPayees) {
    approvalReasons.push(
      `New payees count today (${context.todayNewPayeesCount + 1}) exceeds limit of ${maxNewPayees} new payees per day`
    );
  }

  if (
    context.cumulativeAmountToThisPayee + request.amount >
    config.tier2SingleNewPayeeCumulativeMax
  ) {
    approvalReasons.push(
      `Cumulative spending to this new payee (₹${context.cumulativeAmountToThisPayee + request.amount}) exceeds cap of ₹${config.tier2SingleNewPayeeCumulativeMax}`
    );
  }

  if (approvalReasons.length > 0) {
    return {
      action: 'need_guardian_approval',
      tier: 3,
      reasons: approvalReasons,
      spoken_reason:
        primarySpokenReason ??
        'This payment exceeds new payee limits. Guardian approval is required.',
    };
  }

  return {
    action: 'allow_with_confirmation',
    tier: 2,
    reasons: [
      `Spot payment to new ${isMerchant ? 'verified merchant' : 'personal account'} within Tier 2 caps`,
    ],
    spoken_reason: 'Small spot payment allowed. Please confirm out loud.',
  };
}
