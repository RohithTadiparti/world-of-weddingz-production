import { create } from 'zustand';

/**
 * What a couple has picked on a planner's profile, on its way to the request.
 *
 * The profile is where the choosing happens (a day on the calendar, the
 * services ticked in the grid) and the request screen is where it is sent, a
 * separate route. Route params would carry it, but they are strings, they go
 * stale the moment the couple steps back to change a tick, and a list of
 * sixteen service keys in an address is not something anybody wants to read in
 * a crash report. A small store keeps one live selection both screens edit.
 *
 * Held for one planner at a time: opening a different planner's profile
 * starts the selection over (`beginFor`), so a date picked for one is never
 * sent to another. Not persisted; a selection is a moment, not a preference.
 */
interface PlannerRequestState {
  plannerId: string | null;
  /** `YYYY-MM-DD`, or empty when no day has been picked. */
  date: string;
  services: string[];
  beginFor: (plannerId: string) => void;
  setDate: (date: string) => void;
  toggleService: (key: string) => void;
  setServices: (keys: string[]) => void;
  reset: () => void;
}

export const usePlannerRequest = create<PlannerRequestState>((set, get) => ({
  plannerId: null,
  date: '',
  services: [],
  beginFor: (plannerId) => {
    if (get().plannerId === plannerId) return;
    set({ plannerId, date: '', services: [] });
  },
  setDate: (date) => set({ date }),
  toggleService: (key) =>
    set((s) => ({
      services: s.services.includes(key)
        ? s.services.filter((k) => k !== key)
        : [...s.services, key],
    })),
  setServices: (services) => set({ services }),
  reset: () => set({ plannerId: null, date: '', services: [] }),
}));
