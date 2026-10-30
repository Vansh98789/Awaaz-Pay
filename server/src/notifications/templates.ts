export function formatFundingNotificationHindi(
  senderName: string,
  amount: number,
  currency = 'USD'
): string {
  const formattedAmount = amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${senderName} ne PayPal Sandbox sender account mein ${formattedAmount} ${currency} bheje.`;
}
