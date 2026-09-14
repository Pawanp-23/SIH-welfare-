/**
 * Application shell: the rail, the header, and the frame everything renders in.
 *
 * Two decisions shape it. First, navigation is scoped by role rather than
 * merely disabled — a constable never sees that a command dashboard exists,
 * because a welfare tool that visibly watches you is one people stop using
 * honestly. Second, the header carries the system's live state (stream,
 * storage, model version) at all times, so nobody has to trust that the numbers
 * on screen are current; they can see that they are.
 */

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { duration, ease, spring } from '../design/motion.js';
import { Button, cx, Eyebrow } from '../design/primitives.js';
import type { UserProfile } from '../types.js';

export type ScreenId =
  | 'checkin'
  | 'my-welfare'
  | 'casework'
  | 'interventions'
  | 'force'
  | 'units'
  | 'simulator'
  | 'model'
  | 'audit';

interface NavItem {
  id: ScreenId;
  label: string;
  icon: React.ReactNode;
  roles: string[];
  hint: string;
}

const I = {
  checkin: (
    <path d="M4 5.5h9M4 9h9M4 12.5h5.5M14.5 12l1.6 1.6L19 10.5" strokeLinecap="round" strokeLinejoin="round" />
  ),
  pulse: <path d="M2 11h3.2l2.1-6 3.4 12 2.4-8 1.6 2h5.3" strokeLinecap="round" strokeLinejoin="round" />,
  folder: (
    <path d="M2.5 5.5a1 1 0 011-1h4l1.6 2h8.4a1 1 0 011 1v9a1 1 0 01-1 1h-14a1 1 0 01-1-1v-11z" strokeLinejoin="round" />
  ),
  target: (
    <>
      <circle cx="11" cy="11" r="7.2" />
      <circle cx="11" cy="11" r="3.2" />
      <path d="M11 1.8v3M11 17.2v3M1.8 11h3M17.2 11h3" strokeLinecap="round" />
    </>
  ),
  grid: (
    <>
      <rect x="2.8" y="2.8" width="6.4" height="6.4" rx="1" />
      <rect x="12.8" y="2.8" width="6.4" height="6.4" rx="1" />
      <rect x="2.8" y="12.8" width="6.4" height="6.4" rx="1" />
      <rect x="12.8" y="12.8" width="6.4" height="6.4" rx="1" />
    </>
  ),
  map: <path d="M2.5 5l5.5-2 6 2 5.5-2v13l-5.5 2-6-2-5.5 2V5zM8 3v13M14 5v13" strokeLinejoin="round" />,
  sliders: (
    <path d="M3 6h7M14 6h5M3 15h4M11 15h8M12 6a2 2 0 11-4 0 2 2 0 014 0zM11 15a2 2 0 104 0 2 2 0 00-4 0z" strokeLinecap="round" />
  ),
  cpu: (
    <>
      <rect x="5.5" y="5.5" width="11" height="11" rx="1.6" />
      <rect x="8.8" y="8.8" width="4.4" height="4.4" rx="0.8" />
      <path d="M8.5 2.5v3M13.5 2.5v3M8.5 16.5v3M13.5 16.5v3M2.5 8.5h3M2.5 13.5h3M16.5 8.5h3M16.5 13.5h3" strokeLinecap="round" />
    </>
  ),
  shield: <path d="M11 2.5l7 2.6v6.2c0 4.2-2.9 7.4-7 8.7-4.1-1.3-7-4.5-7-8.7V5.1l7-2.6z" strokeLinejoin="round" />,
};

export const NAV: NavItem[] = [
  { id: 'checkin', label: 'Daily check-in', icon: I.checkin, roles: ['personnel', 'welfare_officer', 'command_viewer', 'admin', 'demo_operator'], hint: 'Thirty seconds, five questions' },
  { id: 'my-welfare', label: 'My welfare', icon: I.pulse, roles: ['personnel', 'welfare_officer', 'command_viewer', 'admin', 'demo_operator'], hint: 'Your own trend and what drives it' },
  { id: 'casework', label: 'Casework', icon: I.folder, roles: ['welfare_officer', 'admin', 'demo_operator'], hint: 'Open welfare cases assigned to you' },
  { id: 'interventions', label: 'Interventions', icon: I.target, roles: ['welfare_officer', 'admin', 'demo_operator'], hint: 'Ranked by modelled effect' },
  { id: 'force', label: 'Force overview', icon: I.grid, roles: ['command_viewer', 'admin', 'demo_operator'], hint: 'Aggregate readiness and risk' },
  { id: 'units', label: 'Unit intelligence', icon: I.map, roles: ['command_viewer', 'admin', 'demo_operator'], hint: 'Where the pressure is concentrated' },
  { id: 'simulator', label: 'What-if simulator', icon: I.sliders, roles: ['welfare_officer', 'command_viewer', 'admin', 'demo_operator'], hint: 'Test a decision before making it' },
  { id: 'model', label: 'Model card', icon: I.cpu, roles: ['command_viewer', 'admin', 'demo_operator', 'welfare_officer'], hint: 'Performance, fairness and drift' },
  { id: 'audit', label: 'Audit & privacy', icon: I.shield, roles: ['personnel', 'welfare_officer', 'command_viewer', 'admin', 'demo_operator'], hint: 'Who looked at what, and when' },
];

