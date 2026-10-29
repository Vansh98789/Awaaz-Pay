import { ppRequest } from './client.js';

export interface PayPalBalance {
  currency: string;
  primary: boolean;
  total_balance: { currency_code: string; value: string };
  available_balance: { currency_code: string; value: string };
  withheld_balance?: { currency_code: string; value: string };
}

export interface PayPalBalancesResponse {
  balances: PayPalBalance[];
  account_id?: string;
  as_of_time?: string;
  last_refresh_time?: string;
}

export async function getPayPalBalances(currencyCode = 'USD'): Promise<PayPalBalancesResponse> {
  const query = new URLSearchParams({ currency_code: currencyCode });
  return ppRequest<PayPalBalancesResponse>('GET', `/v1/reporting/balances?${query.toString()}`);
}
