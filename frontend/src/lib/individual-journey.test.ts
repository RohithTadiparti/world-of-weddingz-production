import { describe, expect, it } from 'vitest';
import { readinessPresentation, relationshipPresentation } from './individual-journey';

describe('individual journey presentation', () => {
  it('makes an incomplete introduction actionable without inventing a new gate', () => {
    expect(readinessPresentation(60, ['Photos'])).toMatchObject({
      label: 'Profile in progress',
      nextAction: 'Continue your biodata',
    });
  });

  it('describes an accepted interest as the existing private conversation step', () => {
    expect(relationshipPresentation('accepted')).toMatchObject({
      label: 'Interest accepted',
      nextAction: 'Start a private conversation',
      to: '/chat',
    });
  });

  it('directs a received interest to the existing review space', () => {
    expect(relationshipPresentation('interest_received')).toMatchObject({
      nextAction: 'Review this interest',
      to: '/interests',
    });
  });

  it('does not offer an action after the other person declines', () => {
    expect(relationshipPresentation('declined_by_them')).toMatchObject({ action: null });
  });

  it('changes the readiness destination once the introduction is complete', () => {
    expect(readinessPresentation(100, [])).toMatchObject({
      label: 'Your introduction is ready',
      nextAction: 'View your profile',
      to: '/profile',
    });
  });

  it('keeps a sent interest informational until the other person responds', () => {
    expect(relationshipPresentation('interest_sent')).toMatchObject({
      action: null,
      nextAction: null,
      to: null,
    });
  });

  it('makes planning an explanatory next step only after a match is fixed', () => {
    expect(relationshipPresentation('fixed')).toMatchObject({
      nextAction: 'Begin planning together',
      to: '/planner',
      action: 'begin_planning',
    });
  });
});
