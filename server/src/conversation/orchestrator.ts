import type Database from 'better-sqlite3';
import { parseIntent } from '../intent/parseIntent.js';
import {
  listContacts,
  getBalance,
  getUserById,
  createNotification,
  writeAudit,
  recordTransaction,
  getApprovalByTransactionId,
  getInvoiceByPaypalId,
  getInvoiceById,
  updateInvoiceStatus,
} from '../db/repository.js';
import { parseInvoiceQr } from '../payments/qrParser.js';
import { preparePayment, confirmPayment } from '../payments/pipeline.js';
import { resolvePayee, buildPaymentContext } from '../payments/context.js';
import { evaluatePayment } from '../rules/engine.js';
import { detectScamSignals, combineRisk } from '../safety/scamSignals.js';
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
  const merchantsList = (
    db.prepare('SELECT name FROM merchants').all() as Array<{ name: string }>
  ).map((m) => m.name);
  const contactAliases = [
    ...contactsList.map((c) => c.alias),
    ...contactsList.map((c) => c.display_name),
    ...merchantsList,
  ];

  let replyText = '';

  if (session.state === 'awaiting_confirmation') {
    const intentResult = await parseIntent(
      text,
      contactAliases,
      'awaiting_confirmation'
    );

    const mentionsNumber = /\b\d+\b/.test(text) || intentResult.amount !== undefined;

    if (session.isInvoicePayment && mentionsNumber && intentResult.intent !== 'confirm_yes') {
      replyText =
        lang === 'hi'
          ? `Yeh payment invoice se hai. Amount ₹${session.pendingAmount} badla nahi ja sakta. Bhejne ke liye haan bolein.`
          : `The amount comes from the invoice and cannot be changed by voice. Say yes to pay.`;
    } else if (intentResult.intent === 'confirm_yes') {
      const confirmRes = await confirmPayment(db, {
        transactionId: session.currentTransactionId!,
        userConfirmed: true,
      });

      if (confirmRes.status === 'completed') {
        if (session.invoiceId) {
          updateInvoiceStatus(db, session.invoiceId, 'PAID');
        }
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
  } else if (session.state === 'awaiting_guardian_approval') {
    const approval = session.currentTransactionId
      ? getApprovalByTransactionId(db, session.currentTransactionId)
      : null;
    const guardian = db
      .prepare<[string], { name: string }>(
        'SELECT name FROM guardians WHERE user_id = ?'
      )
      .get(userId);
    const guardianName = guardian?.name || 'Ramesh';

    if (approval?.status === 'approved') {
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
        replyText = templates[lang].ask_confirmation(
          session.pendingPayeeName || 'Payee',
          session.pendingAmount || 0
        );
      }
    } else if (approval?.status === 'denied') {
      replyText =
        lang === 'hi'
          ? `${guardianName} ji ne yeh payment reject kar diya hai. Payment cancel ho gaya hai.`
          : `${guardianName} denied this payment. The payment has been cancelled.`;
      resetSession(sessionId);
    } else {
      const intentResult = await parseIntent(text, contactAliases, 'idle');
      if (intentResult.intent === 'cancel') {
        if (session.currentTransactionId) {
          await confirmPayment(db, {
            transactionId: session.currentTransactionId,
            userConfirmed: false,
          });
        }
        replyText = templates[lang].payment_cancelled;
        resetSession(sessionId);
      } else {
        replyText =
          lang === 'hi'
            ? `${guardianName} ji ki manzoori ka intezaar hai. Kripya thoda intezaar karein.`
            : `Waiting for ${guardianName}'s approval. Please wait.`;
      }
    }
  } else if (session.state === 'awaiting_scam_answers') {
    const accumulatedText = `${session.accumulatedText || ''} ${text}`.trim();
    const intentResult = await parseIntent(
      text,
      contactAliases,
      'awaiting_scam_answers'
    );

    if (intentResult.intent === 'cancel') {
      replyText = templates[lang].payment_cancelled;
      resetSession(sessionId);
      return {
        replyText,
        replyLanguage: lang,
        state: 'idle',
      };
    }

    let userChoice: 'yes' | 'no' | null = null;
    if (intentResult.intent === 'confirm_yes') {
      userChoice = 'yes';
    } else if (intentResult.intent === 'confirm_no') {
      userChoice = 'no';
    }

    if (userChoice === null) {
      session.unclearAttempts++;
      if (session.unclearAttempts < 2) {
        replyText = templates[lang].unclear_first_try;
        updateSession(sessionId, {
          unclearAttempts: session.unclearAttempts,
          accumulatedText,
        });
      } else {
        replyText = templates[lang].unclear_cancel;
        resetSession(sessionId);
      }
    } else if (session.scamInterviewStep === 'asked_told_to_pay') {
      const toldToPay = userChoice === 'yes';
      const signals = detectScamSignals(accumulatedText);
      const risk = combineRisk(signals, {
        toldToPayBySomeone: toldToPay,
        unverifiedPayee: session.isNewPayee,
        payeeOnBlocklist: false,
      });

      if (risk === 'high') {
        recordTransaction(db, {
          user_id: userId,
          type: 'send_money',
          amount: session.pendingAmount || 0,
          currency: 'INR',
          counterparty_type: session.isNewPayee ? 'new_personal' : 'contact',
          counterparty_id: session.pendingPayeeRaw || 'unknown',
          tier: 3,
          risk_score: Math.max(signals.score, 0.9),
          decision: 'block',
          status: 'failed',
          paypal_ref: null,
        });

        writeAudit(db, {
          user_id: userId,
          kind: 'scam_payment_blocked',
          payload: JSON.stringify({
            payee: session.pendingPayeeName,
            amount: session.pendingAmount,
            reason: 'High scam risk detected in interview',
            categories: signals.categories,
            score: signals.score,
            toldToPay,
          }),
        });

        createNotification(db, {
          user_id: userId,
          kind: 'scam_alert',
          message: `Scam alert: Payment of ₹${session.pendingAmount} to ${session.pendingPayeeName} was blocked. Reason: High scam risk detected (${signals.categories.join(', ') || 'instruction by caller'}).`,
          spoken_text: `Scam chetavni: ${session.pendingPayeeName} ko ₹${session.pendingAmount} ka payment scam sandeh ke kaaran rok diya gaya.`,
        });

        replyText = templates[lang].scam_blocked_interruption;
        resetSession(sessionId);
      } else if (session.isNewPayee) {
        updateSession(sessionId, {
          scamInterviewStep: 'asked_knows_payee',
          scamToldToPay: toldToPay,
          accumulatedText,
          unclearAttempts: 0,
        });
        replyText = templates[lang].scam_ask_knows_payee;
      } else {
        if (risk === 'medium') {
          const prep = preparePayment(db, {
            userId,
            payee: session.pendingPayeeRaw!,
            amount: session.pendingAmount!,
            scamRisk: 'medium',
          });
          updateSession(sessionId, {
            state: 'awaiting_guardian_approval',
            currentTransactionId: prep.transactionId,
            pendingPayeeName: session.pendingPayeeName || prep.payee,
            pendingAmount: session.pendingAmount || prep.amount,
          });
          const guardian = db
            .prepare<[string], { name: string }>(
              'SELECT name FROM guardians WHERE user_id = ?'
            )
            .get(userId);
          replyText = templates[lang].guardian_approval_needed(
            guardian?.name || 'Ramesh'
          );
        } else {
          const prep = preparePayment(db, {
            userId,
            payee: session.pendingPayeeRaw!,
            amount: session.pendingAmount!,
            scamRisk: 'low',
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
            updateSession(sessionId, {
              state: 'awaiting_guardian_approval',
              currentTransactionId: prep.transactionId,
            });
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
            replyText = templates[lang].payment_blocked(prep.decision.spoken_reason);
          }
        }
      }
    } else if (session.scamInterviewStep === 'asked_knows_payee') {
      const knowsPayee = userChoice === 'yes';
      const unverifiedPayee = !knowsPayee;
      const finalSignals = detectScamSignals(accumulatedText);
      const finalRisk = combineRisk(finalSignals, {
        toldToPayBySomeone: session.scamToldToPay,
        unverifiedPayee,
        payeeOnBlocklist: false,
      });

      if (finalRisk === 'high') {
        recordTransaction(db, {
          user_id: userId,
          type: 'send_money',
          amount: session.pendingAmount || 0,
          currency: 'INR',
          counterparty_type: session.isNewPayee ? 'new_personal' : 'contact',
          counterparty_id: session.pendingPayeeRaw || 'unknown',
          tier: 3,
          risk_score: Math.max(finalSignals.score, 0.9),
          decision: 'block',
          status: 'failed',
          paypal_ref: null,
        });

        writeAudit(db, {
          user_id: userId,
          kind: 'scam_payment_blocked',
          payload: JSON.stringify({
            payee: session.pendingPayeeName,
            amount: session.pendingAmount,
            reason: 'High scam risk detected in interview',
            categories: finalSignals.categories,
            score: finalSignals.score,
            toldToPay: session.scamToldToPay,
            knowsPayee,
          }),
        });

        createNotification(db, {
          user_id: userId,
          kind: 'scam_alert',
          message: `Scam alert: Payment of ₹${session.pendingAmount} to ${session.pendingPayeeName} was blocked. Reason: High scam risk detected (${finalSignals.categories.join(', ') || 'unverified payee with caller pressure'}).`,
          spoken_text: `Scam chetavni: ${session.pendingPayeeName} ko ₹${session.pendingAmount} ka payment scam sandeh ke kaaran rok diya gaya.`,
        });

        replyText = templates[lang].scam_blocked_interruption;
        resetSession(sessionId);
      } else if (finalRisk === 'medium') {
        const prep = preparePayment(db, {
          userId,
          payee: session.pendingPayeeRaw!,
          amount: session.pendingAmount!,
          scamRisk: 'medium',
        });
        updateSession(sessionId, {
          state: 'awaiting_guardian_approval',
          currentTransactionId: prep.transactionId,
          pendingPayeeName: session.pendingPayeeName || prep.payee,
          pendingAmount: session.pendingAmount || prep.amount,
        });
        const guardian = db
          .prepare<[string], { name: string }>(
            'SELECT name FROM guardians WHERE user_id = ?'
          )
          .get(userId);
        replyText = templates[lang].guardian_approval_needed(
          guardian?.name || 'Ramesh'
        );
      } else {
        const prep = preparePayment(db, {
          userId,
          payee: session.pendingPayeeRaw!,
          amount: session.pendingAmount!,
          scamRisk: 'low',
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
          updateSession(sessionId, {
            state: 'awaiting_guardian_approval',
            currentTransactionId: prep.transactionId,
            pendingPayeeName: session.pendingPayeeName || prep.payee,
            pendingAmount: session.pendingAmount || prep.amount,
          });
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
          replyText = templates[lang].payment_blocked(prep.decision.spoken_reason);
        }
      }
    }
  } else {
    const parsedInvoiceId = parseInvoiceQr(text);
    const invoice = parsedInvoiceId
      ? getInvoiceByPaypalId(db, parsedInvoiceId) ||
        getInvoiceById(db, parsedInvoiceId)
      : null;

    if (invoice) {
      const prep = preparePayment(db, {
        userId,
        payee: invoice.merchant_name,
        amount: invoice.amount,
        scamRisk: 'low',
      });

      if (prep.decision.action === 'allow_with_confirmation') {
        updateSession(sessionId, {
          state: 'awaiting_confirmation',
          currentTransactionId: prep.transactionId,
          pendingPayeeName: invoice.merchant_name,
          pendingAmount: invoice.amount,
          isInvoicePayment: true,
          invoiceId: invoice.paypal_invoice_id,
          unclearAttempts: 0,
        });
        replyText =
          lang === 'hi'
            ? `${invoice.merchant_name}, ${invoice.amount} rupaye. Kya main bhej doon?`
            : `${invoice.merchant_name}, ${invoice.amount} rupees. Shall I pay?`;
      } else if (prep.decision.action === 'need_guardian_approval') {
        updateSession(sessionId, {
          state: 'awaiting_guardian_approval',
          currentTransactionId: prep.transactionId,
          pendingPayeeName: invoice.merchant_name,
          pendingAmount: invoice.amount,
          isInvoicePayment: true,
          invoiceId: invoice.paypal_invoice_id,
        });
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
        replyText = templates[lang].payment_blocked(prep.decision.spoken_reason);
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
          const payee = intentResult.recipient_alias;
          const amount = intentResult.amount;
          const resolvedPayee = resolvePayee(db, userId, payee);

          const blockCheck = db
            .prepare<[string], { count: number }>(
              'SELECT COUNT(*) AS count FROM blocklist WHERE LOWER(paypal_email) = ?'
            )
            .get(resolvedPayee.email.toLowerCase())?.count ?? 0;

          if (blockCheck > 0) {
            resetSession(sessionId);
            replyText = templates[lang].payment_blocked(
              'This payee is blocked for your safety.'
            );
            return {
              replyText,
              replyLanguage: lang,
              state: 'idle',
            };
          }

          const initialSignals = detectScamSignals(text);
          const initialScamRisk = combineRisk(initialSignals);

          const { context } = buildPaymentContext(
            db,
            user!,
            resolvedPayee,
            initialScamRisk
          );

          const preliminaryDecision = evaluatePayment(
            {
              amount,
              currency: 'INR',
              payeeType: resolvedPayee.payeeType,
              payeeId: resolvedPayee.counterpartyId,
              payeeName: resolvedPayee.displayName,
            },
            context
          );

          const needsInterview =
            preliminaryDecision.tier >= 2 ||
            initialScamRisk === 'medium' ||
            initialScamRisk === 'high';

          if (needsInterview) {
            const isNew = resolvedPayee.payeeType !== 'trusted_contact';
            updateSession(sessionId, {
              state: 'awaiting_scam_answers',
              scamInterviewStep: 'asked_told_to_pay',
              pendingPayeeName: resolvedPayee.displayName,
              pendingPayeeRaw: payee,
              pendingAmount: amount,
              isNewPayee: isNew,
              accumulatedText: text,
              unclearAttempts: 0,
            });
            replyText = templates[lang].scam_ask_told_to_pay;
          } else {
            const prep = preparePayment(db, {
              userId,
              payee,
              amount,
              scamRisk: 'low',
            });

            if (prep.decision.action === 'allow_with_confirmation') {
              updateSession(sessionId, {
                state: 'awaiting_confirmation',
                currentTransactionId: prep.transactionId,
                pendingPayeeName: prep.payee,
                pendingAmount: prep.amount,
                unclearAttempts: 0,
              });
              replyText = templates[lang].ask_confirmation(
                prep.payee,
                prep.amount
              );
            } else if (prep.decision.action === 'need_guardian_approval') {
              updateSession(sessionId, {
                state: 'awaiting_guardian_approval',
                currentTransactionId: prep.transactionId,
                pendingPayeeName: prep.payee,
                pendingAmount: prep.amount,
              });
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
          }
        } catch (err) {
          replyText = `Error: ${(err as Error).message}`;
        }
      }
    } else {
      replyText = templates[lang].unknown_intent;
    }
    }
  }

  const currentSession = getSession(sessionId, userId);
  currentSession.lastReply = { text: replyText, lang };

  return {
    replyText,
    replyLanguage: lang,
    state: currentSession.state,
    actions: currentSession.currentTransactionId
      ? { transactionId: currentSession.currentTransactionId }
      : undefined,
  };
}
