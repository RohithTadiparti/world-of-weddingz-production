/**
 * The raiser's side of a support case, shared by the web Support page and the
 * mobile app (dependency-free, so it can cross into mobile/src/shared).
 *
 * The status words are the ones the vendor reads. They follow the server's
 * case lifecycle: a business change request is resolved the moment edit access
 * is granted and reads "Cancelled" when an administrator declines it (row 26),
 * so nothing finished ever reads "Waiting on you".
 */

export const SUPPORT_STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  triaged: 'Open',
  allocated: 'With an investigator',
  in_progress: 'Being looked into',
  waiting_for_information: 'Waiting on you',
  resolution_submitted: 'Resolution in review',
  admin_review: 'Resolution in review',
  reassigned: 'Being looked at again',
  resolved: 'Resolved',
  rejected: 'Closed, no action',
  escalated: 'Escalated for a visit',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

/** A case in one of these has an answer, one way or another. */
export const FINISHED_CASE_STATUSES = ['resolved', 'rejected', 'closed', 'cancelled'] as const;

export type SupportBucket = 'open' | 'pending' | 'resolved';

export function supportBucket(status: string): SupportBucket {
  if ((FINISHED_CASE_STATUSES as readonly string[]).includes(status)) return 'resolved';
  if (status === 'open' || status === 'triaged') return 'open';
  return 'pending';
}

export function supportStatusLabel(status: string): string {
  return SUPPORT_STATUS_LABEL[status] ?? status.replace(/_/g, ' ');
}

/** The raiser can still add to the conversation. */
export function canReply(status: string): boolean {
  return supportBucket(status) !== 'resolved';
}

/** The raiser can close it: accept an answer, or withdraw it. */
export function canClose(status: string): boolean {
  return status !== 'closed' && status !== 'cancelled' && status !== 'rejected';
}

/** Support opened on a new "My business listing" case about one business (row 27). */
export function businessSupportLink(businessId: string): string {
  return `/support?new=1&subject=vendor&business=${encodeURIComponent(businessId)}`;
}

/** What the Raise form starts with, from a link like the one above. */
export function supportPrefill(params: { get(key: string): string | null }): {
  subjectType: string;
  subjectId: string;
} {
  const subject = params.get('subject');
  const allowed = ['booking', 'payment', 'vendor', 'availability', 'profile', 'match', 'account', 'other'];
  return {
    subjectType: subject && allowed.includes(subject) ? subject : 'other',
    subjectId: params.get('business') ?? params.get('booking') ?? '',
  };
}

export interface CaseHistoryEntry {
  at: string;
  byUserId: string;
  status: string;
  note?: string;
  /** Older rows used `remarks`. */
  remarks?: string;
  kind?: 'reply';
}

export interface TimelineEntry {
  at: string;
  label: string;
  note: string | null;
  mine: boolean;
}

/**
 * The case's story for the person who raised it: each step once, their own
 * replies marked as theirs. The server has already removed the desk's internal
 * notes; consecutive repeats are collapsed (EZ1-I193).
 */
export function raiserTimeline(history: CaseHistoryEntry[] | undefined, myUserId: string | null): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  let previous: TimelineEntry | null = null;
  for (const h of history ?? []) {
    const mine = Boolean(myUserId) && h.byUserId === myUserId;
    const entry: TimelineEntry = {
      at: h.at,
      label: h.kind === 'reply' ? (mine ? 'You replied' : 'Reply') : supportStatusLabel(h.status),
      note: h.note ?? h.remarks ?? null,
      mine,
    };
    if (previous && previous.label === entry.label && previous.note === entry.note) continue;
    out.push(entry);
    previous = entry;
  }
  return out;
}
