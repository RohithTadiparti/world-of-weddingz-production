import { describe, expect, it } from 'vitest';
import { budgetRange, guestRange, receivedAgo, requestActions, serviceLabel } from './planner-requests';

describe('budgetRange', () => {
  it('reads a range, an upper bound, a lower bound or nothing', () => {
    expect(budgetRange(150000, 200000)).toBe('₹1,50,000 – ₹2,00,000');
    expect(budgetRange(null, 200000)).toBe('Up to ₹2,00,000');
    expect(budgetRange(150000, null)).toBe('From ₹1,50,000');
    expect(budgetRange(null, null)).toBe('Not shared');
  });
});

describe('guestRange', () => {
  it('reads like a guest count', () => {
    expect(guestRange(250, 300)).toBe('250 – 300');
    expect(guestRange(250, null)).toBe('250+');
    expect(guestRange(null, 300)).toBe('Up to 300');
  });
});

describe('receivedAgo', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  it('counts back in the largest sensible unit', () => {
    expect(receivedAgo('2026-10-02T11:59:40Z', now)).toBe('Just now');
    expect(receivedAgo('2026-10-02T10:00:00Z', now)).toBe('2 hours ago');
    expect(receivedAgo('2026-10-01T10:00:00Z', now)).toBe('1 day ago');
  });
});

describe('serviceLabel', () => {
  it('names a catalogue key', () => {
    expect(serviceLabel('full_planning')).toBe('Full Wedding Planning');
    expect(serviceLabel('mystery_key')).toBe('mystery key');
  });
});

describe('requestActions', () => {
  it('offers everything on a new request', () => {
    expect(requestActions({ status: 'new', bookingStatus: 'requested' })).toEqual({
      accept: true,
      quote: 'send',
      decline: true,
    });
  });
  it('offers a revised price once one has gone out', () => {
    expect(requestActions({ status: 'requote_requested', bookingStatus: 'requested' }).quote).toBe(
      'revise',
    );
  });
  it('offers nothing once the price is agreed or the request is over', () => {
    expect(requestActions({ status: 'accepted', bookingStatus: 'payment_pending' })).toEqual({
      accept: false,
      quote: null,
      decline: false,
    });
    expect(requestActions({ status: 'declined', bookingStatus: 'cancelled' }).decline).toBe(false);
  });
});
