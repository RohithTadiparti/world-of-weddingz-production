import { eventDateMismatch } from './request-schedule';

describe('eventDateMismatch (row 14)', () => {
  const mehendi = { name: 'Mehendi', eventDate: '2026-12-10' };

  it('passes a request on the event day', () => {
    expect(eventDateMismatch(mehendi, '2026-12-10')).toBeNull();
    expect(eventDateMismatch({ ...mehendi, eventDate: new Date('2026-12-10T00:00:00Z') }, '2026-12-10')).toBeNull();
  });

  it('refuses a slot or requested date on another day, naming both', () => {
    expect(eventDateMismatch(mehendi, '2026-12-11')).toBe(
      'Mehendi is on 2026-12-10, but the date you chose is 2026-12-11. ' +
        'Pick a date that matches the event, or choose a different event.',
    );
  });

  it('has nothing to compare when either side has no date', () => {
    expect(eventDateMismatch({ name: 'Reception', eventDate: null }, '2026-12-11')).toBeNull();
    expect(eventDateMismatch(mehendi, null)).toBeNull();
  });
});
