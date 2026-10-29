export type ConversationState =
  | 'idle'
  | 'awaiting_confirmation'
  | 'awaiting_guardian_approval'
  | 'awaiting_scam_answers'
  | 'done';

export interface SessionData {
  sessionId: string;
  userId: string;
  state: ConversationState;
  lang?: 'hi' | 'en';
  currentTransactionId?: string;
  pendingPayeeName?: string;
  pendingAmount?: number;
  lastReply?: { text: string; lang: 'hi' | 'en' };
  unclearAttempts: number;
  updatedAt: number;

  // Task 13 scam interview fields
  scamInterviewStep?: 'asked_told_to_pay' | 'asked_knows_payee';
  scamToldToPay?: boolean;
  scamKnowsPayee?: boolean;
  isNewPayee?: boolean;
  accumulatedText?: string;
  pendingPayeeRaw?: string;

  // Task 16 invoice fields
  isInvoicePayment?: boolean;
  invoiceId?: string;

  // Task 17 history context fields
  lastHistoryList?: Array<{ id: string; payee: string; amount: number; time: string }>;
  historyIndex?: number;
}

const sessionStore = new Map<string, SessionData>();

export function getSession(sessionId: string, userId = 'user_meena'): SessionData {
  let session = sessionStore.get(sessionId);
  if (!session) {
    session = {
      sessionId,
      userId,
      state: 'idle',
      unclearAttempts: 0,
      updatedAt: Date.now(),
    };
    sessionStore.set(sessionId, session);
  }
  return session;
}

export function updateSession(
  sessionId: string,
  updates: Partial<SessionData>
): SessionData {
  const session = getSession(sessionId);
  Object.assign(session, updates, { updatedAt: Date.now() });
  sessionStore.set(sessionId, session);
  return session;
}

export function resetSession(sessionId: string): void {
  const session = sessionStore.get(sessionId);
  if (session) {
    session.state = 'idle';
    session.currentTransactionId = undefined;
    session.pendingPayeeName = undefined;
    session.pendingAmount = undefined;
    session.unclearAttempts = 0;
    session.updatedAt = Date.now();
    session.scamInterviewStep = undefined;
    session.scamToldToPay = undefined;
    session.scamKnowsPayee = undefined;
    session.isNewPayee = undefined;
    session.accumulatedText = undefined;
    session.pendingPayeeRaw = undefined;
  }
}

export function clearAllSessions(): void {
  sessionStore.clear();
}
