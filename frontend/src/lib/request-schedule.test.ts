import { describe, expect, it } from 'vitest';
import {
  EMPTY_SCHEDULE,
  scheduleError,
  schedulePayload,
  toggleOption,
} from './request-schedule';

describe('request schedule (row 13)', () => {
  it('starts with both options visible and neither selected', () => {
    expect(EMPTY_SCHEDULE.pickSlot).toBe(false);
    expect(EMPTY_SCHEDULE.requestDate).toBe(false);
    expect(scheduleError(EMPTY_SCHEDULE)).toMatch(/Pick a Date & Time.*Request on Date/);
  });

  it('selects and unselects each option independently', () => {
    const both = toggleOption(toggleOption(EMPTY_SCHEDULE, 'pickSlot'), 'requestDate');
    expect(both).toMatchObject({ pickSlot: true, requestDate: true });
    const filled = { ...both, slotId: 's1', slotDate: '2026-12-10', date: '2026-12-11', time: '18:00' };
    const slotOff = toggleOption(filled, 'pickSlot');
    expect(slotOff).toMatchObject({ pickSlot: false, requestDate: true, slotId: '', date: '2026-12-11', time: '18:00' });
  });

  it('needs only one option filled, never both', () => {
    const both = { ...EMPTY_SCHEDULE, pickSlot: true, requestDate: true };
    expect(scheduleError(both)).toMatch(/or enter the date/);
    expect(scheduleError({ ...both, date: '2026-12-11' })).toBeNull();
    expect(scheduleError({ ...both, slotId: 's1', slotDate: '2026-12-10' })).toBeNull();
    expect(scheduleError({ ...both, slotId: 's1', slotDate: '2026-12-10', date: '2026-12-11' })).toMatch(
      /Unselect one/,
    );
  });

  it('carries a time with Request on Date', () => {
    const sel = { ...EMPTY_SCHEDULE, requestDate: true, date: '2026-12-11', time: '18:30' };
    expect(schedulePayload(sel)).toEqual({ eventDate: '2026-12-11', requestedTime: '18:30' });
    expect(scheduleError({ ...sel, date: '' })).toMatch(/date you need before the time/);
    expect(schedulePayload({ ...EMPTY_SCHEDULE, pickSlot: true, slotId: 's1', slotDate: '2026-12-10' })).toEqual({
      slotId: 's1',
    });
  });
});

describe('event date match (row 14)', () => {
  const event = { name: 'Mehendi', eventDate: '2026-12-10' };

  it('blocks a slot or requested date on another day', () => {
    expect(scheduleError({ ...EMPTY_SCHEDULE, requestDate: true, date: '2026-12-11' }, event)).toMatch(
      /Mehendi is on 2026-12-10, but the date you chose is 2026-12-11/,
    );
    expect(
      scheduleError({ ...EMPTY_SCHEDULE, pickSlot: true, slotId: 's1', slotDate: '2026-12-09' }, event),
    ).toMatch(/Mehendi/);
  });

  it('passes on the event day', () => {
    expect(scheduleError({ ...EMPTY_SCHEDULE, requestDate: true, date: '2026-12-10' }, event)).toBeNull();
  });
});
