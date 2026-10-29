import { z } from 'zod';

export const IntentSchema = z.object({
  intent: z.enum([
    'send_money',
    'check_balance',
    'read_history',
    'explain_payment',
    'repeat',
    'confirm_yes',
    'confirm_no',
    'cancel',
    'report_scam',
    'add_helper_request',
    'unknown',
  ]),
  recipient_alias: z.string().nullable(),
  amount: z.number().nullable(),
  language: z.enum(['hi', 'en', 'hinglish']),
  confidence: z.number().min(0).max(1),
  scam_cues: z.array(z.string()),
  clarifying_question: z.string().nullable(),
});

export type IntentResult = z.infer<typeof IntentSchema>;
export type ConversationState = 'idle' | 'awaiting_confirmation' | string;
