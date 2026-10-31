import { Router, type Request, type Response } from 'express';
import type { AppDatabase as Database } from '../db/connection.js';
import crypto from 'node:crypto';
import {
  listContacts,
  getContactById,
  upsertContact,
  deleteContact,
  writeAudit,
  createNotification,
  getUserById,
  upsertUser,
  upsertGuardian,
} from '../db/repository.js';
import type { ContactStatus } from '../db/types.js';

export function createContactsRouter(db: Database): Router {
  const router = Router();

  // QR supplied recipient details are never promoted directly to trusted status.
  router.post('/scan', async (req: Request, res: Response) => {
    try {
      const userId = req.body.userId || req.user?.id || 'user_meena';
      const displayName = typeof req.body.displayName === 'string' ? req.body.displayName.trim() : '';
      const paypalEmail = typeof req.body.paypalEmail === 'string' ? req.body.paypalEmail.trim() : '';
      if (!displayName || displayName.length > 80 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(paypalEmail)) {
        res.status(400).json({ error: 'A recipient name and valid PayPal email are required' });
        return;
      }

      const existing = (await db.query<import('../db/types.js').Contact>(
        'SELECT * FROM contacts WHERE user_id = $1 AND LOWER(paypal_email) = LOWER($2) LIMIT 1', [userId, paypalEmail]))[0];
      if (existing) {
        res.status(200).json({ contact: existing, existing: true, inCoolingOff: existing.status === 'cooling_off' });
        return;
      }
      const sameName = (await db.query<{ id: string }>(
        'SELECT id FROM contacts WHERE user_id = $1 AND LOWER(display_name) = LOWER($2) LIMIT 1', [userId, displayName]))[0];
      if (sameName) {
        res.status(409).json({ error: 'A contact already uses that name. Ask a helper to add a unique spoken nickname.' });
        return;
      }

      const now = new Date();
      const coolingHoursRaw = Number.parseInt(process.env.CONTACT_COOLING_OFF_HOURS || '24', 10);
      const coolingHours = Number.isFinite(coolingHoursRaw) ? Math.max(1, Math.min(coolingHoursRaw, 168)) : 24;
      const activatedAt = new Date(now.getTime() + coolingHours * 60 * 60 * 1000).toISOString();
      const alias = displayName;
      const contact = await upsertContact(db, {
        id: `contact_${crypto.randomUUID().slice(0, 8)}`,
        user_id: userId,
        alias,
        display_name: displayName,
        paypal_email: paypalEmail,
        status: 'cooling_off',
        added_by: 'recipient_qr',
        activated_at: activatedAt,
      });

      await createNotification(db, {
        user_id: userId,
        kind: 'contact_added',
        message: `New recipient QR scanned: ${displayName} (${paypalEmail}). Held for ${coolingHours} hours.`,
        spoken_text: `Naya payee QR se joda gaya: ${displayName}. Suraksha ke liye cooling-off period lagu hai.`,
      });
      await writeAudit(db, {
        user_id: userId,
        kind: 'recipient_qr_scanned',
        payload: JSON.stringify({ contactId: contact.id, displayName, paypalEmail, coolingHours }),
      });
      res.status(201).json({ contact, existing: false, inCoolingOff: true, coolingHours });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 1. List contacts
  router.get('/', async (req: Request, res: Response) => {
    try {
      const userId = (req.query.userId as string) || req.user?.id || 'user_meena';
      const contacts = await listContacts(db, userId);
      res.status(200).json({ contacts });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 2. Add contact (with cooling-off period)
  router.post('/', async (req: Request, res: Response) => {
    try {
      const userId = req.body.userId || req.user?.id || 'user_meena';
      const { alias, displayName, paypalEmail, addedBy = 'guardian_ramesh' } = req.body;

      if (!alias || !displayName || !paypalEmail) {
        res.status(400).json({ error: 'alias, displayName, and paypalEmail are required' });
        return;
      }

      const now = new Date();
      const skipCooling = process.env.DEMO_SKIP_COOLING === 'true';
      const coolingHours = parseInt(process.env.CONTACT_COOLING_OFF_HOURS || '24', 10);

      const status: ContactStatus = skipCooling ? 'active' : 'cooling_off';
      const activatedAt = skipCooling
        ? now.toISOString()
        : new Date(now.getTime() + coolingHours * 3600 * 1000).toISOString();

      const contactId = `contact_${crypto.randomUUID().slice(0, 8)}`;

      const contact = await upsertContact(db, {
        id: contactId,
        user_id: userId,
        alias: alias.trim(),
        display_name: displayName.trim(),
        paypal_email: paypalEmail.trim(),
        status,
        added_by: addedBy,
        activated_at: activatedAt,
      });

      // Notify guardian
      await createNotification(db, {
        user_id: userId,
        kind: 'contact_added',
        message: `New contact added: ${displayName} (${alias}). Status: ${status}. Active at: ${activatedAt}.`,
        spoken_text: `Naya contact joda gaya: ${displayName}.`,
      });

      await writeAudit(db, {
        user_id: userId,
        kind: 'contact_added',
        payload: JSON.stringify({
          contactId,
          alias,
          displayName,
          status,
          activatedAt,
          skipCooling,
        }),
      });

      res.status(201).json({
        contact,
        inCoolingOff: status === 'cooling_off',
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 3. Emergency: Instant activation by guardian
  router.post('/:id/activate', async (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!id) {
        res.status(400).json({ error: 'ID is required' });
        return;
      }
      const contact = await getContactById(db, id);

      if (!contact) {
        res.status(404).json({ error: 'Contact not found' });
        return;
      }

      const now = new Date().toISOString();
      const updated = await upsertContact(db, {
        ...contact,
        status: 'active',
        activated_at: now,
      });

      await writeAudit(db, {
        user_id: contact.user_id,
        kind: 'emergency_contact_activated',
        payload: JSON.stringify({ contactId: id, activatedAt: now }),
      });

      res.status(200).json({ success: true, contact: updated });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 4. Block contact during cooling off
  router.post('/:id/block', async (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!id) {
        res.status(400).json({ error: 'ID is required' });
        return;
      }
      const contact = await getContactById(db, id);

      if (!contact) {
        res.status(404).json({ error: 'Contact not found' });
        return;
      }

      // Add to blocklist
      await db.query(`INSERT INTO blocklist (id, paypal_email, reason) VALUES ($1, $2, $3)
        ON CONFLICT (paypal_email) DO UPDATE SET reason = EXCLUDED.reason`,
      [`blk_${Date.now()}`, contact.paypal_email.toLowerCase(), 'Blocked during cooling-off by guardian']);

      await deleteContact(db, id);

      await writeAudit(db, {
        user_id: contact.user_id,
        kind: 'contact_blocked_during_cooling_off',
        payload: JSON.stringify({ contactId: id, email: contact.paypal_email }),
      });

      res.status(200).json({ success: true, blocked: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 5. Delete contact
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!id) {
        res.status(400).json({ error: 'ID is required' });
        return;
      }
      await deleteContact(db, id);
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

export function createOnboardingRouter(db: Database): Router {
  const router = Router();

  // Complete assisted onboarding wizard
  router.post('/complete', async (req: Request, res: Response) => {
    try {
      const {
        userId = 'user_meena',
        name = 'Meena',
        language = 'hi',
        limits = {
          daily_total: 5000,
          per_transaction_new_payee: 500,
          max_new_payees_per_day: 2,
        },
        guardian = {
          name: 'Ramesh',
          contact: '+971501234567',
          permissions: 'all',
        },
        contacts = [],
      } = req.body;

      const user = await upsertUser(db, {
        id: userId,
        name,
        language,
        limits: JSON.stringify({
          ...limits,
          daily_total: Math.min(Number(limits.daily_total) || 5000, 5000),
        }),
        created_at: new Date().toISOString(),
      });

      const guardianRecord = await upsertGuardian(db, {
        id: `guardian_${Date.now()}`,
        user_id: userId,
        name: guardian.name,
        contact: guardian.contact,
        permissions: guardian.permissions,
      });

      // Add contacts
      const skipCooling = process.env.DEMO_SKIP_COOLING === 'true';
      const coolingHours = parseInt(process.env.CONTACT_COOLING_OFF_HOURS || '24', 10);
      const now = new Date();

      const createdContacts = [];
      for (const c of contacts) {
        const status: ContactStatus = skipCooling ? 'active' : 'cooling_off';
        const activatedAt = skipCooling
          ? now.toISOString()
          : new Date(now.getTime() + coolingHours * 3600 * 1000).toISOString();

        const contact = await upsertContact(db, {
          id: `contact_${crypto.randomUUID().slice(0, 8)}`,
          user_id: userId,
          alias: c.alias,
          display_name: c.displayName,
          paypal_email: c.paypalEmail,
          status,
          added_by: guardianRecord.id,
          activated_at: activatedAt,
        });
        createdContacts.push(contact);
      }

      await writeAudit(db, {
        user_id: userId,
        kind: 'onboarding_completed',
        payload: JSON.stringify({ userId, name, language, limits, contactsCount: contacts.length }),
      });

      res.status(200).json({
        success: true,
        user,
        guardian: guardianRecord,
        contacts: createdContacts,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
