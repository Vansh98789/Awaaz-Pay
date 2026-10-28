// Data model types for Awaaz Pay SQLite database

export interface UserLimits {
  daily_total: number;
  per_transaction_new_payee: number;
  max_new_payees_per_day: number;
}

export interface User {
  id: string;
  name: string;
  language: string;
  limits: string; // JSON string representing UserLimits
  created_at: string;
}

export interface Guardian {
  id: string;
  user_id: string;
  name: string;
  contact: string;
  permissions: string;
}

export type ContactStatus = 'cooling_off' | 'active';

export interface Contact {
  id: string;
  user_id: string;
  alias: string;
  display_name: string;
  paypal_email: string;
  status: ContactStatus;
  added_by: string;
  activated_at: string | null;
}

export interface Merchant {
  id: string;
  name: string;
  paypal_email: string;
  verified: number; // 0 or 1
}

export interface Invoice {
  id: string;
  merchant_id: string;
  paypal_invoice_id: string;
  amount: number;
  currency: string;
  status: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  type: string;
  amount: number;
  currency: string;
  counterparty_type: string;
  counterparty_id: string;
  tier: number;
  risk_score: number;
  decision: string;
  status: string;
  paypal_ref: string | null;
  created_at: string;
}

export interface Approval {
  id: string;
  transaction_id: string;
  guardian_id: string;
  token: string;
  status: string;
  decided_at: string | null;
}

export interface Notification {
  id: string;
  user_id: string;
  kind: string;
  message: string;
  spoken_text: string;
  delivered: number; // 0 or 1
  created_at: string;
}

export interface AuditEvent {
  id: string;
  user_id: string;
  kind: string;
  payload: string; // JSON string
  created_at: string;
}

export interface BlocklistItem {
  id: string;
  paypal_email: string;
  reason: string;
}

export interface LedgerEntry {
  id: string;
  user_id: string;
  delta: number; // positive for credit (money in), negative for debit (money out)
  reason: string;
  ref: string | null;
  created_at: string;
}
