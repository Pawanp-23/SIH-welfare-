/**
 * Authentication primitives built on node:crypto only.
 *
 * Deliberately zero npm dependencies. On demo day the difference between a
 * working laptop and a dead one is often a native module that will not compile,
 * so password hashing uses scrypt from the standard library and the session
 * token is a hand-rolled HMAC-signed JWT rather than `jsonwebtoken` +
 * `bcrypt`. Both are the same constructions those libraries use.
 */

import {
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

// --- Password hashing -------------------------------------------------------

const SCRYPT_N = 16384; // OWASP-recommended cost for interactive logins
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password.normalize('NFKC'), salt, KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64url');
    const expected = Buffer.from(hashB64, 'base64url');
    const derived = scryptSync(password.normalize('NFKC'), salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    // Constant-time: a length mismatch must not short-circuit either.
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

// --- Session tokens (HS256 JWT) --------------------------------------------

const SECRET =
  process.env.SAHARA_SECRET ||
  // A per-process random secret means a restart invalidates old sessions,
  // which is the safe default for a system holding welfare data.
  randomBytes(48).toString('base64url');

function b64u(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export interface TokenClaims {
  sub: string;
  role: string;
  unitId?: string;
  /** issued-at and expiry, seconds since epoch */
  iat: number;
  exp: number;
  jti: string;
}

export function signToken(payload: Omit<TokenClaims, 'iat' | 'exp' | 'jti'>, ttlSeconds = 60 * 60 * 8): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: TokenClaims = { ...payload, iat: now, exp: now + ttlSeconds, jti: randomUUID() };
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(claims));
  const sig = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string): TokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;

  const expected = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenClaims;
    if (typeof claims.exp !== 'number' || claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

// --- Pseudonymisation -------------------------------------------------------

const PSEUDONYM_KEY = process.env.SAHARA_PSEUDONYM_KEY || 'sahara-demo-pseudonym-key';

/**
 * Deterministic, keyed pseudonym for a personnel id.
 *
 * Commanders see this token, never a name. It is keyed rather than a plain
 * hash so that an attacker holding the identifier list cannot rebuild the
 * mapping by brute force, and deterministic so that the same person remains
 * trackable across screens without ever revealing who they are.
 */
export function pseudonymFor(personnelId: string, salt = ''): string {
  const digest = createHmac('sha256', PSEUDONYM_KEY)
    .update(`${salt}:${personnelId}`)
    .digest('base64url');
  return `PSN-${digest.slice(0, 4).toUpperCase()}-${digest.slice(4, 8).toUpperCase()}`;
}

export { randomUUID };
