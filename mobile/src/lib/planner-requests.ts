import type { Tone } from '@/components/chrome';

import type { PlannerRequestStatus } from '../../../frontend/src/lib/planner-requests';

/**
 * A couple's request to a wedding planner, and the words the planner reads it
 * in — read from the web client rather than copied (see src/shared).
 *
 * The status is worked out on the server from the booking and its quotations;
 * the labels, tabs, service lists and the "what can I do next" rule are the web
 * module's own, so a planner who triages on the site and then on the phone
 * reads the same request the same way. The web file is dependency-free, which
 * is what lets it cross (metro.config.js). Only the pill colours are this
 * app's, because the web ones are CSS class names.
 */
export {
  STATUS_LABEL,
  STATUS_TABS,
  WEDDING_TYPES,
  budgetRange,
  guestRange,
  receivedAgo,
  requestActions,
  serviceLabel,
} from '../../../frontend/src/lib/planner-requests';
export type {
  DateAvailability,
  PlannerRequestCard,
  PlannerRequestDetail,
  PlannerRequestStatus,
} from '../../../frontend/src/lib/planner-requests';

/**
 * The web's pill families, on the Badge tones this app has. There is no info
 * family here, so a quotation waiting on the couple reads as neutral: it is
 * the one state where the planner has nothing to do.
 */
export const STATUS_TONE: Record<PlannerRequestStatus, Tone> = {
  new: 'brand',
  accepted: 'positive',
  quotation_sent: 'neutral',
  requote_requested: 'caution',
  declined: 'critical',
  closed: 'neutral',
};

/** Up to two initials for a couple with no photo: "Asha & Ravi" → "AR". */
export function initials(name: string | null): string {
  return (
    (name ?? '')
      .split(/[\s&]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?'
  );
}
