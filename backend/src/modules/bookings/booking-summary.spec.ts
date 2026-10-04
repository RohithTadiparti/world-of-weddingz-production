import { PaymentStatus, QuotationStatus } from '../../common/enums';
import {
  escrowSummary,
  paymentBreakup,
  quotationStage,
  summariseQuotations,
  QuotationLike,
} from './booking-summary';

const quote = (
  status: QuotationStatus,
  createdAt: string,
  extra: Partial<QuotationLike> = {},
): QuotationLike => ({
  id: createdAt,
  amount: '50000.00',
  currency: 'INR',
  status,
  responseNote: null,
  respondedAt: null,
  validUntil: null,
  createdAt: new Date(createdAt),
  ...extra,
});

describe('quotation stage', () => {
  it('reads a first offer as sent', () => {
    expect(quotationStage(quote(QuotationStatus.SENT, '2026-09-01'), [])).toBe('sent');
  });

  it('reads an offer after an earlier one as a re-quote', () => {
    const earlier = [quote(QuotationStatus.REJECTED, '2026-09-01')];
    expect(quotationStage(quote(QuotationStatus.SENT, '2026-09-02'), earlier)).toBe('requoted');
  });

  it('reads a declined offer as declined, however many came before', () => {
    expect(quotationStage(quote(QuotationStatus.REJECTED, '2026-09-01'), [])).toBe('declined');
  });

  it('reads an offer past its date as expired before the sweep has marked it', () => {
    const lapsed = quote(QuotationStatus.SENT, '2026-09-01', { validUntil: new Date('2026-09-05') });
    expect(quotationStage(lapsed, [], new Date('2026-09-06').getTime())).toBe('expired');
  });

  it('keeps withdrawn and superseded offers apart from declined ones', () => {
    expect(quotationStage(quote(QuotationStatus.WITHDRAWN, '2026-09-01'), [])).toBe('withdrawn');
    expect(quotationStage(quote(QuotationStatus.SUPERSEDED, '2026-09-01'), [])).toBe('superseded');
  });

  it('summarises the newest offer whatever order the rows arrive in', () => {
    const summary = summariseQuotations([
      quote(QuotationStatus.SENT, '2026-09-03', { amount: '45000.00' }),
      quote(QuotationStatus.REJECTED, '2026-09-01', { responseNote: 'Over budget' }),
      quote(QuotationStatus.SUPERSEDED, '2026-09-02'),
    ]);
    expect(summary).toMatchObject({ amount: '45000.00', stage: 'requoted', count: 3, declinedCount: 1 });
  });

  it('has nothing to summarise on an unpriced request', () => {
    expect(summariseQuotations([])).toBeNull();
  });
});

describe('payment breakup', () => {
  const payment = (status: PaymentStatus, amount: string, commission: string, payout: string) => ({
    amount,
    commissionAmount: commission,
    payoutAmount: payout,
    status,
  });

  it('puts each instalment in the one bucket its status names', () => {
    const breakup = paymentBreakup('100000.00', [
      payment(PaymentStatus.RELEASED, '30000.00', '3000.00', '27000.00'),
      payment(PaymentStatus.HELD_IN_ESCROW, '30000.00', '3000.00', '27000.00'),
      payment(PaymentStatus.FAILED, '40000.00', '4000.00', '36000.00'),
    ]);
    expect(breakup).toEqual({
      total: '100000.00',
      paid: '60000.00',
      pending: '40000.00',
      heldInEscrow: '30000.00',
      pendingPayout: '0.00',
      released: '27000.00',
      refunded: '0.00',
      commission: '6000.00',
      vendorEarnings: '54000.00',
    });
  });

  it('counts owed payouts and refunds without calling either paid out', () => {
    const breakup = paymentBreakup('50000.00', [
      payment(PaymentStatus.PENDING_PAYOUT, '15000.00', '1500.00', '13500.00'),
      payment(PaymentStatus.REFUNDED, '15000.00', '1500.00', '13500.00'),
    ]);
    expect(breakup).toMatchObject({
      paid: '15000.00',
      pending: '35000.00',
      pendingPayout: '13500.00',
      released: '0.00',
      refunded: '15000.00',
    });
  });

  it('never reports a negative balance when more was taken than is now owed', () => {
    const breakup = paymentBreakup('10000.00', [
      payment(PaymentStatus.HELD_IN_ESCROW, '12000.00', '1200.00', '10800.00'),
    ]);
    expect(breakup.pending).toBe('0.00');
  });
});

describe('escrow summary', () => {
  const payment = (status: PaymentStatus, amount: string, commission: string, payout: string) => ({
    amount,
    commissionAmount: commission,
    payoutAmount: payout,
    status,
  });

  it('counts disputed money as held, a partial settlement as paid out and a pending payout as earned', () => {
    expect(
      escrowSummary([
        payment(PaymentStatus.HELD_IN_ESCROW, '30000.00', '3000.00', '27000.00'),
        payment(PaymentStatus.DISPUTED, '10000.00', '1000.00', '9000.00'),
        payment(PaymentStatus.RELEASED, '20000.00', '2000.00', '18000.00'),
        payment(PaymentStatus.PARTIALLY_SETTLED, '5000.00', '500.00', '4500.00'),
        payment(PaymentStatus.PENDING_PAYOUT, '7000.00', '700.00', '6300.00'),
        payment(PaymentStatus.REFUNDED, '4000.00', '0.00', '0.00'),
        payment(PaymentStatus.FAILED, '9000.00', '900.00', '8100.00'),
      ]),
    ).toEqual({
      held: '40000.00',
      released: '25000.00',
      refunded: '4000.00',
      commission: '3200.00',
      payout: '22500.00',
    });
  });

  it('is all zeroes for a booking with no payments', () => {
    expect(escrowSummary([])).toEqual({
      held: '0.00',
      released: '0.00',
      refunded: '0.00',
      commission: '0.00',
      payout: '0.00',
    });
  });
});
