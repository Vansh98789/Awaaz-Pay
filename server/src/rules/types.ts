export type PayeeType = 'trusted_contact' | 'new_merchant_verified' | 'new_personal';

export type ScamRiskLevel = 'low' | 'medium' | 'high';

export type DecisionAction = 'allow_with_confirmation' | 'need_guardian_approval' | 'block';

export type PaymentTier = 1 | 2 | 3;

export interface PaymentRequest {
  amount: number;
  currency: string;
  payeeType: PayeeType;
  payeeId?: string;
  payeeName?: string;
}

export interface UserPaymentLimits {
  daily_total?: number;
  per_transaction_new_payee?: number;
  max_new_payees_per_day?: number;
}

export interface PaymentContext {
  userLimits?: UserPaymentLimits;
  todayTotalAmount: number;
  todayNewPayeesTotalAmount: number;
  todayNewPayeesCount: number;
  isNewPayeeForToday: boolean;
  cumulativeAmountToThisPayee: number;
  contactStatus?: 'cooling_off' | 'active';
  contactActivatedAt?: string | null;
  recentPaymentTimestamps: (string | Date | number)[];
  medianPastPaymentAmount?: number | null;
  scamRisk: ScamRiskLevel;
  isBlocklisted: boolean;
  currentTimestamp?: string | Date | number;
}

export interface RulesConfig {
  tier1PerPaymentMax: number;
  tier1DailyTotalDefault: number;
  tier2NewMerchantPerPaymentMax: number;
  tier2NewPersonalPerPaymentMax: number;
  tier2NewPayeesDailyTotalMax: number;
  tier2NewPayeesDailyCountMax: number;
  tier2SingleNewPayeeCumulativeMax: number;
  velocityWindowMinutes: number;
  velocityMaxPayments: number;
  medianMultiplierMax: number;
  coolingOffHours: number;
}

export const DEFAULT_RULES_CONFIG: RulesConfig = {
  tier1PerPaymentMax: 5000,
  tier1DailyTotalDefault: 5000,
  tier2NewMerchantPerPaymentMax: 500,
  tier2NewPersonalPerPaymentMax: 300,
  tier2NewPayeesDailyTotalMax: 1000,
  tier2NewPayeesDailyCountMax: 2,
  tier2SingleNewPayeeCumulativeMax: 500,
  velocityWindowMinutes: 10,
  velocityMaxPayments: 3,
  medianMultiplierMax: 3,
  coolingOffHours: 24,
};

export interface Decision {
  action: DecisionAction;
  tier: PaymentTier;
  reasons: string[];
  spoken_reason: string;
}
