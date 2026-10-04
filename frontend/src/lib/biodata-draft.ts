import { migrateHeightDraft } from './height';
export type Draft = Record<string, unknown>;

/*
 * Unsaved bio-data must survive leaving the page and coming back (EZ1-I73).
 *
 * Every section form seeds itself from the server copy on mount, so navigating
 * to Security and back re-seeded from the server and wiped anything typed but
 * not yet saved. These back the working values with sessionStorage, keyed per
 * profile and section, so a return restores the draft rather than the last save.
 * All three swallow their own errors: a private window or a storage quota must
 * degrade to the old behaviour, never throw.
 */
export function loadDraft(storageKey?: string): Draft | null {
  if (!storageKey) return null;
  try {
    const raw = sessionStorage.getItem(storageKey);
    return raw ? migrateHeightDraft(JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}

export function saveDraft(storageKey: string | undefined, value: Draft): void {
  if (!storageKey) return;
  try {
    sessionStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    /* private window / quota — the form still works, it just will not restore. */
  }
}

export function clearDraft(storageKey?: string): void {
  if (!storageKey) return;
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    /* ignore */
  }
}

/**
 * Sends a section, and drops its local draft only once the server has taken it.
 *
 * Every form used to clear its draft *before* sending. When the server refused
 * the save -- the personal section is refused until three photographs are on
 * the profile, and it is the section the page opens on -- the draft was already
 * gone, so opening Photographs (which closes and unmounts the form) and coming
 * back showed an empty personal section: everything typed was lost. The draft
 * is the only copy of those answers until the server accepts them.
 */
export async function submitDraft(
  sent: Promise<boolean>,
  clear: () => void,
): Promise<boolean> {
  const ok = await sent;
  if (ok) clear();
  return ok;
}

/*
 * Whether anything in a form came from the person rather than from the seed.
 *
 * Only a touched draft is written to local storage. Without this the empty
 * first render -- before the server's answer has arrived -- was itself saved
 * as a "draft", and the seeding effect then preferred that empty draft over
 * the real values when they landed. The result was a biodata that read as
 * blank however many times it had been filled in: a family opening their
 * daughter's personal details saw no date of birth even though the profile
 * had carried one since it was created (EZ1-I236). Every section form goes
 * through this one guard, so none of them can shadow what was loaded.
 *
 * A draft already in storage on arrival is a genuine unsaved edit from a
 * previous visit, so it still wins -- which is the whole point of EZ1-I73.
 */
export interface DraftGuard {
  /** The form has just (re)seeded; `fromStoredDraft` when it took a stored draft. */
  seeded(fromStoredDraft: boolean): void;
  /** Wraps a state setter so calling it counts as the person editing. */
  edit<A extends unknown[]>(setter: (...args: A) => void): (...args: A) => void;
  /** Writes the draft, but only once the person has edited something. */
  persist(storageKey: string | undefined, value: Draft): void;
  /** Drops the draft once the server has it; the next edit starts a new one. */
  clear(storageKey?: string): void;
}

export function createDraftGuard(): DraftGuard {
  let touched = false;
  return {
    seeded(fromStoredDraft) {
      touched = fromStoredDraft;
    },
    edit(setter) {
      return (...args) => {
        touched = true;
        setter(...args);
      };
    },
    persist(storageKey, value) {
      if (touched) saveDraft(storageKey, value);
    },
    clear(storageKey) {
      touched = false;
      clearDraft(storageKey);
    },
  };
}
