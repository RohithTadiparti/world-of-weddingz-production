import { Link, useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import type { Icon } from '@phosphor-icons/react';

export interface SidebarEntry {
  to: string;
  label: string;
  icon: Icon;
  group: string;
  badge?: number;
}

export default function Sidebar({
  entries,
  groups,
  onNavigate,
  gradient = false,
  rail = false,
}: {
  entries: SidebarEntry[];
  groups: { key: string; title: string | null }[];
  onNavigate?: () => void;
  gradient?: boolean;
  rail?: boolean;
}) {
  const { pathname } = useLocation();
  const reduce = useReducedMotion();

  return (
    <nav aria-label="Main" className="flex flex-col gap-7 py-1">
      {groups.map(({ key, title }) => {
        const items = entries.filter((entry) => entry.group === key);
        if (items.length === 0) return null;

        return (
          <div key={key}>
            {title && (
              <h2
                className={`mb-2 w-fit px-3 text-[0.625rem] font-semibold uppercase tracking-[0.16em] ${
                  rail ? 'text-brand-fg/55' : 'bg-canvas text-gray-400'
                }`}
              >
                {title}
              </h2>
            )}
            <ul className="flex flex-col gap-0.5">
              {items.map((entry) => {
                const active = pathname === entry.to;
                const Glyph = entry.icon;

                return (
                  <li key={entry.to}>
                    <Link
                      to={entry.to}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={`group relative flex items-center gap-3 rounded-lg border-l-2 px-3 py-2.5 text-sm transition-colors duration-150 ${
                        active
                          ? gradient
                            ? 'border-gold-lit text-brand-fg'
                            : 'border-brand text-brand-strong'
                          : rail
                            ? 'border-transparent text-brand-fg/80 hover:border-gold-lit/60 hover:bg-brand-fg/10 hover:text-brand-fg'
                            : 'border-transparent bg-canvas text-gray-600 hover:border-brand/40 hover:bg-brand/8 hover:text-brand-strong'
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId="nav-active"
                          className={`absolute inset-0 -z-10 rounded-md ${
                            gradient
                              ? 'bg-gradient-to-r from-brand to-brand-rose shadow-btn'
                              : 'bg-brand/10'
                          }`}
                          transition={
                            reduce
                              ? { duration: 0 }
                              : { type: 'spring', stiffness: 420, damping: 34 }
                          }
                        />
                      )}
                      <Glyph
                        size={18}
                        weight={active ? 'fill' : 'regular'}
                        className="shrink-0"
                        aria-hidden
                      />
                      <span className="truncate">{entry.label}</span>
                      {entry.badge !== undefined && entry.badge > 0 && (
                        <span
                          className="ml-auto shrink-0 rounded-full bg-brand px-1.5 py-0.5 font-mono text-[0.625rem] font-semibold leading-none text-brand-fg"
                          aria-label={`${entry.badge} unread`}
                        >
                          {entry.badge > 99 ? '99+' : entry.badge}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
