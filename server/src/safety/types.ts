// Type definitions for rule-based scam signal detector

export type ScamCategory =
  | 'urgency'
  | 'threat_authority'
  | 'secrecy'
  | 'prize_lottery'
  | 'otp_kyc'
  | 'impersonation'
  | 'refund_or_fee'
  | 'pressure_to_pay_now';

export interface MatchedSignal {
  category: ScamCategory;
  phrase: string;
  weight: number;
}

export interface ScamDetectionResult {
  score: number; // Normalized score between 0 and 1
  categories: ScamCategory[];
  matches: MatchedSignal[];
}

export interface RiskContextFlags {
  unverifiedPayee?: boolean;
  unusuallyHighAmount?: boolean;
  rapidSequence?: boolean;
  payeeOnBlocklist?: boolean;
  toldToPayBySomeone?: boolean;
}

export type ScamRiskLevel = 'low' | 'medium' | 'high';

export interface CategoryDefinition {
  category: ScamCategory;
  baseWeight: number; // Weight contributed to overall scam score
  isCritical: boolean; // Triggers immediate high risk if matched
  phrases: string[];
}
