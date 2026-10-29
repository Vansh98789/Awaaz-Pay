/**
 * QR Code Parser for PayPal and Awaaz Pay Invoices.
 * Handles direct invoice IDs, PayPal invoice URLs (sandbox & production),
 * URL hash anchors, query parameters, and JSON payloads.
 */
export function parseInvoiceQr(qrData: string): string | null {
  if (!qrData || typeof qrData !== 'string') return null;
  const raw = qrData.trim();

  // 1. JSON payload check
  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed.invoiceId) return String(parsed.invoiceId).trim();
      if (parsed.invoice_id) return String(parsed.invoice_id).trim();
      if (parsed.id) return String(parsed.id).trim();
    } catch {
      // ignore JSON parse error
    }
  }

  // 2. Direct regex match for PayPal Invoice ID format
  const paypalIdMatch = raw.match(/\b(INV2-[A-Za-z0-9-]+|INV-[A-Za-z0-9-]+|inv_[A-Za-z0-9_-]+)\b/);
  if (paypalIdMatch) {
    return paypalIdMatch[1];
  }

  // 3. URL match with invoice in path, hash, or query parameter
  try {
    const url = new URL(raw);
    const idParam =
      url.searchParams.get('invoice_id') ||
      url.searchParams.get('id') ||
      url.searchParams.get('inv');
    if (idParam) return idParam.trim();

    if (url.hash) {
      const hashMatch = url.hash.match(/(INV2-[A-Za-z0-9-]+|INV-[A-Za-z0-9-]+|[A-Za-z0-9_-]{8,})/);
      if (hashMatch) return hashMatch[1];
    }

    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length > 0) {
      const last = segments[segments.length - 1];
      if (/^(INV2-|INV-|inv_|[A-Za-z0-9_-]{8,})/i.test(last)) {
        return last;
      }
    }
  } catch {
    // not a valid URL
  }

  // 4. Raw identifier fallback
  if (/^[A-Za-z0-9_-]{6,64}$/.test(raw)) {
    return raw;
  }

  return null;
}
