import { formatDate } from './dates';

/**
 * How a notification is worded.
 *
 * Lifted out of the notifications page so the mobile app renders the same
 * sentences. This is the most-repeated user-facing copy in the product, and
 * two apps describing the same event differently is the kind of small
 * wrongness nobody reports and everybody notices. Pure: it takes a row and
 * returns a string, and knows nothing about how either app draws it.
 */

export interface Notification {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  /** Where the server says this goes. Null on rows written before it said. */
  targetModule: string | null;
  targetAction: string | null;
  targetId: string | null;
  isRead: boolean;
  createdAt: string;
}

/** What the reader is being asked to do, when it is more than "look". */
export const ACTION_LABEL: Record<string, string> = {
  respond: 'Respond',
  pay: 'Pay',
  review: 'Review',
  reply: 'Reply',
};

export const TYPE_LABEL: Record<string, string> = {
  match_interest: 'Interest shown',
  match_interest_for_client: 'Interest to review',
  match_declined_by_agency: 'Declined by their agency',
  match_accepted: 'Interest accepted',
  new_message: 'New message',
  match_conversation: 'Your clients are talking',
  task_reminder: 'Reminder',
  booking_update: 'Booking update',

  booking_request: 'New request',
  booking_request_accepted: 'Request accepted',
  booking_quotation: 'Quotation',
  booking_confirmed: 'Job accepted',
  booking_payment: 'Payment held',
  booking_started: 'Work started',
  booking_completed: 'Work delivered',
  booking_cancelled: 'Booking cancelled',
  booking_addon: 'Add-on requested',

  verification_assigned: 'Visit assigned to you',
  verification_submitted: 'Findings submitted',
  verification_requested: 'New application',
  verification_decided: 'Verification decided',
  dispute_update: 'Dispute',

  event_changed_by_couple: 'Client updated an event',
  event_changed_by_planner: 'Planner updated an event',

  operational_alert: 'Operational alert',
};

/** Readable names for the capacity metrics an operational alert can be about. */
const METRIC_LABEL: Record<string, string> = {
  accounts: 'Registered accounts',
  dailyActiveUsers: 'Daily active users',
  requestsPerDay: 'Requests per day',
  concurrentUsers: 'Concurrent users',
  databaseGigabytes: 'Database size',
  p95LatencyMs: 'P95 latency',
  errorRatePercent: 'Error rate',
  cpuPercent: 'CPU utilisation',
  memoryPercent: 'Memory utilisation',
  railwayMonthlyInr: 'Hosting cost',
};

/** Where an operational alert opens: the administrator Infrastructure page. */
export function operationalAlertLink(alertId: string | null): string {
  return alertId
    ? `/admin/infrastructure?alert=${encodeURIComponent(alertId)}`
    : '/admin/infrastructure';
}

