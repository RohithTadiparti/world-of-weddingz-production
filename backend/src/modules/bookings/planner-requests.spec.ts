import { BookingStatus } from '../../common/enums';
import type { Booking } from './entities/booking.entity';
import {
  dateAvailability,
  plannerRequestStatus,
  requestNumber,
  toRequestCard,
  toRequestDetail,
} from './planner-requests';

const at = new Date('2026-09-28T06:00:00Z');

describe('plannerRequestStatus', () => {
  const base = { status: BookingStatus.REQUESTED, providerAcceptedAt: null, quotation: null };

  it('is new until somebody answers', () => {
    expect(plannerRequestStatus(base)).toBe('new');
  });

  it('is accepted once the planner takes it on', () => {
    expect(plannerRequestStatus({ ...base, providerAcceptedAt: at })).toBe('accepted');
  });

  it('follows the quotation', () => {
    expect(plannerRequestStatus({ ...base, quotation: { stage: 'sent' } })).toBe('quotation_sent');
    expect(plannerRequestStatus({ ...base, quotation: { stage: 'requoted' } })).toBe('quotation_sent');
    expect(plannerRequestStatus({ ...base, quotation: { stage: 'declined' } })).toBe(
      'requote_requested',
    );
    // A lapsed offer leaves the planner engaged and owing a new price.
    expect(plannerRequestStatus({ ...base, quotation: { stage: 'expired' } })).toBe('accepted');
  });

  it('is accepted once a price is agreed, however far the job has got', () => {
    for (const status of [
      BookingStatus.QUOTATION_ACCEPTED,
      BookingStatus.PAYMENT_PENDING,
      BookingStatus.CONFIRMED,
      BookingStatus.IN_PROGRESS,
    ]) {
      expect(plannerRequestStatus({ ...base, status })).toBe('accepted');
    }
  });

  it('tells a planner decline apart from the couple walking away', () => {
    const cancelled = { ...base, status: BookingStatus.CANCELLED };
    expect(plannerRequestStatus({ ...cancelled, cancelledByRole: 'provider' })).toBe('declined');
    expect(plannerRequestStatus({ ...cancelled, cancelledByRole: 'customer' })).toBe('closed');
    expect(plannerRequestStatus({ ...base, status: BookingStatus.COMPLETED })).toBe('closed');
  });
});

describe('requestNumber', () => {
  it('reads year and the start of the id', () => {
    expect(requestNumber('3f9a1c2d-0000-4000-8000-000000000000', at)).toBe('REQ-2026-3F9A1C');
  });
});

describe('dateAvailability', () => {
  const today = '2026-10-02';
  it('covers each case', () => {
    expect(dateAvailability({ date: null, today, openings: 0, otherBookings: 0 })).toBe('no_date');
    expect(dateAvailability({ date: '2026-09-01', today, openings: 3, otherBookings: 0 })).toBe('past');
    expect(dateAvailability({ date: '2026-12-15', today, openings: 1, otherBookings: 1 })).toBe(
      'available',
    );
    expect(dateAvailability({ date: '2026-12-15', today, openings: 0, otherBookings: 1 })).toBe('booked');
    expect(dateAvailability({ date: '2026-12-15', today, openings: 0, otherBookings: 0 })).toBe(
      'unpublished',
    );
  });
});

describe('toRequestCard / toRequestDetail', () => {
  const booking = {
    id: '3f9a1c2d-0000-4000-8000-000000000000',
    userId: 'u1',
    status: BookingStatus.REQUESTED,
    providerAcceptedAt: null,
    amount: '0.00',
    expectedBudget: '200000.00',
    currency: 'INR',
    eventDate: '2026-12-15',
    createdAt: at,
    requirements: 'Traditional Telugu wedding',
    notes: null,
    referenceImages: ['https://cdn.example/a.jpg'],
    requestedServices: ['full_planning'],
    plannerBrief: {
      location: 'Hyderabad, Telangana',
      guestCountMin: 250,
      guestCountMax: 300,
      weddingType: 'Traditional',
      budgetMin: 150000,
      budgetMax: 200000,
    },
    clientName: 'Rahul Sharma',
    clientEmail: 'rahul@example.com',
    clientPhone: '9876543210',
    clientCity: 'Hyderabad',
    clientPhoto: null,
    quotation: null,
    cancellationReason: null,
    cancelledAt: null,
  } as unknown as Booking;

  it('carries the brief', () => {
    const card = toRequestCard(booking);
    expect(card).toMatchObject({
      status: 'new',
      location: 'Hyderabad, Telangana',
      budgetMin: 150000,
      budgetMax: 200000,
      services: ['full_planning'],
    });
  });

  it('never carries the phone number', () => {
    const detail = toRequestDetail(booking, { state: 'available', openings: 1, otherBookings: 0 });
    expect(JSON.stringify(detail)).not.toContain('9876543210');
    expect(detail.client.email).toBe('rahul@example.com');
    expect(detail.guestCountMin).toBe(250);
  });

  it('reads a pre-brief request budget from its amount', () => {
    const legacy = { ...booking, plannerBrief: null, expectedBudget: null, amount: '90000.00' };
    expect(toRequestCard(legacy as Booking).budgetMax).toBe(90000);
  });
});
