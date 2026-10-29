import type { Request, Response, NextFunction } from 'express';
import { getSessionUser, SESSION_COOKIE_NAME } from './session.js';

export interface AuthenticatedUser {
  id: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function isDemoAuthBypass(): boolean {
  return process.env.DEMO_AUTH_BYPASS === 'true';
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // Check DEMO_AUTH_BYPASS environment flag
  if (isDemoAuthBypass()) {
    req.user = { id: (req.query.userId as string) || req.body?.userId || 'user_meena' };
    next();
    return;
  }

  // Check session cookie
  let token = req.cookies?.[SESSION_COOKIE_NAME];

  // Also support Authorization header: Bearer <token>
  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7).trim();
  }

  if (!token) {
    res.status(401).json({
      error: 'Unauthorized: passkey authentication required',
    });
    return;
  }

  const session = getSessionUser(token);
  if (!session) {
    res.status(401).json({
      error: 'Unauthorized: invalid or expired session',
    });
    return;
  }

  req.user = { id: session.userId };
  next();
}