/** A sentence a person can read, built from whatever the payload carries. */
export function describe(n: Notification): string {
  const p = n.payload ?? {};
  const str = (key: string) => (typeof p[key] === 'string' ? String(p[key]) : null);
  const status = str('status')?.replace(/_/g, ' ') ?? '';
  const client = str('clientName') ?? 'A client';
  const service = str('service');
  const when = p.eventDate ? formatDate(String(p.eventDate)) : null;
  const money = str('amount') ? `${str('currency') ?? 'INR'} ${str('amount')}` : null;

  // What the reader needs to decide whether to open it: who, what, and when.
  const job = [service, when].filter(Boolean).join(' · ');

  switch (n.type) {
    case 'booking_request':
      return `${client} has asked about ${job || 'your services'}.`;
    case 'booking_request_accepted':
      return `Your planner has accepted your request for ${job || 'your wedding'}. Their quotation comes next.`;
    case 'booking_quotation':
      return money ? `${money}: ${job || 'the job'}.` : `A quotation on ${job || 'the job'}.`;
    case 'booking_addon': {
      const title = str('title');
      return title
        ? `${client} has asked for ${title} on ${job || 'the job'}.`
        : `${client} has asked for something extra on ${job || 'the job'}.`;
    }
    case 'booking_confirmed':
      return `The provider has accepted ${job || 'the job'}. The date is held.`;
    case 'booking_payment':
      return money ? `${money} is in escrow for ${job || 'the job'}.` : 'A payment is in escrow.';
    case 'booking_started':
      return `Work has started on ${job || 'the job'}.`;
    case 'booking_completed':
      return `${job || 'The job'} is delivered. The balance is now payable.`;
    case 'booking_cancelled':
      return `${job || 'A booking'} was cancelled.`;
    case 'verification_assigned':
      return `A ${str('applicantType') ?? 'business'} verification is on your queue.`;
    case 'verification_requested':
      return `${str('subjectName') ?? `A ${str('applicantType') ?? 'business'}`} has applied for approval and is waiting to be allocated.`;
    case 'verification_submitted':
      return `An officer recommends ${str('recommendation') ?? 'a decision'}${
        typeof p.issues === 'number' && p.issues > 0 ? `, with ${p.issues} issue(s)` : ''
      }.`;
    case 'verification_decided': {
      if (!status) return 'Your verification was decided.';
      // The administrator's reason, when the outcome was not an approval. The
      // SLA sweep sets a machine sentinel rather than prose, so that one is left
      // to the sentence alone (EZ1-I110).
      const reason = str('reason');
      const base = `Your verification was ${status}.`;
      return reason && reason !== 'sla_breach' && status !== 'approved'
        ? `${base} Reason: ${reason}`
        : base;
    }
    case 'booking_update':
      return status ? `A booking moved to ${status}.` : 'One of your bookings changed.';
    case 'new_message':
      return str('preview') ?? 'Someone replied to you.';
    case 'match_interest': {
      const who = str('counterpartName');
      const from = str('counterpartCity') ? ` from ${str('counterpartCity')}` : '';
      // An agency or family running somebody's profile is told whose it is:
      // "your profile" read as the agency's own and named none of its clients.
      const forWhom = p.forManagedProfile === true ? str('subjectName') : null;
      if (forWhom) return `${who ?? 'A family'}${from} is interested in ${forWhom}.`;
      return who
        ? `${who}${from} would like to take your profile forward.`
        : 'Someone would like to take your profile forward.';
    }
    case 'match_interest_for_client': {
      // For the agency: which family is interested, and in which of its
      // clients. The client has not been told — it waits on the agency.
      const who = str('counterpartName') ?? 'A family';
      const from = str('counterpartCity') ? ` from ${str('counterpartCity')}` : '';
      return `${who}${from} is interested in ${str('subjectName') ?? 'one of your clients'} — review it.`;
    }
    case 'match_declined_by_agency': {
      // For the sender. The person it was for never saw it; their agency answered.
      const who = str('counterpartName');
      const forWhom = p.forManagedProfile === true ? str('subjectName') : null;
      const base = who
        ? `${who}'s agency has declined this proposal`
        : "The family's agency has declined this proposal";
      return forWhom ? `${base} for ${forWhom}.` : `${base}.`;
    }
    case 'match_accepted': {
      // Naming them is the whole point: somebody who has sent five interests
      // cannot act on "your interest was accepted". Naming the reader's own
      // profile too (EZ1-I80) tells an agent which of their clients it is for.
      const who = str('counterpartName');
      const forWhom = str('subjectName');
      if (!who) return 'Your interest was accepted.';
      return forWhom
        ? `${who} accepted your interest in ${forWhom}.`
        : `${who} accepted your interest.`;
    }
    case 'match_conversation': {
      const who = str('coupleNames') ?? 'Two of your clients';
      return str('kind') === 'call'
        ? `${who} have started a call.`
        : `${who} have started a conversation.`;
    }
    case 'task_reminder':
      return str('title') ?? 'A planning task is due.';
    case 'event_changed_by_couple': {
      const name = str('eventName') ?? 'an event';
      const changed = str('changed');
      return changed ? `The couple updated ${changed} on ${name}.` : `The couple changed ${name}.`;
    }
    case 'event_changed_by_planner': {
      const name = str('eventName') ?? 'an event';
      const changed = str('changed');
      return changed
        ? `Your planner updated ${changed} on ${name}.`
        : `Your planner changed ${name}.`;
    }
    case 'operational_alert': {
      const severity = str('severity') === 'critical' ? 'critical' : 'warning';
      const event = str('event');
      const lead =
        event === 'promoted'
          ? 'Escalated to critical'
          : event === 'reminder'
            ? `Still open (${severity})`
            : severity === 'critical'
              ? 'Critical'
              : 'Warning';
      const metricKey = str('metric') ?? '';
      const metric = METRIC_LABEL[metricKey] ?? (metricKey || 'A capacity metric');
      const unit = str('unit');
      const amount = (key: string) =>
        [typeof p[key] === 'number' || typeof p[key] === 'string' ? String(p[key]) : '?', unit]
          .filter(Boolean)
          .join(' ');
      return `${lead}: ${metric} is ${amount('observedValue')} (threshold ${amount('thresholdValue')}).`;
    }
    default:
      return '';
  }
}

/**
 * How often the badge and the feed ask.
 *
 * Twenty seconds, not the sixty this started at. The original argument —
 * nobody is worse off for a count being a minute stale — holds for a badge
 * nobody is watching and breaks the moment somebody is waiting on an answer: a
 * vendor who has just submitted for verification, a couple who have just sent
 * an interest. A minute of nothing reads as nothing happened.
 *
 * Lives here rather than in App so the feed can share it without importing the
 * router, which imports the feed.
 */
export const UNREAD_POLL_MS = 20_000;
