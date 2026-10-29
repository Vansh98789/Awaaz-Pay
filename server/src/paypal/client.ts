import { config } from '../config.js';
import { getAccessToken } from './auth.js';
import { PayPalError } from './types.js';

export async function ppRequest<T>(
  method: string,
  path: string,
  options: {
    body?: unknown;
    idempotencyKey?: string;
    responseType?: 'json' | 'buffer';
  } = {},
): Promise<T> {
  const token = await getAccessToken();
  const { body, idempotencyKey, responseType = 'json' } = options;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  if (idempotencyKey) {
    headers['PayPal-Request-Id'] = idempotencyKey;
  }

  const res = await fetch(`${config.PAYPAL_BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => res.statusText);
    throw new PayPalError(res.status, errBody, path);
  }

  if (res.status === 204) return undefined as T;
  if (responseType === 'buffer') return Buffer.from(await res.arrayBuffer()) as unknown as T;
  return res.json() as Promise<T>;
}
