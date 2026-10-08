import { FindOptionsWhere, IsNull, Not } from 'typeorm';
import { AgentProfile } from './entities/agent-profile.entity';

/**
 * What "pending" and "rejected" mean for an agency, in one place (ISS-10).
 *
 * An agency is pending while it waits on an administrator: not approved and
 * carrying no rejection. A rejection — from the admin reject route, or a
 * verification decision that blocked it — writes `rejectionReason`, and from
 * then on the agency is waiting on itself, not on anyone here: it has been
 * told why and must resubmit, which clears the reason and returns it to
 * pending. Listing those rows as "awaiting approval" put decided agencies back
 * in front of administrators and inflated the approvals badge.
 *
 * The approvals list, the pending-counts badge and the rejected list all read
 * these, so they cannot drift apart.
 */
export const PENDING_AGENCY: FindOptionsWhere<AgentProfile> = {
  isApproved: false,
  rejectionReason: IsNull(),
};

export const REJECTED_AGENCY: FindOptionsWhere<AgentProfile> = {
  isApproved: false,
  rejectionReason: Not(IsNull()),
};
