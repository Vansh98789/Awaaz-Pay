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
  lang: 'hi' | 'en';
  currentTransactionId?: string;
  pendingPayeeName?: string;
  pendingAmount?: number;
  lastReply?: { text: string; lang: 'hi' | 'en' };
  unclearAttempts: number;
  updatedAt: number;
}

const sessionStore = new Map<string, SessionData>();

export function getSession(sessionId: string, userId = 'user_meena'): SessionData {
  let session = sessionStore.get(sessionId);
  if (!session) {
    session = {
      sessionId,
      userId,
      state: 'idle',
      lang: 'hi',
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
  }
}

export function clearAllSessions(): void {
  sessionStore.clear();
}
