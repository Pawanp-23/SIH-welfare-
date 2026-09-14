/**
 * The component vocabulary every SAHARA screen is built from.
 *
 * Screens compose these; they never reach for a raw hex value, a one-off
 * border radius, or their own idea of what a panel header looks like. That is
 * what keeps twelve screens looking like one product.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useInView, useReducedMotion } from 'motion/react';

import { dialog, duration, ease, measure, overlay, rise, spring } from './motion.js';

export type Band = 'routine' | 'watch' | 'review';

export const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(' ');

// ---------------------------------------------------------------------------
// Band semantics — the one place that decides what a risk level looks like
// ---------------------------------------------------------------------------

export const BAND = {
  routine: {
    label: 'Routine',
    fg: 'text-routine',
    bg: 'bg-routine-bg',
    border: 'border-routine/25',
    dot: 'bg-routine',
    css: 'var(--signal-routine)',
    description: 'No action required. Continue normal welfare contact.',
  },
  watch: {
    label: 'Watch',
    fg: 'text-watch',
    bg: 'bg-watch-bg',
    border: 'border-watch/30',
    dot: 'bg-watch',
    css: 'var(--signal-watch)',
    description: 'Monitor. Raise at the next unit welfare review.',
  },
  review: {
    label: 'Review',
    fg: 'text-review',
    bg: 'bg-review-bg',
    border: 'border-review/30',
    dot: 'bg-review',
    css: 'var(--signal-review)',
    description: 'Welfare officer contact within 24 hours.',
  },
} as const satisfies Record<Band, Record<string, string>>;

export const bandOf = (score: number): Band =>
  score >= 65 ? 'review' : score >= 40 ? 'watch' : 'routine';

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export function Panel({
  children,
  className,
  as: Tag = 'section',
  inset,
  ...rest
}: React.HTMLAttributes<HTMLElement> & { as?: React.ElementType; inset?: boolean }) {
  return (
    <Tag
      className={cx(
        'surface rounded-lg border border-rule bg-paper-raised',
        inset && 'bg-paper-inset shadow-none [background-image:none]',
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function PanelHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cx(
        'flex items-start justify-between gap-4 border-b border-rule-hairline px-5 py-4',
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow mb-1.5">{eyebrow}</div> : null}
        <h3 className="text-[19px] leading-tight">{title}</h3>
        {description ? (
          <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-ink-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** A panel that enters when scrolled into view, once. */
