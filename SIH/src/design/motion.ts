/**
 * A shared motion vocabulary.
 *
 * The point of putting this in one file is consistency: every panel in the
 * product should enter the same way, at the same speed, on the same curve. When
 * each screen invents its own timing the interface feels assembled rather than
 * designed, and that is the single most reliable tell of a machine-written UI.
 *
 * Three rules govern everything here:
 *
 *   1. Motion explains a relationship or it does not happen. Panels rise
 *      slightly as they enter because they are arriving from below the fold;
 *      a risk bar grows from zero because it is measuring something. Nothing
 *      spins, bounces, or pulses for decoration.
 *   2. Nothing meaningful takes longer than 520ms. Beyond that, a person
 *      waiting to act on a welfare alert is being made to watch an animation.
 *   3. Everything respects `prefers-reduced-motion`.
 */

import type { Transition, Variants } from 'motion/react';

export const ease = [0.22, 1, 0.36, 1] as const;
export const easeInOut = [0.65, 0, 0.35, 1] as const;

export const duration = {
  fast: 0.16,
  base: 0.28,
  slow: 0.52,
} as const;

export const spring: Transition = { type: 'spring', stiffness: 380, damping: 34, mass: 0.9 };
export const softSpring: Transition = { type: 'spring', stiffness: 210, damping: 28 };

/** Standard panel entrance: a short rise with the fade. */
export const rise: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: duration.base, ease } },
  exit: { opacity: 0, y: -8, transition: { duration: duration.fast, ease } },
};

export const fade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: duration.base, ease } },
  exit: { opacity: 0, transition: { duration: duration.fast, ease } },
};

/** Parent for any list or grid whose children should arrive in sequence. */
export const stagger = (delayChildren = 0.02, staggerChildren = 0.045): Variants => ({
  hidden: {},
  show: { transition: { delayChildren, staggerChildren } },
  exit: { transition: { staggerChildren: 0.015, staggerDirection: -1 } },
});

/** Child of `stagger`. Deliberately smaller travel than a full panel. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: duration.base, ease } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.12, ease } },
};

/** Screen-to-screen transition. Horizontal, because the nav is vertical. */
export const screen: Variants = {
  hidden: { opacity: 0, x: 14 },
  show: { opacity: 1, x: 0, transition: { duration: duration.base, ease } },
  exit: { opacity: 0, x: -10, transition: { duration: 0.15, ease } },
};

/** A bar or gauge measuring a value: grows from its own origin. */
export const measure = (delay = 0): Variants => ({
  hidden: { scaleX: 0, opacity: 0.4 },
  show: {
    scaleX: 1,
    opacity: 1,
    transition: { duration: duration.slow, ease, delay },
  },
});

export const overlay: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: duration.fast } },
  exit: { opacity: 0, transition: { duration: duration.fast } },
};

export const dialog: Variants = {
  hidden: { opacity: 0, y: 18, scale: 0.985 },
  show: { opacity: 1, y: 0, scale: 1, transition: spring },
  exit: { opacity: 0, y: 10, scale: 0.99, transition: { duration: 0.14, ease } },
};

/** Something arriving in real time over the event stream. */
export const alertIn: Variants = {
  hidden: { opacity: 0, x: 24, height: 0 },
  show: { opacity: 1, x: 0, height: 'auto', transition: spring },
  exit: { opacity: 0, x: 24, height: 0, transition: { duration: 0.2, ease } },
};
