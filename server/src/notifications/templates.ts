export function formatFundingNotificationHindi(
  senderName: string,
  amount: number,
  newBalance: number
): string {
  const formattedAmount = amount.toLocaleString('en-IN');
  const formattedBalance = newBalance.toLocaleString('en-IN');
  return `${senderName} ne ${formattedAmount} rupaye bheje. Aapke paas ab ${formattedBalance} rupaye hain.`;
}
