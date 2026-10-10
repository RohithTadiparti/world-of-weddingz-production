import { operationalAlertLink, type Notification } from './notification-copy';

/**
 * Where a notification opens on the web, down to the item it is about.
 *
 * The server stamps every notification with a target module and the id it is
 * about (backend notification-targets.ts, a total map over the types). This
 * turns that into a route in this app. It is shared by the header bell and the
 * full Notifications page, which used to disagree: the bell sent every row to
 * the generic Notifications page (row 21b), and the page sent a support or
 * verification update to a list rather than to the case or visit itself.
 *
 * Pure, so it is unit-tested without a browser.
 */
export interface LinkContext {
  /** Hands out verification and support work (administrators). */
  canAllocate?: boolean;
  /** Does verification visits and works cases (officers). */
  canFieldwork?: boolean;
}

const q = (key: string, value: string) => `${key}=${encodeURIComponent(value)}`;

export function notificationLink(n: Notification, ctx: LinkContext = {}): string | null {
  const { canAllocate = false, canFieldwork = false } = ctx;
  const canVerify = canAllocate || canFieldwork;
  const id = n.targetId;
  const payload = n.payload ?? {};
  const str = (key: string) => (typeof payload[key] === 'string' ? String(payload[key]) : null);

  const supportLink = (caseId: string | null) => {
    // The allocator reviews cases in the admin inbox; an officer works theirs
    // in their queue; the raiser reads it on their own Support page. Each opens
    // on the case itself.
    if (canAllocate) return caseId ? `/admin/support?tab=cases&${q('case', caseId)}` : '/admin/support?tab=cases';
    if (canFieldwork) return caseId ? `/cases?${q('case', caseId)}` : '/cases';
    return caseId ? `/support?${q('case', caseId)}` : '/support';
  };

  const verificationLink = () => {
    // A decision or a tracking update is for the applicant, read on their own
    // listing; staff notifications open the visit in the queue.
    const forApplicant = n.type === 'verification_decided' || n.type === 'verification_progress';
    if (forApplicant && !canVerify) {
      const business = id ?? str('businessId');
      return business ? `/console?${q('business', business)}` : '/console';
    }
    const request = forApplicant ? str('requestId') : (id ?? str('requestId'));
    return request ? `/verification?${q('request', request)}` : '/verification';
  };

  if (n.targetModule) {
    switch (n.targetModule) {
      case 'bookings':
      case 'quotations':
      case 'disputes':
        return id ? `/bookings?${q('highlight', id)}` : '/bookings';
      case 'support':
        return supportLink(id ?? str('caseId'));
      case 'verification':
        return verificationLink();
      case 'chat':
        return '/chat';
      case 'infrastructure':
        return operationalAlertLink(id);
      case 'planner':
        return '/planner';
      case 'clients':
        return id ? `/matches?${q('profile', id)}` : '/matches';
      case 'events': {
        // The couple open their own Events page; the planner opens that
        // client's event workspace (EZ1-I84).
        const host = str('hostUserId');
        if (n.type === 'event_changed_by_couple' && host && id) {
          return `/my-clients/${host}/events/${id}`;
        }
        return '/events';
      }
      case 'matches':
        // An interest is answered on Interests, not on Matches (EZ1-I107).
        if (
          n.type === 'match_interest' ||
          n.type === 'match_interest_for_client' ||
          n.type === 'match_declined_by_agency'
        ) {
          return '/interests';
        }
        return id ? `/matches?${q('profile', id)}` : '/matches';
    }
  }

  // Rows written before the server stamped a target.
  const bookingId = str('bookingId');
  if (n.type.startsWith('booking_')) return bookingId ? `/bookings?${q('highlight', bookingId)}` : '/bookings';
  if (n.type.startsWith('verification_')) return verificationLink();
  if (n.type === 'dispute_update' || n.type === 'business_change_update') return supportLink(str('caseId'));
  if (n.type === 'new_message') return '/chat';
  if (n.type === 'task_reminder') return '/planner';
  if (n.type === 'match_interest' || n.type === 'match_interest_for_client') return '/interests';
  if (n.type.startsWith('match_')) {
    const profileId = str('counterpartProfileId');
    return profileId ? `/matches?${q('profile', profileId)}` : '/matches';
  }
  return null;
}
