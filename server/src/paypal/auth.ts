import { config } from '../config.js';

interface TokenCache {
  access_token: string;
  expires_at: number;
}

let cache: TokenCache | null = null;

export function clearTokenCache(): void {
  cache = null;
}

export async function getAccessToken(): Promise<string> {
  if (cache && Date.now() < cache.expires_at - 60_000) {
    return cache.access_token;
  }

  const credentials = Buffer.from(
    `${config.PAYPAL_CLIENT_ID}:${config.PAYPAL_CLIENT_SECRET}`,
  ).toString('base64');

  const res = await fetch(`${config.PAYPAL_BASE_URL}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`PayPal auth failed ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cache = {
    access_token: data.access_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };

  return cache.access_token;
}
