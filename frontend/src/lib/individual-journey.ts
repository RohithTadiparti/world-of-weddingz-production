/**
 * Presentation-only language for the individual journey.
 *
 * These helpers deliberately describe the state that the server and host page
 * have already established. They do not decide eligibility or grant access.
 */
export type RelationshipState =
  | 'none'
  | 'interest_sent'
  | 'interest_received'
  | 'accepted'
  | 'declined_by_you'
  | 'declined_by_them'
  | 'fixed';

export type JourneyAction = 'view_matches' | 'continue_biodata' | 'view_profile' | 'review_interest' | 'start_conversation' | 'begin_planning';

export interface RelationshipPresentation {
  label: string;
  description: string;
  nextAction: string | null;
  to: string | null;
  action: JourneyAction | null;
}

export interface ReadinessPresentation {
  label: string;
  description: string;
  nextAction: string;
  to: '/biodata' | '/profile';
  action: 'continue_biodata' | 'view_profile';
  percent: number;
}

const relationshipPresentations: Record<RelationshipState, RelationshipPresentation> = {
  none: {
    label: 'Ready to explore',
    description: 'Your introduction is ready to be considered alongside compatible profiles.',
    nextAction: 'View matches',
    to: '/matches',
    action: 'view_matches',
  },
  interest_sent: {
    label: 'Interest sent',
    description: 'Your interest is with them. You will be notified if they respond.',
    nextAction: null,
    to: null,
    action: null,
  },
  interest_received: {
    label: 'Interest received',
    description: 'A private interest is ready for your review.',
    nextAction: 'Review this interest',
    to: '/interests',
    action: 'review_interest',
  },
  accepted: {
    label: 'Interest accepted',
    description: 'You can now continue privately through the existing conversation space.',
    nextAction: 'Start a private conversation',
    to: '/chat',
    action: 'start_conversation',
  },
  declined_by_you: {
    label: 'Interest declined',
    description: 'You chose not to continue with this introduction.',
    nextAction: null,
    to: null,
    action: null,
  },
  declined_by_them: {
    label: 'Interest declined',
    description: 'They chose not to continue with this introduction.',
    nextAction: null,
    to: null,
    action: null,
  },
  fixed: {
    label: 'Match fixed',
    description: 'Your shared wedding chapter can now continue in the planning space.',
    nextAction: 'Begin planning together',
    to: '/planner',
    action: 'begin_planning',
  },
};

/** Returns copy for an existing, server-established relationship state. */
export function relationshipPresentation(state: RelationshipState): RelationshipPresentation {
  return relationshipPresentations[state];
}

/**
 * Returns the next presentational step for a profile completion value already
 * calculated by the host page. Missing field names are only echoed as context.
 */
export function readinessPresentation(percent: number, missing: string[]): ReadinessPresentation {
  const safePercent = Math.max(0, Math.min(100, Math.round(Number.isFinite(percent) ? percent : 0)));
  if (safePercent >= 100) {
    return {
      label: 'Your introduction is ready',
      description: 'Your profile is complete and ready to share within your existing privacy settings.',
      nextAction: 'View your profile',
      to: '/profile',
      action: 'view_profile',
      percent: safePercent,
    };
  }

  const details = missing.filter(Boolean).join(', ');
  return {
    label: 'Profile in progress',
    description: details ? `Add ${details} to complete your introduction.` : 'Continue your biodata to complete your introduction.',
    nextAction: 'Continue your biodata',
    to: '/biodata',
    action: 'continue_biodata',
    percent: safePercent,
  };
}
