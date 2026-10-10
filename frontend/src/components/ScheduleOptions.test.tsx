import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ScheduleOptions from './ScheduleOptions';
import { EMPTY_SCHEDULE } from '../lib/request-schedule';

const slot = {
  id: 's1',
  date: '2026-12-10',
  startTime: '10:00:00',
  endTime: '14:00:00',
  capacity: 1,
  confirmed: 0,
  remaining: 1,
  note: null,
};

describe('ScheduleOptions (row 13)', () => {
  it('shows both options by default with neither selected', () => {
    const html = renderToStaticMarkup(
      <ScheduleOptions value={EMPTY_SCHEDULE} onChange={() => undefined} slots={[slot]} isLoading={false} />,
    );
    expect(html).toContain('Pick a Date &amp; Time');
    expect(html).toContain('Request on Date');
    expect(html).not.toContain('checked=""');
    expect(html).not.toContain('type="time"');
  });

  it('keeps both visible with one selected, and gives Request on Date a time', () => {
    const html = renderToStaticMarkup(
      <ScheduleOptions
        value={{ ...EMPTY_SCHEDULE, requestDate: true }}
        onChange={() => undefined}
        slots={[slot]}
        isLoading={false}
      />,
    );
    expect(html).toContain('Pick a Date &amp; Time');
    expect(html).toContain('type="date"');
    expect(html).toContain('type="time"');
  });

  it('lists the slots under Pick a Date & Time when it is selected', () => {
    const html = renderToStaticMarkup(
      <ScheduleOptions
        value={{ ...EMPTY_SCHEDULE, pickSlot: true, slotId: 's1', slotDate: '2026-12-10' }}
        onChange={() => undefined}
        slots={[slot]}
        isLoading={false}
      />,
    );
    expect(html).toContain('10:00–14:00');
    expect(html).toContain('aria-pressed="true"');
  });
});
