import { NotificationType } from '../../common/enums';

/**
 * Where a notification points, and what the reader is being asked to do there.
 *
 * Every client that renders a notification has to answer "and where does Open
 * go?" — the web app, and shortly a push payload that has no app to ask. That
 * answer was written out in the web client as a chain of `type.startsWith(...)`
 * tests, which is a copy of a rule the server owns. Pushed to a device, the
 * rule would have to be copied again.
 *
 * So it lives here, as a total map. `Record<NotificationType, …>` is the point:
 * a new notification type does not compile until somebody has decided where it
 * takes the reader, which is a decision that should be made when the
 * notification is invented rather than discovered when it is ignored.
 *
 * `action` is what the reader does, not what happened — `respond` on a
 * quotation, `review` on submitted findings — because that is what a client
 * needs to choose between "Open" and "Reply".
 */
export type TargetModule =
  | 'bookings'
  | 'quotations'
  | 'verification'
  | 'disputes'
  | 'chat'
  | 'planner'
  | 'clients'
  | 'events'
  | 'support'
  | 'matches'
  | 'infrastructure';

export type TargetAction = 'view' | 'respond' | 'pay' | 'review' | 'reply';

export interface NotificationTarget {
  module: TargetModule;
  action: TargetAction;
  /**
   * The payload key holding the id the target is about. A client that has this
   * does not have to know which notifications carry a booking and which carry
   * a profile.
   */
  idKey: string | null;
}

export const NOTIFICATION_TARGET: Record<NotificationType, NotificationTarget> = {
  [NotificationType.MATCH_INTEREST]: {
    module: 'matches',
    action: 'respond',
    idKey: 'counterpartProfileId',
  },
  // The agency's own client is what the interest is about, so that is the id
  // it carries; the interest itself is reviewed on that client's Interests
  // board, where it waits to be forwarded or declined.
  [NotificationType.MATCH_INTEREST_FOR_CLIENT]: {
    module: 'matches',
    action: 'review',
    idKey: 'subjectProfileId',
  },
  [NotificationType.MATCH_DECLINED_BY_AGENCY]: {
    module: 'matches',
    action: 'view',
    idKey: 'counterpartProfileId',
  },
  [NotificationType.MATCH_ACCEPTED]: {
    module: 'matches',
    action: 'view',
    idKey: 'counterpartProfileId',
  },
  // Opens the client's own record, not the conversation: the agent is being
  // told this happened, and reading the thread is not theirs to do.
  [NotificationType.MATCH_CONVERSATION]: {
    module: 'clients',
    action: 'view',
    idKey: 'counterpartProfileId',
  },
  [NotificationType.NEW_MESSAGE]: { module: 'chat', action: 'reply', idKey: 'fromUserId' },
  [NotificationType.TASK_REMINDER]: { module: 'planner', action: 'view', idKey: 'taskId' },
  [NotificationType.BOOKING_UPDATE]: { module: 'bookings', action: 'view', idKey: 'bookingId' },

  [NotificationType.BOOKING_REQUEST]: { module: 'bookings', action: 'respond', idKey: 'bookingId' },
  [NotificationType.BOOKING_QUOTATION]: {
    module: 'quotations',
    action: 'respond',
    idKey: 'bookingId',
  },
  [NotificationType.BOOKING_REQUEST_ACCEPTED]: { module: 'bookings', action: 'view', idKey: 'bookingId' },
  [NotificationType.BOOKING_CONFIRMED]: { module: 'bookings', action: 'pay', idKey: 'bookingId' },
  [NotificationType.BOOKING_PAYMENT]: { module: 'bookings', action: 'view', idKey: 'bookingId' },
  [NotificationType.BOOKING_STARTED]: { module: 'bookings', action: 'view', idKey: 'bookingId' },
  // The balance falls due here, so the reader is being asked for money rather
  // than merely told the work is done.
  [NotificationType.BOOKING_COMPLETED]: { module: 'bookings', action: 'pay', idKey: 'bookingId' },
  [NotificationType.BOOKING_CANCELLED]: { module: 'bookings', action: 'view', idKey: 'bookingId' },
  // The add-on is read on the booking it hangs off, and the vendor is being
  // asked for a price on it rather than merely told about it.
  [NotificationType.BOOKING_ADDON]: { module: 'bookings', action: 'respond', idKey: 'bookingId' },

  [NotificationType.VERIFICATION_ASSIGNED]: {
    module: 'verification',
    action: 'view',
    idKey: 'requestId',
  },
  [NotificationType.VERIFICATION_DECIDED]: {
    module: 'verification',
    action: 'view',
    idKey: 'businessId',
  },
  [NotificationType.VERIFICATION_SUBMITTED]: {
    module: 'verification',
    action: 'review',
    idKey: 'requestId',
  },
  [NotificationType.VERIFICATION_REQUESTED]: {
    module: 'verification',
    // Allocating is the next move on a new application; reviewing is what
    // happens once somebody has been out to look.
    action: 'respond',
    idKey: 'requestId',
  },
  // A support/dispute case. The raiser lands on Support and staff on the
  // verification Cases tab; linkFor picks the right one by role (EZ1-I49).
  [NotificationType.DISPUTE_UPDATE]: { module: 'support', action: 'view', idKey: 'caseId' },

  // Both open the shared wedding event they are about (EZ1-I84). The couple
  // land on their Events page; the planner's Events page opens the same day
  // through the client picker.
  [NotificationType.EVENT_CHANGED_BY_COUPLE]: { module: 'events', action: 'view', idKey: 'eventId' },
  [NotificationType.EVENT_CHANGED_BY_PLANNER]: { module: 'events', action: 'view', idKey: 'eventId' },

  // Opens the administrator Infrastructure page on the alert itself
  // (/admin/infrastructure?alert=:alertId), where it is reviewed and
  // acknowledged.
  [NotificationType.OPERATIONAL_ALERT]: {
    module: 'infrastructure',
    action: 'review',
    idKey: 'alertId',
  },

  // The applicant's own listing is where they follow their verification, so
  // the business is the target (the same one a decision carries).
  [NotificationType.VERIFICATION_PROGRESS]: {
    module: 'verification',
    action: 'view',
    idKey: 'businessId',
  },
  // Opens the change request itself on the vendor's Support page.
  [NotificationType.BUSINESS_CHANGE_UPDATE]: { module: 'support', action: 'view', idKey: 'caseId' },
};