export function navForRole(role: string): NavItem[] {
  return NAV.filter((item) => item.roles.includes(role));
}

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
      {children}
    </svg>
  );
}

// ---------------------------------------------------------------------------

export function Wordmark({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
        <rect x="0.75" y="0.75" width="24.5" height="24.5" rx="5" fill="var(--accent)" />
        {/* A pulse trace inside the mark: the product is a monitor, not a shield. */}
        <path
          d="M5 14.2h3l2-5.4 3 10 2.2-6.2 1.4 1.6H21"
          fill="none"
          stroke="var(--accent-ink)"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {!compact ? (
        <div className="leading-none">
          <div className="font-serif text-[19px] tracking-[0.01em] text-ink-strong">SAHARA</div>
          <div className="mt-0.5 font-mono text-[8.5px] uppercase tracking-[0.16em] text-ink-faint">
            Welfare Intelligence
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function AppShell({
  user,
  screen,
  onNavigate,
  onSignOut,
  theme,
  onToggleTheme,
  streamConnected,
  modelVersion,
  children,
  headerExtra,
}: {
  user: UserProfile;
  screen: ScreenId;
  onNavigate: (id: ScreenId) => void;
  onSignOut: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  streamConnected: boolean;
  modelVersion?: string;
  children: React.ReactNode;
  headerExtra?: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const items = navForRole(user.role);
  const current = items.find((i) => i.id === screen) ?? items[0];

  const rail = (
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className={cx('mb-4 flex items-center px-1.5 pt-1', collapsed ? 'justify-center' : 'justify-between')}>
        <Wordmark compact={collapsed} />
        {!collapsed ? (
          <button
            onClick={() => setCollapsed(true)}
            aria-label="Collapse navigation"
            className="hidden rounded-sm p-1 text-ink-faint transition-colors hover:bg-paper-inset hover:text-ink lg:block"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
              <path d="M9.5 4L5.5 8l4 4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : null}
      </div>

      {collapsed ? (
        <button
          onClick={() => setCollapsed(false)}
          aria-label="Expand navigation"
          className="mx-auto mb-2 rounded-sm p-1 text-ink-faint hover:bg-paper-inset hover:text-ink"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M6.5 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : null}

      <ul className="flex-1 space-y-0.5">
        {items.map((item) => {
          const active = item.id === screen;
          return (
            <li key={item.id}>
              <button
                onClick={() => {
                  onNavigate(item.id);
                  setMobileOpen(false);
                }}
                title={collapsed ? item.label : item.hint}
                className={cx(
                  'group relative flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-[13px] transition-colors',
                  active ? 'text-ink-strong' : 'text-ink-muted hover:bg-paper-inset hover:text-ink',
                  collapsed && 'justify-center px-0',
                )}
              >
                {active ? (
                  <motion.span
                    layoutId="nav-active"
                    transition={spring}
                    className="absolute inset-0 -z-10 rounded-sm bg-paper-raised shadow-e1 ring-1 ring-rule"
                  />
                ) : null}
                <span className={cx('shrink-0', active ? 'text-accent' : '')}>
                  <Icon>{item.icon}</Icon>
                </span>
                {!collapsed ? <span className="truncate">{item.label}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>

      {!collapsed ? (
        <div className="rounded-sm border border-rule bg-paper-inset px-3 py-2.5">
          <Eyebrow>Signed in</Eyebrow>
          <div className="mt-1 truncate text-[13px] text-ink">{user.name}</div>
          <div className="truncate font-mono text-[10px] text-ink-faint">
            {user.rank} · {user.id}
          </div>
          <button
            onClick={onSignOut}
            className="mt-2 font-mono text-[10px] uppercase tracking-[0.09em] text-ink-faint transition-colors hover:text-review"
          >
            Sign out
          </button>
        </div>
      ) : null}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-paper">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {/* Desktop rail */}
      <aside
        className={cx(
          'sticky top-0 hidden h-screen shrink-0 border-r border-rule bg-paper-sunken transition-[width] duration-300 lg:block',
          collapsed ? 'w-[64px]' : 'w-[236px]',
        )}
        style={{ transitionTimingFunction: 'cubic-bezier(0.22,1,0.36,1)' }}
      >
        {rail}
      </aside>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen ? (
          <motion.div
            className="fixed inset-0 z-50 lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-[rgba(20,17,10,0.4)]" onClick={() => setMobileOpen(false)} />
            <motion.div
              initial={{ x: -260 }}
              animate={{ x: 0 }}
              exit={{ x: -260 }}
              transition={spring}
              className="absolute inset-y-0 left-0 w-[248px] border-r border-rule bg-paper-sunken"
            >
              {rail}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-rule bg-paper/85 backdrop-blur-md">
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
            <button
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
              className="rounded-sm p-1.5 text-ink-muted hover:bg-paper-inset lg:hidden"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2.5 5h13M2.5 9h13M2.5 13h13" strokeLinecap="round" />
              </svg>
            </button>

            <div className="min-w-0 flex-1">
              <div className="eyebrow">{roleLabel(user.role)}</div>
              <h1 className="truncate text-[21px] leading-tight">{current?.label}</h1>
            </div>

            {headerExtra}

            <div className="hidden items-center gap-2 sm:flex">
              <StreamPill connected={streamConnected} />
              {modelVersion ? (
                <span
                  className="rounded-sm border border-rule bg-paper-raised px-2 py-1 font-mono text-[10px] text-ink-faint"
                  title="Model artifact currently loaded by the inference engine"
                >
                  {modelVersion}
                </span>
              ) : null}
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleTheme}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {theme === 'dark' ? (
                <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <circle cx="9" cy="9" r="3.4" />
                  <path d="M9 1.5v2M9 14.5v2M1.5 9h2M14.5 9h2M3.7 3.7l1.4 1.4M12.9 12.9l1.4 1.4M14.3 3.7l-1.4 1.4M5.1 12.9l-1.4 1.4" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <path d="M15.2 11.3A6.8 6.8 0 016.7 2.8a6.8 6.8 0 108.5 8.5z" strokeLinejoin="round" />
                </svg>
              )}
            </Button>
          </div>
        </header>

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1320px] flex-1 px-4 py-6 outline-none sm:px-6 sm:py-8">{children}</main>

        <footer className="border-t border-rule px-4 py-4 sm:px-6">
          <p className="mx-auto max-w-[1320px] font-mono text-[10px] leading-relaxed text-ink-faint">
            SAHARA operates on synthetic data. Aggregates are suppressed below a cohort of 10.
            Individual records are visible only to the person themselves and their assigned welfare
            officer — never to command.
          </p>
        </footer>
      </div>
    </div>
  );
}

function StreamPill({ connected }: { connected: boolean }) {
  return (
    <span
      className="flex items-center gap-1.5 rounded-sm border border-rule bg-paper-raised px-2 py-1 font-mono text-[10px] text-ink-faint"
      title={connected ? 'Receiving live events from the server' : 'Live stream reconnecting'}
    >
      <span className="relative flex size-1.5">
        {connected ? (
          <motion.span
            className="absolute inline-flex size-full rounded-full bg-routine"
            animate={{ opacity: [1, 0.35, 1] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          />
        ) : (
          <span className="inline-flex size-full rounded-full bg-watch" />
        )}
      </span>
      {connected ? 'LIVE' : 'RECONNECTING'}
    </span>
  );
}

export function roleLabel(role: string): string {
  switch (role) {
    case 'personnel':
      return 'Personnel';
    case 'welfare_officer':
      return 'Welfare officer';
    case 'command_viewer':
      return 'Command';
    case 'admin':
      return 'System administrator';
    case 'demo_operator':
      return 'Demonstration operator';
    default:
      return role;
  }
}

/** Page-level heading used at the top of each screen's content. */
export function ScreenIntro({
  title,
  lede,
  actions,
}: {
  title: React.ReactNode;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.base, ease }}
      className="mb-6 flex flex-wrap items-end justify-between gap-4"
    >
      <div className="max-w-2xl">
        <h2 className="text-[30px] leading-[1.1]">{title}</h2>
        {lede ? <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">{lede}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </motion.div>
  );
}