export function RevealPanel({
  children,
  delay = 0,
  className,
  ...rest
}: React.HTMLAttributes<HTMLElement> & { delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  return (
    <motion.div
      ref={ref}
      initial="hidden"
      animate={inView ? 'show' : 'hidden'}
      variants={rise}
      transition={{ delay }}
      className={cx('surface rounded-lg border border-rule bg-paper-raised', className)}
      {...(rest as object)}
    >
      {children}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Typography helpers
// ---------------------------------------------------------------------------

export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx('eyebrow', className)}>{children}</div>;
}

export function Display({
  children,
  className,
  italic,
}: {
  children: React.ReactNode;
  className?: string;
  italic?: boolean;
}) {
  return (
    <span
      className={cx('font-serif tracking-[-0.02em] text-ink-strong', italic && 'italic', className)}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/**
 * A number that counts to its value on first paint.
 *
 * Not decoration: on a dashboard where several figures update at once, the
 * count draws the eye to what changed. It snaps instantly for anyone who has
 * asked for reduced motion, and it never animates on a re-render caused by
 * something unrelated.
 */
export function Ticker({
  value,
  decimals = 0,
  duration: dur = 0.9,
  className,
  prefix = '',
  suffix = '',
}: {
  value: number;
  decimals?: number;
  duration?: number;
  className?: string;
  prefix?: string;
  suffix?: string;
}) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  const from = useRef(0);

  useEffect(() => {
    if (reduce) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / (dur * 1000));
      // easeOutExpo, matching the CSS --ease-out curve
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setShown(origin + (value - origin) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, dur, reduce]);

  return (
    <span className={cx('tnum', className)}>
      {prefix}
      {shown.toFixed(decimals)}
      {suffix}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Badges & pills
// ---------------------------------------------------------------------------

export function BandBadge({
  band,
  size = 'md',
  showDot = true,
  className,
}: {
  band: Band;
  size?: 'sm' | 'md';
  showDot?: boolean;
  className?: string;
}) {
  const b = BAND[band];
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-sm border font-mono uppercase tracking-[0.09em]',
        b.bg,
        b.fg,
        b.border,
        size === 'sm' ? 'px-1.5 py-0.5 text-[9.5px]' : 'px-2 py-1 text-[10.5px]',
        className,
      )}
      title={b.description}
    >
      {showDot ? <span className={cx('size-1.5 rounded-full', b.dot)} /> : null}
      {b.label}
    </span>
  );
}

export function Chip({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'accent' | 'warn';
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px]',
        tone === 'neutral' && 'border-rule bg-paper-inset text-ink-muted',
        tone === 'accent' && 'border-accent/25 bg-accent-soft text-accent',
        tone === 'warn' && 'border-watch/30 bg-watch-bg text-watch',
        className,
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  loading?: boolean;
};

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  icon,
  loading,
  className,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.975 }}
      transition={spring}
      disabled={disabled || loading}
      className={cx(
        'inline-flex select-none items-center justify-center gap-2 rounded-sm border font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-45',
        size === 'sm' && 'px-2.5 py-1.5 text-[12.5px]',
        size === 'md' && 'px-3.5 py-2 text-[13.5px]',
        size === 'lg' && 'px-5 py-2.5 text-[14.5px]',
        variant === 'primary' &&
          'border-accent bg-accent text-accent-ink hover:bg-accent-hover hover:border-accent-hover',
        variant === 'secondary' &&
          'border-rule-strong bg-paper-raised text-ink hover:bg-paper-inset',
        variant === 'ghost' && 'border-transparent bg-transparent text-ink-muted hover:text-ink hover:bg-paper-inset',
        variant === 'danger' && 'border-review/40 bg-review-bg text-review hover:bg-review hover:text-paper-raised',
        className,
      )}
      {...(rest as object)}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </motion.button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cx('inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent', className)}
      aria-hidden
    />
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cx('block', className)}>
      <span className="eyebrow mb-1.5 block">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-[11.5px] text-ink-faint">{hint}</span> : null}
    </label>
  );
}

export const inputClass =
  'w-full rounded-sm border border-rule-strong bg-paper px-3 py-2 text-[13.5px] text-ink ' +
  'placeholder:text-ink-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15 transition';

/**
 * A discrete 1-5 rating, as five labelled stops rather than a slider.
 *
 * Sliders invite a person to place a value they cannot actually distinguish.
 * Five labelled stops match how the underlying instrument is scored and, more
 * practically, they are hittable with a thumb on a phone in a field posting.
 */
