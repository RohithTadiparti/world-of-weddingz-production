import { describe, expect, it } from 'vitest';
import {
  businessSupportLink,
  canClose,
  canReply,
  raiserTimeline,
  supportBucket,
  supportPrefill,
  supportStatusLabel,
} from './support-cases';

/** The vendor Support page's rules (rows 26, 27 and Support completeness). */
describe('support case status for the raiser', () => {
  it('never shows a finished case as waiting on the vendor', () => {
    expect(supportStatusLabel('resolved')).toBe('Resolved');
    expect(supportStatusLabel('cancelled')).toBe('Cancelled');
    expect(supportStatusLabel('waiting_for_information')).toBe('Waiting on you');
  });

  it('buckets every status once', () => {
    expect(supportBucket('open')).toBe('open');
    expect(supportBucket('triaged')).toBe('open');
    expect(supportBucket('in_progress')).toBe('pending');
    expect(supportBucket('waiting_for_information')).toBe('pending');
    for (const s of ['resolved', 'rejected', 'closed', 'cancelled']) expect(supportBucket(s)).toBe('resolved');
  });

  it('offers reply only while the case is live, and close until it is final', () => {
    expect(canReply('waiting_for_information')).toBe(true);
    expect(canReply('resolved')).toBe(false);
    expect(canReply('cancelled')).toBe(false);
    expect(canClose('resolved')).toBe(true);
    expect(canClose('open')).toBe(true);
    expect(canClose('closed')).toBe(false);
    expect(canClose('cancelled')).toBe(false);
  });
});

describe('Contact Support from a refused listing', () => {
  it('opens a new listing case already linked to the business', () => {
    const link = businessSupportLink('biz-1');
    expect(link).toBe('/support?new=1&subject=vendor&business=biz-1');
    expect(supportPrefill(new URLSearchParams(link.split('?')[1]))).toEqual({
      subjectType: 'vendor',
      subjectId: 'biz-1',
    });
  });

  it('ignores a subject it does not know', () => {
    expect(supportPrefill(new URLSearchParams('subject=nonsense'))).toEqual({ subjectType: 'other', subjectId: '' });
  });
});

describe('the raiser\'s timeline', () => {
  it('marks their own replies and collapses repeats', () => {
    const timeline = raiserTimeline(
      [
        { at: '1', byUserId: 'me', status: 'open' },
        { at: '2', byUserId: 'support', status: 'waiting_for_information', note: 'Upload the lease' },
        { at: '3', byUserId: 'support', status: 'waiting_for_information', note: 'Upload the lease' },
        { at: '4', byUserId: 'me', status: 'in_progress', note: 'Attached', kind: 'reply' },
        { at: '5', byUserId: 'support', status: 'resolved', remarks: 'no action' },
      ],
      'me',
    );
    expect(timeline.map((t) => t.label)).toEqual(['Open', 'Waiting on you', 'You replied', 'Resolved']);
    expect(timeline[2]).toEqual(expect.objectContaining({ note: 'Attached', mine: true }));
    expect(timeline[3].note).toBe('no action');
  });
});
