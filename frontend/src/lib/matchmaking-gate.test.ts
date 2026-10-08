import { describe, expect, it } from 'vitest';
import { interestGate, matchmakingGate, type MatchStatus } from './matchmaking-gate';
import { isConflict } from './api-errors';

const status = (over: Partial<MatchStatus> = {}): MatchStatus => ({
  profileId: 'p1',
  profileCompleted: true,
  stage: 'matchmaking_active' as MatchStatus['stage'],
  matchFixedState: 'none' as MatchStatus['matchFixedState'],
  identitySubmitted: false,
  identityVerified: false,
  identityRequired: true,
  ...over,
});

describe('interest gate', () => {
  it('keeps browsing open to an unverified profile', () => {
    expect(matchmakingGate(status())).toBeUndefined();
  });

  it('closes sending, accepting and fixing until identity is verified, when required', () => {
    expect(interestGate(status())).toMatch(/Aadhaar OTP/);
    expect(interestGate(status({ identitySubmitted: true }))).toMatch(/Finish identity verification/);
    expect(interestGate(status({ identityVerified: true }))).toBeUndefined();
  });

  it('says nothing about identity when the platform does not require it', () => {
    expect(interestGate(status({ identityRequired: false }))).toBeUndefined();
  });

  it('still reports the browsing reasons first', () => {
    expect(interestGate(status({ profileCompleted: false }))).toMatch(/Fill in the profile/);
  });
});

describe('isConflict', () => {
  it('recognises a 409 and nothing else', () => {
    expect(isConflict({ response: { status: 409 } })).toBe(true);
    expect(isConflict({ response: { status: 403 } })).toBe(false);
    expect(isConflict(new Error('offline'))).toBe(false);
    expect(isConflict(undefined)).toBe(false);
  });
});