export function Scale({
  value,
  onChange,
  labels,
  name,
}: {
  value: number;
  onChange: (v: number) => void;
  labels?: string[];
  name: string;
}) {
  return (
    <div className="flex gap-1.5" role="radiogroup" aria-label={name}>
      {[1, 2, 3, 4, 5].map((n) => {
        const active = value === n;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={labels?.[n - 1] ?? String(n)}
            onClick={() => onChange(n)}
            className={cx(
              'group relative flex-1 rounded-sm border py-2.5 text-center transition-colors',
              active
                ? 'border-accent bg-accent text-accent-ink'
                : 'border-rule bg-paper text-ink-muted hover:border-rule-strong hover:bg-paper-inset',
            )}
          >
            <span className="font-mono text-[15px]">{n}</span>
            {labels?.[n - 1] ? (
              <span
                className={cx(
                  'mt-0.5 block text-[10px] leading-tight',
                  active ? 'text-accent-ink/75' : 'text-ink-faint',
                )}
              >
                {labels[n - 1]}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  format,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="font-mono text-[15px] text-ink-strong tnum">
          {format ? format(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full cursor-pointer appearance-none bg-transparent
          [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full
          [&::-webkit-slider-thumb]:mt-[-6px] [&::-webkit-slider-thumb]:size-[15px]
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
          [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-paper-raised
          [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:shadow-e2
          [&::-moz-range-thumb]:size-[15px] [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-paper-raised
          [&::-moz-range-thumb]:bg-[var(--accent)]"
        style={{
          // Filled track to the left of the thumb, unfilled to the right.
          ['--fill' as string]: `${pct}%`,
          background: 'transparent',
        }}
        onInput={(e) => {
          const el = e.currentTarget;
          el.style.setProperty('--fill', `${((Number(el.value) - min) / (max - min)) * 100}%`);
        }}
      />
      <div className="-mt-[13px] h-1.5 rounded-full bg-paper-sunken">
        <div
          className="h-1.5 rounded-full bg-[var(--accent)] transition-[width] duration-150"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-sm border border-rule bg-paper px-3 py-2.5 text-left transition-colors hover:bg-paper-inset"
    >
      <span
        className={cx(
          'mt-0.5 flex h-[18px] w-[30px] shrink-0 items-center rounded-full p-[2px] transition-colors',
          checked ? 'bg-[var(--accent)]' : 'bg-rule-strong',
        )}
      >
        <motion.span
          layout
          transition={spring}
          className="size-[14px] rounded-full bg-paper-raised shadow-e1"
          style={{ marginLeft: checked ? 12 : 0 }}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] text-ink">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-faint">{description}</span>
        ) : null}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

/**
 * Tabs with a single shared underline that slides between items.
 *
 * `layoutId` is what makes it one object moving rather than two fading — it is
 * the clearest possible signal of "you moved from there to here".
 */
export function Tabs<T extends string>({
  items,
  value,
  onChange,
  layoutId = 'tab-underline',
}: {
  // T is inferred from `value` alone. Without the NoInfer guards TypeScript
  // also infers from `onChange`, and a `Dispatch<SetStateAction<'open'|'all'>>`
  // drags the union out to `string` — which then rejects the very setter that
  // produced it.
  items: Array<{ id: NoInfer<T>; label: React.ReactNode; count?: number }>;
  value: T;
  onChange: (v: NoInfer<T>) => void;
  layoutId?: string;
}) {
  return (
    <div className="flex gap-0.5 border-b border-rule" role="tablist">
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={cx(
              'relative px-3.5 py-2.5 text-[13px] transition-colors',
              active ? 'text-ink-strong' : 'text-ink-muted hover:text-ink',
            )}
          >
            <span className="flex items-center gap-1.5">
              {item.label}
              {item.count !== undefined ? (
                <span className="rounded-sm bg-paper-sunken px-1.5 py-px font-mono text-[10px] text-ink-muted">
                  {item.count}
                </span>
              ) : null}
            </span>
            {active ? (
              <motion.span
                layoutId={layoutId}
                transition={spring}
                className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-[var(--accent)]"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overlay
// ---------------------------------------------------------------------------

export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  children,
  width = 'max-w-2xl',
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  children: React.ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    // Prevent the page behind from scrolling under the dialog.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
          variants={overlay}
          initial="hidden"
          animate="show"
          exit="exit"
        >
          <div
            className="absolute inset-0 bg-[rgba(20,17,10,0.42)] backdrop-blur-[2px]"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            variants={dialog}
            className={cx(
              'relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-lg border border-rule bg-paper-raised shadow-e3',
              width,
            )}
          >
            <header className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
              <div>
                {eyebrow ? <div className="eyebrow mb-1">{eyebrow}</div> : null}
                <h2 className="text-[22px] leading-tight">{title}</h2>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="-mr-1 rounded-sm p-1.5 text-ink-faint transition-colors hover:bg-paper-inset hover:text-ink"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cx('animate-pulse rounded-sm bg-paper-sunken', className)}
      aria-hidden
    />
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon ? <div className="mb-3 text-ink-faint">{icon}</div> : null}
      <p className="font-serif text-[19px] text-ink-strong">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorNote({ children, onRetry }: { children: React.ReactNode; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-sm border border-review/30 bg-review-bg px-4 py-3">
      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-review" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-review">{children}</p>
        {onRetry ? (
          <button onClick={onRetry} className="mt-1.5 text-[12px] text-review underline underline-offset-2">
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Measures
// ---------------------------------------------------------------------------

/** A horizontal bar that grows from its origin, used for SHAP and importance. */
export function Meter({
  value,
  max,
  color,
  delay = 0,
  className,
  origin = 'left',
}: {
  value: number;
  max: number;
  color?: string;
  delay?: number;
  className?: string;
  origin?: 'left' | 'right';
}) {
  const pct = max === 0 ? 0 : Math.min(100, (Math.abs(value) / max) * 100);
  const variants = useMemo(() => measure(delay), [delay]);
  return (
    <div className={cx('h-full w-full', className)}>
      <motion.div
        variants={variants}
        initial="hidden"
        animate="show"
        className="h-full rounded-[2px]"
        style={{
          width: `${pct}%`,
          background: color ?? 'var(--accent)',
          transformOrigin: origin,
          marginLeft: origin === 'right' ? 'auto' : undefined,
        }}
      />
    </div>
  );
}

/** Key figure with label, optional delta, and an optional sparkline slot. */
export function Stat({
  label,
  value,
  unit,
  delta,
  deltaLabel,
  hint,
  tone,
  children,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: React.ReactNode;
  delta?: number;
  deltaLabel?: string;
  hint?: React.ReactNode;
  tone?: Band;
  children?: React.ReactNode;
}) {
  const good = delta !== undefined && delta < 0;
  return (
    <div className="flex min-w-0 flex-col justify-between gap-3 p-4">
      <div className="eyebrow">{label}</div>
      <div>
        <div className="flex items-baseline gap-1.5">
          <span
            className="font-serif text-[34px] leading-none tnum"
            style={tone ? { color: BAND[tone].css } : undefined}
          >
            {value}
          </span>
          {unit ? <span className="text-[12px] text-ink-faint">{unit}</span> : null}
          {delta !== undefined ? (
            <span
              className={cx(
                'ml-1 font-mono text-[11.5px]',
                good ? 'text-routine' : delta > 0 ? 'text-review' : 'text-ink-faint',
              )}
            >
              {delta > 0 ? '+' : ''}
              {delta.toFixed(1)}
              {deltaLabel ? <span className="ml-1 text-ink-faint">{deltaLabel}</span> : null}
            </span>
          ) : null}
        </div>
        {hint ? <div className="mt-1.5 text-[11.5px] leading-snug text-ink-faint">{hint}</div> : null}
        {children}
      </div>
    </div>
  );
}

/**
 * Tooltip that explains a term on hover *and* on focus.
 *
 * A welfare officer reading "PSI 0.07" should not have to leave the page to
 * find out what it means, and a keyboard user should get the same help.
 */
export function Info({ children, label }: { children: React.ReactNode; label: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label="Explain"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex size-[14px] items-center justify-center rounded-full border border-rule-strong text-[9px] font-medium text-ink-faint transition-colors hover:border-ink-faint hover:text-ink"
      >
        ?
      </button>
      <AnimatePresence>
        {open ? (
          <motion.span
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: duration.fast, ease }}
            role="tooltip"
            className="absolute bottom-full left-1/2 z-40 mb-2 w-60 -translate-x-1/2 rounded-sm border border-rule bg-paper-raised px-3 py-2 text-[11.5px] leading-relaxed text-ink shadow-e3"
          >
            <span className="mb-0.5 block font-medium text-ink-strong">{label}</span>
            {children}
          </motion.span>
        ) : null}
      </AnimatePresence>
    </span>
  );
}
