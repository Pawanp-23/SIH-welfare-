/**
 * Durable storage on Node's built-in SQLite.
 *
 * `node:sqlite` ships with Node 22.5+ and needs no compiler, which matters:
 * `better-sqlite3` is a native module and "it failed to build on my laptop" is
 * a bad thing to discover the morning of a demo. If the runtime is older than
 * that, we degrade to an in-memory shim so the app still starts — loudly, in
 * the health endpoint, never silently.
 *
 * The schema is normalised rather than a JSON blob per entity, so the welfare
 * case timeline, the audit chain and the assessment history are all queryable.
 */

import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// `require` does not exist inside an ESM module. We build one so the lazy
// node:sqlite load below works identically under tsx and under the bundle.
const require = createRequire(import.meta.url);

export interface Statement {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface Db {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  readonly engine: 'node:sqlite' | 'memory';
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  alias              TEXT NOT NULL,
  role               TEXT NOT NULL,
  unit_id            TEXT NOT NULL,
  unit_name          TEXT NOT NULL,
  rank               TEXT NOT NULL,
  assigned_officer_id TEXT,
  has_consented      INTEGER NOT NULL DEFAULT 0,
  consent_granted_at TEXT,
  avatar_url         TEXT,
  password_hash      TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_unit ON users(unit_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS checkins (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date              TEXT NOT NULL,
  sleep_hours       REAL NOT NULL,
  perceived_stress  REAL NOT NULL,
  perceived_fatigue REAL NOT NULL,
  duty_hours        REAL,
  night_shift       INTEGER NOT NULL DEFAULT 0,
  support_requested INTEGER NOT NULL DEFAULT 0,
  notes             TEXT,
  created_at        TEXT NOT NULL,
  UNIQUE(user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_checkins_user_date ON checkins(user_id, date);

CREATE TABLE IF NOT EXISTS assessments (
  id             TEXT PRIMARY KEY,
  checkin_id     TEXT NOT NULL REFERENCES checkins(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date           TEXT NOT NULL,
  idx            REAL NOT NULL,
  band           TEXT NOT NULL,
  coverage       REAL NOT NULL,
  forecast_value REAL,
  forecast_base  REAL,
  model_version  TEXT NOT NULL,
  payload        TEXT NOT NULL,
  generated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assessments_user ON assessments(user_id, date);

CREATE TABLE IF NOT EXISTS cases (
  id                   TEXT PRIMARY KEY,
  personnel_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  personnel_alias      TEXT NOT NULL,
  unit_id              TEXT NOT NULL,
  unit_name            TEXT NOT NULL,
  assigned_officer_id  TEXT NOT NULL,
  status               TEXT NOT NULL,
  reason               TEXT NOT NULL,
  due_at               TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  latest_index         REAL NOT NULL,
  latest_band          TEXT NOT NULL,
  consecutive_alert_days INTEGER NOT NULL DEFAULT 0,
  support_requested    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cases_officer ON cases(assigned_officer_id, status);
CREATE INDEX IF NOT EXISTS idx_cases_unit ON cases(unit_id, status);

CREATE TABLE IF NOT EXISTS case_events (
  id           TEXT PRIMARY KEY,
  case_id      TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  actor_id     TEXT NOT NULL,
  actor_name   TEXT NOT NULL,
  action       TEXT NOT NULL,
  concise_note TEXT NOT NULL,
  timestamp    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_case_events_case ON case_events(case_id, timestamp);

CREATE TABLE IF NOT EXISTS recommendations (
  id             TEXT PRIMARY KEY,
  case_id        TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  trigger_facts  TEXT NOT NULL,
  rule_version   TEXT NOT NULL,
  proposed_action TEXT NOT NULL,
  review_status  TEXT NOT NULL,
  reviewer_note  TEXT,
  reviewer_id    TEXT,
  reviewed_at    TEXT,
  payload        TEXT
);
CREATE INDEX IF NOT EXISTS idx_recs_case ON recommendations(case_id);

-- Hash-chained: each row commits to the previous one, so a deleted or edited
-- audit entry breaks verification for every row after it.
CREATE TABLE IF NOT EXISTS audit_log (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  id           TEXT NOT NULL UNIQUE,
  timestamp    TEXT NOT NULL,
  actor_id     TEXT NOT NULL,
  actor_name   TEXT NOT NULL,
  actor_role   TEXT NOT NULL,
  action       TEXT NOT NULL,
  resource     TEXT NOT NULL,
  justification TEXT NOT NULL,
  privacy_filter TEXT NOT NULL,
  prev_hash    TEXT NOT NULL,
  hash         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(timestamp);

CREATE TABLE IF NOT EXISTS consent_ledger (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted    INTEGER NOT NULL,
  scope      TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  timestamp  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_consent_user ON consent_ledger(user_id, timestamp);

CREATE TABLE IF NOT EXISTS interventions (
  id          TEXT PRIMARY KEY,
  payload     TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Operational context per person: the HRMS/wearable-derived features that the
-- model needs but a 30-second daily check-in cannot reasonably ask for.
CREATE TABLE IF NOT EXISTS personnel_context (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload    TEXT NOT NULL,
  source     TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/**
 * Minimal in-memory stand-in used only when node:sqlite is unavailable.
 * It implements just enough to let the process boot and report degraded
 * storage — it is not a SQL engine, and the health endpoint says so.
 */
class MemoryDb implements Db {
  readonly engine = 'memory' as const;
  exec(): void {}
  prepare(): Statement {
    return {
      run: () => ({ changes: 0 }),
      get: () => undefined,
      all: () => [],
    };
  }
}

let instance: Db | null = null;
export let storageWarning: string | null = null;

export function getDb(): Db {
  if (instance) return instance;

  const file =
    process.env.SAHARA_DB === ':memory:'
      ? ':memory:'
      // Anchored to the working directory rather than to this module, so the
      // bundled build and the tsx dev run agree on where the file lives.
      : process.env.SAHARA_DB || join(process.cwd(), '.data', 'sahara.db');

  try {
    // Imported lazily so an older Node fails here rather than at module load.
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec(SCHEMA);
    instance = {
      exec: (sql) => db.exec(sql),
      prepare: (sql) => db.prepare(sql) as unknown as Statement,
      engine: 'node:sqlite',
    };
    return instance;
  } catch (err) {
    storageWarning =
      `SQLite unavailable (${(err as Error).message}). ` +
      `Running with non-durable in-memory storage — upgrade to Node 22.5+ for persistence.`;
    console.warn(`[sahara] ${storageWarning}`);
    instance = new MemoryDb();
    return instance;
  }
}

export function isEmpty(): boolean {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number } | undefined;
  return !row || row.n === 0;
}

/** Wipe every table — used by the demo reset control. */
export function truncateAll(): void {
  const db = getDb();
  for (const table of [
    'recommendations',
    'case_events',
    'cases',
    'assessments',
    'checkins',
    'consent_ledger',
    'audit_log',
    'interventions',
    'personnel_context',
    'users',
    'meta',
  ]) {
    try {
      db.prepare(`DELETE FROM ${table}`).run();
    } catch {
      /* table may not exist on the memory shim */
    }
  }
}

/** Run a set of writes as one transaction; rolls back on throw. */
export function transaction<T>(fn: () => T): T {
  const db = getDb();
  if (db.engine !== 'node:sqlite') return fn();
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
