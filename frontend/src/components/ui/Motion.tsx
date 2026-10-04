import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

const EASE = [0.16, 1, 0.3, 1] as const;

export function AnimatedPage({ children, className = '' }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.28, ease: EASE }}
      className={className}
    >
      {children}
    </motion.section>
  );
}

type MotionIntensity = 'high' | 'medium' | 'low';

export function AnimatedCard({ children, className = '', delay = 0, intensity = 'medium' }: { children: ReactNode; className?: string; delay?: number; intensity?: MotionIntensity }) {
  const reduce = useReducedMotion();
  const hover = intensity === 'high' ? { y: -3, rotateX: 1.2, rotateY: -0.8, scale: 1.008 } : intensity === 'medium' ? { y: -2, scale: 1.005 } : { y: -1 };
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.3, delay: reduce ? 0 : delay, ease: EASE }}
      whileHover={reduce ? undefined : hover}
      whileTap={reduce ? undefined : { scale: 0.99 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function AnimatedCounter({ value, className = '' }: { value: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      key={value}
      initial={reduce ? false : { opacity: 0.35, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.22, ease: EASE }}
      className={className}
      aria-live="polite"
    >
      {value.toLocaleString('en-IN')}
    </motion.span>
  );
}

export function AnimatedProgress({ value, className = '', label, barClassName = 'bg-brand' }: { value: number; className?: string; label?: string; barClassName?: string }) {
  const reduce = useReducedMotion();
  return (
    <div className={className} aria-label={label} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
      <motion.div
        initial={reduce ? false : { scaleX: 0 }}
        animate={{ scaleX: Math.max(0, Math.min(100, value)) / 100 }}
        transition={{ duration: reduce ? 0 : 0.55, ease: EASE }}
        className={`h-full origin-left rounded-[inherit] ${barClassName}`}
      />
    </div>
  );
}

export function AnimatedHeart({ pressed, onClick, label = 'Favorite' }: { pressed: boolean; onClick: () => void; label?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      whileTap={reduce ? undefined : { scale: 0.86 }}
      className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-brand transition-colors hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      <motion.span
        key={pressed ? 'filled' : 'empty'}
        initial={reduce ? false : { scale: 0.7, opacity: 0.5 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: reduce ? 0 : 0.25, ease: EASE }}
        className="text-xl leading-none"
        aria-hidden
      >
        {pressed ? '♥' : '♡'}
      </motion.span>
      <AnimatePresence>
        {pressed && !reduce && (
          <motion.span
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: [0, 0.8, 0], scale: [0.5, 1.4, 1.8] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45 }}
            className="pointer-events-none absolute inset-1 rounded-full border border-gold"
            aria-hidden
          />
        )}
      </AnimatePresence>
    </motion.button>
  );
}

export function AnimatedList({ children, className = '' }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : 'hidden'}
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: reduce ? 0 : 0.045 } } }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function AnimatedStatus({ children, className = '' }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.span
      initial={reduce ? false : { opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: reduce ? 0 : 0.2, ease: EASE }}
      className={className}
    >
      {children}
    </motion.span>
  );
}

export function AnimatedToggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  const reduce = useReducedMotion();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`inline-flex h-6 w-11 items-center rounded-full p-1 transition-colors ${checked ? 'bg-brand' : 'bg-gray-300'}`}
    >
      <motion.span
        animate={{ x: checked ? 20 : 0 }}
        transition={{ duration: reduce ? 0 : 0.2, ease: EASE }}
        className="block h-4 w-4 rounded-full bg-white shadow-sm"
      />
    </button>
  );
}

export function AnimatedModal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-scrim/45 p-4 backdrop-blur-sm"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="wow-motion-dialog-title"
            className="w-full max-w-lg rounded-lg border border-gold/35 bg-surface p-5 shadow-pop"
            initial={reduce ? false : { opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: reduce ? 0 : 0.22, ease: EASE }}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="wow-motion-dialog-title" className="text-lg font-semibold text-gray-900">{title}</h2>
            <div className="mt-3">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function AnimatedTimeline({ items, activeIndex, className = '' }: { items: string[]; activeIndex: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <div className={className} aria-label="Workflow progress">
      <div className="flex items-start">
        {items.map((item, index) => {
          const complete = index < activeIndex;
          const active = index === activeIndex;
          return (
            <div key={item} className="flex min-w-0 flex-1 items-start last:flex-none">
              <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
                <motion.span
                  initial={reduce ? false : { scale: 0.8, opacity: 0.5 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: reduce ? 0 : index * 0.06, duration: reduce ? 0 : 0.2 }}
                  className={`grid h-7 w-7 place-items-center rounded-full border text-xs font-semibold ${complete ? 'border-brand bg-brand text-brand-fg' : active ? 'border-gold bg-gold text-gray-900' : 'border-gray-300 bg-surface text-gray-400'}`}
                  aria-current={active ? 'step' : undefined}
                >
                  {complete ? '✓' : index + 1}
                </motion.span>
                <span className={`text-center text-[0.6875rem] ${active || complete ? 'font-semibold text-gray-800' : 'text-gray-400'}`}>{item}</span>
              </div>
              {index < items.length - 1 && (
                <motion.span
                  initial={reduce ? false : { scaleX: 0 }}
                  animate={{ scaleX: index < activeIndex ? 1 : 0.35 }}
                  transition={{ duration: reduce ? 0 : 0.45, delay: reduce ? 0 : index * 0.06, ease: EASE }}
                  className={`mt-3 h-px min-w-2 flex-1 origin-left ${index < activeIndex ? 'bg-brand' : 'bg-gray-200'}`}
                  aria-hidden
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}