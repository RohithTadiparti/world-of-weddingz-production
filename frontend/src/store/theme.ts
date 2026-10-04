import { create } from 'zustand';

export type ThemeChoice = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'wow-theme';

/**
 * Off while the product runs on the matrimony home template alone: that
 * template is light only, so every page renders its ivory, maroon and gold
 * whatever the operating system prefers. The dark tokens in index.css and the
 * choice below are kept, so turning this back on is the whole of the work.
 */
export const DARK_MODE_ENABLED = false;

/**
 * Resolves `system` against the operating system, and writes the answer onto
 * `<html>` as a class.
 *
 * Tailwind is configured `darkMode: 'class'` rather than `'media'` on purpose.
 * A media-only setup cannot honour an explicit choice — somebody on a dark
 * laptop who wants this app light has no way to say so, and a toggle that
 * cannot override the OS is a toggle that lies.
 */
function apply(choice: ThemeChoice): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = DARK_MODE_ENABLED && (choice === 'dark' || (choice === 'system' && prefersDark));
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

function stored(): ThemeChoice {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === 'light' || saved === 'dark' ? saved : 'system';
}

interface ThemeState {
  choice: ThemeChoice;
  set: (choice: ThemeChoice) => void;
}

export const useTheme = create<ThemeState>((set) => ({
  choice: stored(),
  set: (choice) => {
    localStorage.setItem(STORAGE_KEY, choice);
    apply(choice);
    set({ choice });
  },
}));

/**
 * Called once at start-up, before React renders.
 *
 * Applying the class here rather than in an effect is what prevents the white
 * flash a dark-mode user gets when the theme is decided after first paint.
 * Also keeps `system` genuinely live: if the OS flips at dusk while the tab is
 * open, the page follows.
 */
export function initTheme(): void {
  apply(stored());
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      if (useTheme.getState().choice === 'system') apply('system');
    });
}
