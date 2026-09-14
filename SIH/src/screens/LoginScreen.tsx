/**
 * Sign-in.
 *
 * Real authentication — scrypt-hashed passwords, an HMAC-signed session token —
 * with a persona picker beside it, because on a demo day nobody should be
 * typing a service number into a form while a room waits. The picker fills the
 * credentials; it does not bypass the login.
 */

import React, { useState } from 'react';
import { motion } from 'motion/react';

import { api, ApiError } from '../api/client.js';
import { useAsync } from '../app/hooks.js';
import { Wordmark, roleLabel } from '../app/AppShell.js';
import { duration, ease, stagger, staggerItem } from '../design/motion.js';
import { Button, Chip, ErrorNote, Eyebrow, Field, cx, inputClass } from '../design/primitives.js';
import type { UserProfile } from '../types.js';

const PERSONAS = [
  { id: 'p-014', why: 'Sitting in the review band. Start here.' },
  { id: 'wo-001', why: 'Sees the cases and the recommended measures.' },
  { id: 'cmd-001', why: 'Aggregates only — try to find an individual.' },
  { id: 'adm-001', why: 'Model card, audit chain, demo controls.' },
];

export function LoginScreen({
  onSignedIn,
  onBack,
}: {
  onSignedIn: (user: UserProfile, token: string) => void;
  onBack: () => void;
}) {
  const users = useAsync(() => api.listUsers(), []);
  const [userId, setUserId] = useState('p-014');
  const [password, setPassword] = useState('sahara');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(userId.trim(), password);
      onSignedIn(res.user, res.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const personas = PERSONAS.map((p) => ({
    ...p,
    user: users.data?.users.find((u) => u.id === p.id),
  })).filter((p) => p.user);

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* Form */}
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12 lg:px-16">
        <motion.div
          variants={stagger(0.04, 0.07)}
          initial="hidden"
          animate="show"
          className="mx-auto w-full max-w-[400px]"
        >
          <motion.div variants={staggerItem}>
            <button onClick={onBack} className="mb-10 inline-flex">
              <Wordmark />
            </button>
          </motion.div>

          <motion.div variants={staggerItem}>
            <h1 className="text-[34px] leading-tight">Sign in</h1>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">
              Credentials are checked against a scrypt hash and exchanged for a
              signed session token. Every attempt, successful or not, is written
              to the audit chain.
            </p>
          </motion.div>

          <motion.form variants={staggerItem} onSubmit={submit} className="mt-8 space-y-4">
            <Field label="Service identifier">
              <input
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                autoComplete="username"
                className={inputClass}
                placeholder="p-014"
              />
            </Field>
            <Field label="Password" hint="Every seeded account uses 'sahara' in this demonstration build.">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className={inputClass}
              />
            </Field>

            {error ? <ErrorNote>{error}</ErrorNote> : null}

            <Button type="submit" variant="primary" size="lg" loading={busy} className="w-full">
              Sign in
            </Button>
          </motion.form>

          <motion.p variants={staggerItem} className="mt-6 font-mono text-[10.5px] leading-relaxed text-ink-faint">
            A production deployment would federate to the force's existing
            identity provider rather than hold passwords at all.
          </motion.p>
        </motion.div>
      </div>

      {/* Personas */}
      <div className="hidden flex-col justify-center border-l border-rule bg-paper-sunken px-12 py-12 lg:flex">
        <motion.div
          variants={stagger(0.08, 0.06)}
          initial="hidden"
          animate="show"
          className="mx-auto w-full max-w-[440px]"
        >
          <motion.div variants={staggerItem}>
            <Eyebrow>Four roles, four different systems</Eyebrow>
            <h2 className="mt-2 text-[26px] leading-tight">Pick who you want to be.</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
              Selecting one fills the form below-left. You still sign in properly —
              the role gate is enforced on the server, and you are welcome to try
              to get past it.
            </p>
          </motion.div>

          <motion.ul variants={staggerItem} className="mt-7 space-y-2.5">
            {personas.map((p) => {
              const active = userId === p.id;
              return (
                <li key={p.id}>
                  <button
                    onClick={() => {
                      setUserId(p.id);
                      setPassword('sahara');
                    }}
                    className={cx(
                      'w-full rounded-lg border bg-paper-raised p-4 text-left transition-shadow',
                      active ? 'border-accent/50 shadow-e2' : 'border-rule shadow-e1 hover:shadow-e2',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[14px] text-ink-strong">{p.user!.name}</div>
                        <div className="mt-0.5 truncate font-mono text-[10.5px] text-ink-faint">
                          {p.user!.rank} · {p.user!.unitName}
                        </div>
                      </div>
                      <Chip tone={active ? 'accent' : 'neutral'}>{roleLabel(p.user!.role)}</Chip>
                    </div>
                    <p className="mt-2 text-[12px] leading-relaxed text-ink-muted">{p.why}</p>
                  </button>
                </li>
              );
            })}
          </motion.ul>

          <motion.div
            variants={staggerItem}
            className="mt-6 rounded-sm border border-rule bg-paper-inset px-4 py-3"
          >
            <p className="text-[11.5px] leading-relaxed text-ink-faint">
              Every personnel record in this build is synthetic, generated by a
              structural causal simulator. No real welfare data exists anywhere in
              this system.
            </p>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
