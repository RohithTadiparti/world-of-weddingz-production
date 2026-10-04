import { PaymentStatus, QuotationStatus } from '../../common/enums';
import { isCollected } from './payment-totals';

/**
 * Where a booking's price negotiation stands, said the way both sides read it
 * (EZ1-I264).
 *
 * The quotation rows only know sent, accepted, rejected, expired, superseded
 * and withdrawn. What a vendor needs to see is the story: a first offer, an
 * offer declined with the booking handed back for a new price, a revised offer
 * on the table. That is derived from the rows rather than stored, so it cannot
 * drift from them.
 */
export type QuotationStage =
  | 'sent'
  | 'requoted'
  | 'accepted'
  | 'declined'
  | 'withdrawn'
  | 'expired'
  | 'superseded';

export interface QuotationLike {
  id: string;
  amount: string;
  currency: string;
  status: QuotationStatus;
  responseNote: string | null;
  respondedAt: Date | null;
  validUntil: Date | null;
  createdAt: Date;
}

export interface QuotationSummary {
  id: string;
  amount: string;
  currency: string;
  status: QuotationStatus;
  stage: QuotationStage;
  /** Why the customer declined, or anything they said accepting. */
  responseNote: string | null;
  respondedAt: Date | null;
  sentAt: Date;
  /** Every quotation on the booking, including superseded and declined ones. */
  count: number;
  declinedCount: number;
}

export function quotationStage(
  latest: QuotationLike,
  earlier: QuotationLike[],
  now = Date.now(),
): QuotationStage {
  switch (latest.status) {
    case QuotationStatus.ACCEPTED:
      return 'accepted';
    case QuotationStatus.REJECTED:
      // Declining hands the booking back to the vendor to re-price, so a
      // declined offer is also a request for a new one.
      return 'declined';
    case QuotationStatus.WITHDRAWN:
      return 'withdrawn';
    case QuotationStatus.EXPIRED:
      return 'expired';
    case QuotationStatus.SUPERSEDED:
      return 'superseded';
    default:
      if (latest.validUntil && latest.validUntil.getTime() <= now) return 'expired';
      return earlier.length > 0 ? 'requoted' : 'sent';
  }
}

/** The newest quotation on a booking, with where the negotiation stands. */
export function summariseQuotations(
  rows: QuotationLike[],
  now = Date.now(),
): QuotationSummary | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
  const latest = sorted[sorted.length - 1];
  return {
    id: latest.id,
    amount: latest.amount,
    currency: latest.currency,
    status: latest.status,
    stage: quotationStage(latest, sorted.slice(0, -1), now),
    responseNote: latest.responseNote,
    respondedAt: latest.respondedAt,
    sentAt: latest.createdAt,
    count: sorted.length,
    declinedCount: sorted.filter((r) => r.status === QuotationStatus.REJECTED).length,
  };
}

export interface PaymentLike {
  amount: string;
  commissionAmount: string;
  payoutAmount: string;
  status: PaymentStatus;
}

export interface PaymentBreakup {
  total: string;
  /** Collected from the customer: neither initiated, failed nor refunded. */
  paid: string;
  /** Still owed by the customer against the current total. */
  pending: string;
  /** Customer money the platform is holding, disputed money included. */
  heldInEscrow: string;
  /** Earned by the vendor and not yet transferred. */
  pendingPayout: string;
  /** Transferred to the vendor. */
  released: string;
  refunded: string;
  /** The platform's share of what has been collected. */
  commission: string;
  /** The vendor's share of what has been collected, wherever it sits now. */
  vendorEarnings: string;
}

const minor = (value: string | null | undefined): number =>
  Math.round(parseFloat(value || '0') * 100);
const major = (value: number): string => (value / 100).toFixed(2);

/** Customer money the platform is holding, disputed money included. */
const HELD: PaymentStatus[] = [PaymentStatus.HELD_IN_ESCROW, PaymentStatus.DISPUTED];
/** Transferred to the provider, in full or as part of a settlement. */
const PAID_OUT: PaymentStatus[] = [PaymentStatus.RELEASED, PaymentStatus.PARTIALLY_SETTLED];
/** Earned by the provider, whether or not it has been transferred yet. */
const EARNED: PaymentStatus[] = [PaymentStatus.PENDING_PAYOUT, ...PAID_OUT];

export interface EscrowSummary {
  held: string;
  released: string;
  refunded: string;
  commission: string;
  payout: string;
}

/**
 * The escrow position across one booking's instalments, as a payment's detail
 * screen shows it.
 *
 * The admin's copy of this counted only HELD_IN_ESCROW as held and only
 * RELEASED as paid out, while the provider's counted disputed money as held,
 * a partial settlement as paid and a pending payout as commission earned — so
 * the same payment read differently on the two screens. One set of groups, the
 * same buckets the Accounts page uses, for both.
 */
export function escrowSummary(payments: PaymentLike[]): EscrowSummary {
  const sum = (statuses: PaymentStatus[], column: keyof Omit<PaymentLike, 'status'>) =>
    major(
      payments
        .filter((p) => statuses.includes(p.status))
        .reduce((total, p) => total + minor(p[column]), 0),
    );
  return {
    held: sum(HELD, 'amount'),
    released: sum(PAID_OUT, 'amount'),
    refunded: sum([PaymentStatus.REFUNDED], 'amount'),
    commission: sum(EARNED, 'commissionAmount'),
    payout: sum(PAID_OUT, 'payoutAmount'),
  };
}

/**
 * Where every rupee on one booking is (EZ1-I265).
 *
 * The same buckets the vendor's Accounts page uses, summed for a single
 * booking, so the booking and the ledger it rolls up into cannot disagree.
 * Worked in minor units: summing decimal strings drifts a paisa at a time.
 */
export function paymentBreakup(total: string, payments: PaymentLike[]): PaymentBreakup {
  let paid = 0;
  let held = 0;
  let owed = 0;
  let released = 0;
  let refunded = 0;
  let commission = 0;
  let earnings = 0;

  for (const payment of payments) {
    if (payment.status === PaymentStatus.REFUNDED) refunded += minor(payment.amount);
    if (!isCollected(payment.status)) continue;
    paid += minor(payment.amount);
    commission += minor(payment.commissionAmount);
    earnings += minor(payment.payoutAmount);
    if (payment.status === PaymentStatus.HELD_IN_ESCROW || payment.status === PaymentStatus.DISPUTED) {
      held += minor(payment.amount);
    } else if (payment.status === PaymentStatus.PENDING_PAYOUT) {
      owed += minor(payment.payoutAmount);
    } else if (
      payment.status === PaymentStatus.RELEASED ||
      payment.status === PaymentStatus.PARTIALLY_SETTLED
    ) {
      released += minor(payment.payoutAmount);
    }
  }

  return {
    total: major(minor(total)),
    paid: major(paid),
    pending: major(Math.max(0, minor(total) - paid)),
    heldInEscrow: major(held),
    pendingPayout: major(owed),
    released: major(released),
    refunded: major(refunded),
    commission: major(commission),
    vendorEarnings: major(earnings),
  };
}
