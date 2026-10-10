import type { Href } from 'expo-router';

import type { Notification } from '@/shared/notification-copy';

/**
 * Where a notification opens.
 *
 * The decision is the server's: every notification carries `targetModule`,
 * `targetAction` and `targetId`, written from one total map over the
 * notification types (backend notification-targets.ts). This turns that answer
 * into a route in *this* app, which is the only part a client is entitled to
 * decide — the web app's `linkFor` does exactly the same job against its own
 * routes.
 *
 * Null means this app has no screen for it. That is not a failure to be papered
 * over: sending somebody to the wrong screen, or to a blank one, is worse than
 * a row that says what happened and does not pretend to lead anywhere
 * (EZ1-I254). The two that answer null today — a planner task and a client's
 * workspace — are web-only screens.
 */
type RouteOptions = { canVerify?: boolean; canReadIncoming?: boolean };

/**
 * A seller reads the booking on their queue; a customer on Plan → Bookings,
 * which the seller queue would answer 403.
 */
function bookingRoute(bookingId: string | null, opts: RouteOptions): Href | null {
  if (!opts.canReadIncoming) {
    return bookingId
      ? { pathname: '/plan/bookings', params: { highlight: bookingId } }
      : '/plan/bookings';
  }
  return bookingId ? { pathname: '/bookings', params: { booking: bookingId } } : '/bookings';
}

export function routeFor(n: Notification, opts: RouteOptions = {}): Href | null {
  const payload = (n.payload ?? {}) as Record<string, unknown>;
  const str = (key: string) => (typeof payload[key] === 'string' ? String(payload[key]) : null);
  const bookingId = n.targetId ?? str('bookingId');

  if (n.targetModule) {
    switch (n.targetModule) {
      // A quotation, an escrow hold, an add-on and a cancellation are all
      // facts about one booking, and the booking card is where all of them are
      // read. It opens with its detail already expanded.
      case 'bookings':
      case 'quotations':
      case 'disputes':
        return bookingRoute(bookingId, opts);
      case 'support': {
        // The case itself, for whoever reads it: the case screen loads by id
        // and shows each reader their own step (row 21b). Without an id, staff
        // land on the Cases tab and the raiser on Support (EZ1-I49).
        const caseId = n.targetId ?? str('caseId');
        if (caseId) return { pathname: '/case/[id]', params: { id: caseId } };
        return opts.canVerify ? '/cases' : '/support';
      }
      case 'verification': {
        // A decision or a tracking update is for the applicant, who reads it
        // on their own listing. Staff notifications open the visit itself.
        const forApplicant = n.type === 'verification_decided' || n.type === 'verification_progress';
        if (forApplicant && !opts.canVerify) return '/business';
        const visit = forApplicant ? str('requestId') : (n.targetId ?? str('requestId'));
        if (opts.canVerify && visit) return { pathname: '/visit/[id]', params: { id: visit } };
        return '/verification';
      }
      case 'matches':
        // An agency told about interest in a client opens that client's
        // Interests board, already acting for them.
        if (n.type === 'match_interest_for_client') {
          return n.targetId
            ? { pathname: '/interests', params: { client: n.targetId } }
            : '/interests';
        }
        // Declined by the other family's agency: it sits under Declined.
        if (n.type === 'match_declined_by_agency') return '/interests';
        // An interest to answer is answered on the board; an accepted one
        // opens the other profile, where the conversation starts.
        if (n.type === 'match_interest') return '/interests';
        if (n.type === 'match_accepted' && n.targetId) {
          return { pathname: '/match/[id]', params: { id: n.targetId } };
        }
        return '/matches';
      // A new message targets the person who sent it, which is the thread's own
      // address in this app.
      case 'chat':
        return n.targetId ? { pathname: '/chat/[id]', params: { id: n.targetId } } : '/chat';
      case 'events':
        return '/events';
      case 'planner':
      case 'clients':
        return null;
    }
  }

  /*
   * Rows written before the server carried the columns. Kept rather than
   * migrated to a guess: this is the derivation those rows were displayed with.
   */
  if (n.type.startsWith('booking_')) return bookingRoute(bookingId, opts);
  if (n.type.startsWith('verification_')) return '/verification';
  if (n.type === 'dispute_update' || n.type === 'business_change_update') {
    const caseId = str('caseId');
    if (caseId) return { pathname: '/case/[id]', params: { id: caseId } };
    return opts.canVerify ? '/cases' : '/support';
  }
  if (n.type.startsWith('match_')) return '/matches';

  return null;
}
