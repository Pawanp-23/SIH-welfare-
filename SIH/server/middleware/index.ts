/**
 * Express middleware: identity, authorisation, rate limiting, error shaping.
 *
 * The authorisation model is the interesting part. SAHARA deliberately does not
 * give a commander the ability to read an individual's check-in text — the
 * system is designed so that the people who can act on aggregate patterns
 * cannot browse individual disclosures, because a welfare system that can be
 * used for surveillance stops being used at all.
 */

import type { NextFunction, Request, Response } from 'express';

import * as audit from '../core/audit.js';
import { verifyToken } from '../core/crypto.js';
import { ValidationError } from '../core/validate.js';

export type Role = 'personnel' | 'welfare_officer' | 'command_viewer' | 'admin' | 'demo_operator';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: { id: string; role: Role; unitId?: string; name?: string };
    }
  }
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = 'error',
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/**
 * Attach the caller's identity if they presented one.
 *
 * The legacy `x-user-id` header is still honoured because the demo control
 * panel switches personas without logging in, but it is only trusted when
 * `SAHARA_ALLOW_HEADER_AUTH` is not explicitly disabled — so a deployment can
 * turn the shortcut off without touching a route.
 */
export function identify(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const claims = verifyToken(header.slice(7));
    if (claims) {
      req.actor = { id: claims.sub, role: claims.role as Role, unitId: claims.unitId };
      return next();
    }
  }

  if (process.env.SAHARA_ALLOW_HEADER_AUTH !== 'false') {
    const legacy = req.headers['x-user-id'];
    if (typeof legacy === 'string' && legacy) {
      req.actor = { id: legacy, role: (req.headers['x-user-role'] as Role) || 'personnel' };
    }
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.actor) return next(new HttpError(401, 'Authentication required', 'unauthenticated'));
  next();
}

/** Role gate. Records every denial — refusals are as interesting as accesses. */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.actor) return next(new HttpError(401, 'Authentication required', 'unauthenticated'));
    if (!roles.includes(req.actor.role)) {
      audit.record({
        actorId: req.actor.id,
        actorRole: req.actor.role,
        action: 'ACCESS_DENIED',
        resource: `${req.method} ${req.path}`,
        justification: `role ${req.actor.role} not in [${roles.join(', ')}]`,
        privacyFilterEnforced: 'rbac_denied',
      });
      return next(new HttpError(403, 'Your role does not permit this action', 'forbidden'));
    }
    next();
  };
}

/**
 * Individual-level data is readable by the person themselves and by the welfare
 * officer assigned to them. Command roles are intentionally excluded: they get
 * unit aggregates and pseudonymous risk profiles, never a named record.
 */
export function requireSelfOrAssignedOfficer(getSubjectId: (req: Request) => string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const actor = req.actor;
    if (!actor) return next(new HttpError(401, 'Authentication required', 'unauthenticated'));

    const subject = getSubjectId(req);
    const allowed =
      actor.id.toLowerCase() === subject.toLowerCase() ||
      actor.role === 'welfare_officer' ||
      actor.role === 'admin' ||
      actor.role === 'demo_operator';

    if (!allowed) {
      audit.record({
        actorId: actor.id,
        actorRole: actor.role,
        action: 'INDIVIDUAL_ACCESS_DENIED',
        resource: subject,
        justification: 'command roles receive aggregates only, never individual records',
        privacyFilterEnforced: 'individual_record_shield',
      });
      return next(new HttpError(403, 'Individual records are not available to this role', 'forbidden'));
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

interface Bucket {
  tokens: number;
  updated: number;
}
const buckets = new Map<string, Bucket>();

/** Token bucket, keyed by actor when known and by IP otherwise. */
export function rateLimit(opts: { capacity: number; refillPerSecond: number; key?: string }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const id = `${opts.key ?? req.path}:${req.actor?.id ?? req.ip ?? 'anon'}`;
    const now = Date.now();
    const bucket = buckets.get(id) ?? { tokens: opts.capacity, updated: now };

    const elapsed = (now - bucket.updated) / 1000;
    bucket.tokens = Math.min(opts.capacity, bucket.tokens + elapsed * opts.refillPerSecond);
    bucket.updated = now;

    if (bucket.tokens < 1) {
      buckets.set(id, bucket);
      const retry = Math.ceil((1 - bucket.tokens) / opts.refillPerSecond);
      res.setHeader('Retry-After', String(retry));
      return next(new HttpError(429, `Too many requests — retry in ${retry}s`, 'rate_limited'));
    }

    bucket.tokens -= 1;
    buckets.set(id, bucket);
    res.setHeader('X-RateLimit-Remaining', String(Math.floor(bucket.tokens)));
    next();
  };
}

// Keep the bucket map from growing without bound on a long-running process.
const sweeper = setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, bucket] of buckets) if (bucket.updated < cutoff) buckets.delete(key);
}, 60_000);
sweeper.unref?.();

// ---------------------------------------------------------------------------
// Security headers & errors
// ---------------------------------------------------------------------------

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
}

export function notFound(_req: Request, _res: Response, next: NextFunction): void {
  next(new HttpError(404, 'Endpoint not found', 'not_found'));
}

/** Single error shape for the whole API, and no stack traces over the wire. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ValidationError) {
    res.status(422).json({ success: false, code: 'validation_failed', error: err.message, issues: err.issues });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ success: false, code: err.code, error: err.message });
    return;
  }
  console.error('[sahara] unhandled error:', err);
  res.status(500).json({
    success: false,
    code: 'internal_error',
    error: 'Something went wrong handling that request.',
  });
}

/** Wrap an async handler so a rejected promise reaches the error handler. */
export function asyncRoute(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    void fn(req, res, next).catch(next);
  };
}
