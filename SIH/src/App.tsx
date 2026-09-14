/**
 * Application root: session, routing, and the demo control surface.
 *
 * Routing is a switch rather than a router library. With nine screens, one
 * level of nesting and no deep-linking requirement, a router would be a
 * dependency that buys nothing — though the screen id is mirrored into the URL
 * hash so a judge can reload without losing their place.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { api, ApiError } from './api/client.js';
import { AppShell, NAV, navForRole, type ScreenId } from './app/AppShell.js';
import { useHotkey, useLiveEvents, useTheme } from './app/hooks.js';
import { screen as screenVariants } from './design/motion.js';
import { Button, Chip, Eyebrow, Modal, Spinner } from './design/primitives.js';
import { AuditScreen } from './screens/AuditScreen.js';
import { CaseworkScreen } from './screens/CaseworkScreen.js';
import { CheckinScreen } from './screens/CheckinScreen.js';
import { ForceScreen } from './screens/ForceScreen.js';
import { InterventionsScreen } from './screens/InterventionsScreen.js';
import { LandingScreen } from './screens/LandingScreen.js';
import { LoginScreen } from './screens/LoginScreen.js';
import { ModelScreen } from './screens/ModelScreen.js';
import { MyWelfareScreen } from './screens/MyWelfareScreen.js';
import { SimulatorScreen } from './screens/SimulatorScreen.js';
import { UnitsScreen } from './screens/UnitsScreen.js';
import type { UserProfile } from './types.js';

type View = 'landing' | 'login' | 'app';

const DEFAULT_SCREEN: Record<string, ScreenId> = {
  personnel: 'checkin',
  welfare_officer: 'casework',
  command_viewer: 'force',
  admin: 'force',
  demo_operator: 'force',
};

export default function App() {
  const [view, setView] = useState<View>('landing');
  const [user, setUser] = useState<UserProfile | null>(null);
  // Seed from the hash so a reload on a deep link does not flash the default
  // screen first and then overwrite the URL with it. The role check happens
  // once the user is known, in the hash-sync effect below.
  const [screen, setScreen] = useState<ScreenId>(() => {
    const id = window.location.hash.replace(/^#\//, '') as ScreenId;
    return id && NAV.some((n) => n.id === id) ? id : 'checkin';
  });
  const [booting, setBooting] = useState(true);
  const [showKeys, setShowKeys] = useState(false);
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.getHealth>> | null>(null);

  const { theme, toggle } = useTheme();
  const { connected } = useLiveEvents(['heartbeat', 'alert.raised'], { enabled: view === 'app' });

  // --- Session restore ------------------------------------------------------
  //
  // Only a token this browser was actually issued counts as a session. The API
  // also accepts a legacy `X-User-Id` header so the demo console can switch
  // personas, but treating that as "already signed in" would silently skip the
  // login screen — and quietly authenticating someone who never authenticated
  // is a bad habit for a system that holds welfare data.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const h = await api.getHealth().catch(() => null);
      if (!cancelled && h) setHealth(h);

      let stored: { token: string; userId: string } | null = null;
      try {
        const raw = sessionStorage.getItem('sahara-session');
        if (raw) stored = JSON.parse(raw) as { token: string; userId: string };
      } catch {
        /* private browsing, or nothing stored */
      }

      if (stored?.token) {
        api.setUserId(stored.userId);
        api.setToken(stored.token);
        try {
          const me = await api.getMe();
          if (!cancelled && me.success) {
            setUser(me.user);
            // A reload keeps its place if the URL names a screen this role may
            // open; otherwise land on the role's home screen.
            const wanted = window.location.hash.replace(/^#\//, '') as ScreenId;
            const allowed = navForRole(me.user.role);
            setScreen(allowed.some((n) => n.id === wanted) ? wanted : (DEFAULT_SCREEN[me.user.role] ?? 'checkin'));
            setView('app');
          }
        } catch {
          api.setToken(null);
          try {
            sessionStorage.removeItem('sahara-session');
          } catch {
            /* ignore */
          }
        }
      }

      if (!cancelled) setBooting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Hash sync ------------------------------------------------------------
  //
  // Two-way: the hash follows the active screen so a reload lands where you
  // were, and back/forward or a pasted link moves the screen. The role check on
  // the way in matters — a hand-edited hash must not put a constable on the
  // command dashboard, even though the server would refuse the data anyway.
  useEffect(() => {
    if (!user) return;
    const allowed = navForRole(user.role);
    const apply = () => {
      const id = window.location.hash.replace(/^#\//, '') as ScreenId;
      if (id && allowed.some((n) => n.id === id)) {
        setScreen(id);
        setView('app');
      }
    };
    apply();
    // A hash this role may not open falls back to the first allowed screen.
    const current = window.location.hash.replace(/^#\//, '') as ScreenId;
    if (current && !allowed.some((n) => n.id === current)) setScreen(allowed[0].id);
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [user]);

  useEffect(() => {
    if (view === 'app' && window.location.hash !== `#/${screen}`) {
      window.location.hash = `/${screen}`;
    }
  }, [screen, view]);

  const signedIn = useCallback((u: UserProfile, token: string) => {
    try {
      sessionStorage.setItem('sahara-session', JSON.stringify({ token, userId: u.id }));
    } catch {
      /* a reload will simply ask them to sign in again */
    }
    setUser(u);
    setScreen(DEFAULT_SCREEN[u.role] ?? 'checkin');
    setView('app');
  }, []);

  const signOut = useCallback(() => {
    api.setToken(null);
    try {
      sessionStorage.removeItem('sahara-session');
    } catch {
      /* ignore */
    }
    setUser(null);
    setView('landing');
    window.location.hash = '';
  }, []);

  useHotkey('?', () => setShowKeys((v) => !v), view === 'app');

  // Number keys jump between the screens this role can reach.
  useEffect(() => {
    if (view !== 'app' || !user) return;
    const items = navForRole(user.role);
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const n = Number(e.key);
      if (n >= 1 && n <= items.length) setScreen(items[n - 1].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view, user]);

  if (booting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper">
        <div className="flex items-center gap-3 text-ink-muted">
          <Spinner />
          <span className="font-mono text-[11px] uppercase tracking-[0.1em]">Loading SAHARA</span>
        </div>
      </div>
    );
  }

  if (view === 'landing') {
    return <LandingScreen onEnter={() => setView(user ? 'app' : 'login')} />;
  }

  if (view === 'login' || !user) {
    return <LoginScreen onSignedIn={signedIn} onBack={() => setView('landing')} />;
  }

  return (
    <>
      <AppShell
        user={user}
        screen={screen}
        onNavigate={setScreen}
        onSignOut={signOut}
        theme={theme}
        onToggleTheme={toggle}
        streamConnected={connected}
        modelVersion={health?.model.version}
        headerExtra={
          user.role === 'admin' || user.role === 'demo_operator' ? (
            <DemoControls onReset={() => window.location.reload()} />
          ) : null
        }
      >
        <AnimatePresence mode="wait">
          <motion.div key={screen} variants={screenVariants} initial="hidden" animate="show" exit="exit">
            {screen === 'checkin' ? (
              <CheckinScreen user={user} onSubmitted={() => undefined} />
            ) : null}
            {screen === 'my-welfare' ? (
              <MyWelfareScreen user={user} onGoToCheckin={() => setScreen('checkin')} />
            ) : null}
            {screen === 'casework' ? <CaseworkScreen /> : null}
            {screen === 'interventions' ? <InterventionsScreen /> : null}
            {screen === 'force' ? <ForceScreen onOpenUnits={() => setScreen('units')} /> : null}
            {screen === 'units' ? <UnitsScreen /> : null}
            {screen === 'simulator' ? <SimulatorScreen user={user} /> : null}
            {screen === 'model' ? <ModelScreen /> : null}
            {screen === 'audit' ? <AuditScreen /> : null}
          </motion.div>
        </AnimatePresence>
      </AppShell>

      <Modal open={showKeys} onClose={() => setShowKeys(false)} title="Keyboard" eyebrow="Shortcuts" width="max-w-md">
        <ul className="space-y-2.5">
          {navForRole(user.role).map((item, i) => (
            <li key={item.id} className="flex items-center justify-between gap-4 text-[13px]">
              <span className="text-ink">{item.label}</span>
              <kbd className="rounded-sm border border-rule bg-paper-inset px-2 py-0.5 font-mono text-[11px] text-ink-muted">
                {i + 1}
              </kbd>
            </li>
          ))}
          <li className="flex items-center justify-between gap-4 border-t border-rule-hairline pt-2.5 text-[13px]">
            <span className="text-ink">This panel</span>
            <kbd className="rounded-sm border border-rule bg-paper-inset px-2 py-0.5 font-mono text-[11px] text-ink-muted">
              ?
            </kbd>
          </li>
        </ul>
      </Modal>
    </>
  );
}

/**
 * Demo controls, available only to the operator roles.
 *
 * `Reset` restores the seeded database. Useful between runs, and a quietly
 * convincing detail: a system with a reset button is a system whose state is
 * actually persisted somewhere.
 */
function DemoControls({ onReset }: { onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const reset = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.resetSystem();
      setMsg(res.message);
      setTimeout(onReset, 900);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Demo
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Demonstration controls" eyebrow="Operator" width="max-w-lg">
        <div className="space-y-4">
          <div>
            <Eyebrow>Reset</Eyebrow>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
              Drops every table and reseeds the synthetic cohort — 33 personnel,
              fourteen days of check-ins each, every one of them rescored by the
              live model. The demo is deterministic, so it comes back identical.
            </p>
            <Button variant="danger" className="mt-3" loading={busy} onClick={reset}>
              Reset demonstration data
            </Button>
            {msg ? <p className="mt-2 text-[12.5px] text-ink">{msg}</p> : null}
          </div>

          <div className="rule-t pt-4">
            <Eyebrow>Suggested run</Eyebrow>
            <ol className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-ink-muted">
              {[
                'Sign in as p-014 and submit a check-in with poor sleep and high stress.',
                'Watch it appear, pseudonymised, in the command live feed.',
                'Switch to wo-001: the case is open with ranked, evidenced measures.',
                'Run the same measures through the simulator and show the band change.',
                'Open the model card, then verify the audit chain.',
              ].map((s, i) => (
                <li key={s} className="flex gap-2.5">
                  <span className="shrink-0 font-mono text-[11px] text-ink-faint">{i + 1}</span>
                  {s}
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-wrap gap-1.5 border-t border-rule-hairline pt-4">
            <Chip>press ? for shortcuts</Chip>
            <Chip>1–9 jump between screens</Chip>
          </div>
        </div>
      </Modal>
    </>
  );
}
