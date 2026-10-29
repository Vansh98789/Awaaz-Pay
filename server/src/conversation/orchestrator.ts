import type Database from 'better-sqlite3';
import { parseIntent } from '../intent/parseIntent.js';
import { listContacts, getBalance, getUserById } from '../db/repository.js';
import { preparePayment, confirmPayment } from '../payments/pipeline.js';
import { templates } from './templates.js';
import {
  getSession,
  updateSession,
  resetSession,
  type ConversationState,
} from './session.js';

export interface ConverseResponse {
  replyText: string;
  replyLanguage: 'hi' | 'en';
  state: ConversationState;
  actions?: Record<string, unknown>;
}

export async function processConversation(
  db: Database.Database,
  sessionId: string,
  text: string,
  userId = 'user_meena'
): Promise<ConverseResponse> {
  const session = getSession(sessionId, userId);
  const user = getUserById(db, userId);

  const lang: 'hi' | 'en' =
    session.lang || (user?.language === 'en' ? 'en' : 'hi');

  const contactsList = listContacts(db, userId);
  const contactAliases = contactsList.map((c) => c.alias);

  let replyText = '';

  if (session.state === 'awaiting_confirmation') {
    const intentResult = await parseIntent(
      text,
      contactAliases,
      'awaiting_confirmation'
    );

    if (intentResult.intent === 'confirm_yes') {
      const confirmRes = await confirmPayment(db, {
        transactionId: session.currentTransactionId!,
        userConfirmed: true,
      });

      if (confirmRes.status === 'completed') {
        replyText = templates[lang].payment_success(
          session.pendingPayeeName || 'Payee',
          session.pendingAmount || 0,
          confirmRes.newBalance
        );
      } else if (confirmRes.error?.includes('Insufficient balance')) {
        replyText = templates[lang].insufficient_funds(
          confirmRes.balance || 0,
          session.pendingAmount || 0
        );
      } else {
        replyText = templates[lang].payment_failed;
      }

      resetSession(sessionId);
    } else if (
      intentResult.intent === 'confirm_no' ||
      intentResult.intent === 'cancel'
    ) {
      if (session.currentTransactionId) {
        await confirmPayment(db, {
          transactionId: session.currentTransactionId,
          userConfirmed: false,
        });
      }
      replyText = templates[lang].payment_cancelled;
      resetSession(sessionId);
    } else {
      session.unclearAttempts++;
      if (session.unclearAttempts < 2) {
        replyText = templates[lang].unclear_first_try;
        updateSession(sessionId, { unclearAttempts: session.unclearAttempts });
      } else {
        if (session.currentTransactionId) {
          await confirmPayment(db, {
            transactionId: session.currentTransactionId,
            userConfirmed: false,
          });
        }
        replyText = templates[lang].unclear_cancel;
        resetSession(sessionId);
      }
    }
  } else {
    const intentResult = await parseIntent(text, contactAliases, 'idle');

    if (intentResult.intent === 'repeat') {
      replyText = session.lastReply
        ? session.lastReply.text
        : templates[lang].no_prior_reply;
    } else if (intentResult.intent === 'cancel') {
      replyText = templates[lang].payment_cancelled;
      resetSession(sessionId);
    } else if (intentResult.intent === 'check_balance') {
      const balance = getBalance(db, userId);
      replyText = templates[lang].check_balance(balance);
    } else if (intentResult.intent === 'send_money') {
      if (!intentResult.amount) {
        replyText = templates[lang].clarify_amount;
      } else if (!intentResult.recipient_alias) {
        replyText = templates[lang].clarify_recipient;
      } else {
        try {
          const prep = preparePayment(db, {
            userId,
            payee: intentResult.recipient_alias,
            amount: intentResult.amount,
          });

          if (prep.decision.action === 'allow_with_confirmation') {
            updateSession(sessionId, {
              state: 'awaiting_confirmation',
              currentTransactionId: prep.transactionId,
              pendingPayeeName: prep.payee,
              pendingAmount: prep.amount,
              unclearAttempts: 0,
            });
            replyText = templates[lang].ask_confirmation(prep.payee, prep.amount);
          } else if (prep.decision.action === 'need_guardian_approval') {
            updateSession(sessionId, { state: 'awaiting_guardian_approval' });
            const guardian = db
              .prepare<[string], { name: string }>(
                'SELECT name FROM guardians WHERE user_id = ?'
              )
              .get(userId);
            replyText = templates[lang].guardian_approval_needed(
              guardian?.name || 'Ramesh'
            );
          } else {
            resetSession(sessionId);
            replyText = templates[lang].payment_blocked(
              prep.decision.spoken_reason
            );
          }
        } catch (err) {
          replyText = `Error: ${(err as Error).message}`;
        }
      }
    } else {
      replyText = templates[lang].unknown_intent;
    }
  }

  const currentSession = getSession(sessionId, userId);
  currentSession.lastReply = { text: replyText, lang };

  return {
    replyText,
    replyLanguage: lang,
    state: currentSession.state,
  };
}
