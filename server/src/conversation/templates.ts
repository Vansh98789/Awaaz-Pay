export interface ConversationTemplates {
  welcome: string;
  clarify_amount: string;
  clarify_recipient: string;
  ask_confirmation: (name: string, amount: number) => string;
  payment_success: (name: string, amount: number) => string;
  payment_cancelled: string;
  payment_blocked: (reason?: string) => string;
  guardian_approval_needed: (guardianName: string) => string;
  payment_failed: string;
  unclear_first_try: string;
  unclear_cancel: string;
  check_balance: (availableUsd: string) => string;
  unknown_intent: string;
  no_prior_reply: string;
  scam_ask_told_to_pay: string;
  scam_ask_knows_payee: string;
  scam_blocked_interruption: string;
}

export const templates: Record<'hi' | 'en', ConversationTemplates> = {
  hi: {
    welcome: 'Namaste Meena ji. Boliye, main sun rahi hoon.',
    clarify_amount: 'Kitne US dollars bhejne hain? Kripya rakam dollars mein boliye.',
    clarify_recipient: 'Kisko paisa bhejna hai? Kripya naam bolein.',
    ask_confirmation: (name: string, amount: number) =>
      `${name} ko ${amount} US dollars bhejne hain. Kya main bhej doon? Haan ya nahi bolein.`,
    payment_success: (name: string, amount: number) =>
      `Payment safal raha. ${name} ko ${amount} US dollars bhej diye gaye.`,
    payment_cancelled: 'Theek hai, payment cancel kar diya gaya.',
    payment_blocked: (reason?: string) =>
      reason
        ? `Suraksha ke kaaran yeh payment rok diya gaya hai. ${reason}`
        : 'Suraksha ke kaaran yeh payment rok diya gaya hai.',
    guardian_approval_needed: (guardianName: string) =>
      `Yeh payment ${guardianName} ji ki manzoori ke bina nahi ho sakta. Approval request bhej di gayi hai.`,
    payment_failed: 'PayPal Sandbox payment safal nahi hua. Dobara bhejne se pehle PayPal activity check karein.',
    unclear_first_try: "Samajh nahi aaya. Kripya 'haan' ya 'nahi' bolein.",
    unclear_cancel: 'Do baar samajh nahi aaya. Suraksha ke liye payment cancel kar diya gaya hai.',
    check_balance: (availableUsd: string) =>
      `PayPal Sandbox sender account mein ${availableUsd} US dollars available hain.`,
    unknown_intent: 'Samajh nahi aaya. Madad ke liye help boliye. Aap scanner khol sakte hain, activity dekh sakte hain, balance pooch sakte hain, ya kisi contact ko paise bhej sakte hain.',
    no_prior_reply: 'Dohraane ke liye koi pichla jawab nahi hai.',
    scam_ask_told_to_pay: 'Kya kisi ne phone ya message par aapko ye payment karne ko kaha hai?',
    scam_ask_knows_payee: 'Kya aap is insaan ko jaante hain?',
    scam_blocked_interruption:
      'Rukiye, yeh ek scam ho sakta hai. Asli bank ya police kabhi bhi is tarah phone par OTP ya paise nahi maangte. Main yeh payment rok rahi hoon. Kya main aapke parivaar ke kisi sadasya ko phone karoon?',
  },
  en: {
    welcome: 'Hello Meena. I am listening. How can I help you?',
    clarify_amount: 'How many US dollars would you like to send? Please say the amount in dollars.',
    clarify_recipient: 'Who would you like to send money to? Please say the name.',
    ask_confirmation: (name: string, amount: number) =>
      `Send $${amount.toFixed(2)} to ${name}? Say yes to confirm or no to cancel.`,
    payment_success: (name: string, amount: number) =>
      `Payment successful. Sent $${amount.toFixed(2)} to ${name}.`,
    payment_cancelled: 'The payment has been cancelled.',
    payment_blocked: (reason?: string) =>
      reason
        ? `This payment was blocked for your safety. ${reason}`
        : 'This payment was blocked for your safety.',
    guardian_approval_needed: (guardianName: string) =>
      `Guardian approval from ${guardianName} is required for this payment. Request sent.`,
    payment_failed: 'PayPal Sandbox did not confirm the payment. Check PayPal activity before retrying.',
    unclear_first_try: "I did not catch that. Please say 'yes' or 'no'.",
    unclear_cancel: 'I could not hear confirmation. For safety, the payment was cancelled.',
    check_balance: (availableUsd: string) =>
      `Your PayPal Sandbox sender account has ${availableUsd} US dollars available.`,
    unknown_intent: 'I did not understand. Say help for options. You can open the scanner, show activity, check a balance, or send money to a contact.',
    no_prior_reply: 'There is no previous reply to repeat.',
    scam_ask_told_to_pay: 'Did someone ask you over a phone call or message to make this payment?',
    scam_ask_knows_payee: 'Do you know this person?',
    scam_blocked_interruption:
      'Wait, this may be a scam. Real banks or police never ask for OTPs or money like this. I am stopping this payment. Would you like me to call a family member?',
  },
};
