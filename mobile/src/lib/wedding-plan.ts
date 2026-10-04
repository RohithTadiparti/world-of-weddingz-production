import { api } from '@/lib/api';

/** Shape of `GET /planner/dashboard` — the couple's wedding on one screen. */
export interface WeddingDashboard {
  countdown: {
    weddingDate: string | null;
    daysAway: number | null;
    passed: boolean;
    source: string | null;
  };
  budget: {
    /** The couple's overall wedding budget (PUT /planner/budget); null until set. */
    total: string | null;
    budgeted: string;
    committed: string;
    remaining: string;
    overBudget: boolean;
    categories: { category: string; budgeted: string; committed: string; remaining: string }[];
  };
  guests: {
    onList: number;
    invited: number;
    attending: number;
    declined: number;
    maybe: number;
    awaiting: number;
    expectedHeadcount: number;
  };
  journey: {
    total: number;
    done: number;
    percent: number;
    overdue: number;
    nextUp: string | null;
    stages: { stage: string; total: number; done: number; nextDue: string | null }[];
  };
  upcoming: {
    id: string;
    name: string;
    eventDate: string;
    venue: string | null;
    daysAway: number;
    expectedGuests: number | null;
  }[];
}

export interface WeddingPlanRow {
  id: string;
  weddingDate: string | null;
  plannerUserId: string | null;
  plannerBookingId: string | null;
  budget: string | null;
}

export function fetchWeddingDashboard() {
  return api.get('/planner/dashboard').then((r) => r.data as WeddingDashboard);
}

export function fetchPlans() {
  return api.get('/planner/plans').then((r) => r.data as WeddingPlanRow[]);
}

/** Human label for a budget/vendor category slug. */
export function categoryLabel(raw: string): string {
  const map: Record<string, string> = {
    venue: 'Venue',
    photography: 'Photography',
    decor: 'Decor',
    decoration: 'Decor',
    catering: 'Catering',
    makeup: 'Makeup',
    planner: 'Planner',
    other: 'Others',
    mehendi: 'Mehendi',
    music: 'Music',
    entertainment: 'Entertainment',
    invitation: 'Invitations',
    invitations: 'Invitations',
    transport: 'Transportation',
    transportation: 'Transportation',
    priest: 'Priest & Rituals',
    accommodation: 'Accommodation',
  };
  const key = raw.toLowerCase().replace(/\s+/g, '_');
  return map[key] ?? raw.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
