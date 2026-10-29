import { Router, type Request, type Response } from 'express';
import type Database from 'better-sqlite3';
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

export function createContactsRouter(db: Database.Database): Router {
  const router = Router();

  // 1. List contacts
  router.get('/', (req: Request, res: Response) => {
    try {
      const userId = (req.query.userId as string) || req.user?.id || 'user_meena';
      const contacts = listContacts(db, userId);
      res.status(200).json({ contacts });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 2. Add contact (with cooling-off period)
  router.post('/', (req: Request, res: Response) => {
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

      const contact = upsertContact(db, {
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
      createNotification(db, {
        user_id: userId,
        kind: 'contact_added',
        message: `New contact added: ${displayName} (${alias}). Status: ${status}. Active at: ${activatedAt}.`,
        spoken_text: `Naya contact joda gaya: ${displayName}.`,
      });

      writeAudit(db, {
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
  router.post('/:id/activate', (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!id) {
        res.status(400).json({ error: 'ID is required' });
        return;
      }
      const contact = getContactById(db, id);

      if (!contact) {
        res.status(404).json({ error: 'Contact not found' });
        return;
      }

      const now = new Date().toISOString();
      const updated = upsertContact(db, {
        ...contact,
        status: 'active',
        activated_at: now,
      });

      writeAudit(db, {
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
  router.post('/:id/block', (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!id) {
        res.status(400).json({ error: 'ID is required' });
        return;
      }
      const contact = getContactById(db, id);

      if (!contact) {
        res.status(404).json({ error: 'Contact not found' });
        return;
      }

      // Add to blocklist
      db.prepare(`
        INSERT OR REPLACE INTO blocklist (id, paypal_email, reason)
        VALUES (?, ?, ?)
      `).run(`blk_${Date.now()}`, contact.paypal_email.toLowerCase(), 'Blocked during cooling-off by guardian');

      deleteContact(db, id);

      writeAudit(db, {
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
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!id) {
        res.status(400).json({ error: 'ID is required' });
        return;
      }
      deleteContact(db, id);
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

export function createOnboardingRouter(db: Database.Database): Router {
  const router = Router();

  // Complete assisted onboarding wizard
  router.post('/complete', (req: Request, res: Response) => {
    try {
      const {
        userId = 'user_meena',
        name = 'Meena',
        language = 'hi',
        limits = {
          daily_total: 1000,
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

      const user = upsertUser(db, {
        id: userId,
        name,
        language,
        limits: JSON.stringify(limits),
        created_at: new Date().toISOString(),
      });

      const guardianRecord = upsertGuardian(db, {
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

        const contact = upsertContact(db, {
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

      writeAudit(db, {
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
