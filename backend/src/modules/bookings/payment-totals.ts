import { PaymentStatus } from '../../common/enums';

/** The part of a payment row these sums care about. */
export interface CountedPayment {
  bookingId: string;
  amount: string;
  status: PaymentStatus;
}

/**
 * A payment in one of these states is not money in hand.
 *
 * An initiated payment was begun and never taken, a failed charge never
 * arrived, and a refunded one has gone back. All three leave their row on the
 * booking — the history matters — and none may be counted as paid, or a vendor
 * would read an advance as held and start the work on it. The admin console
 * leaves out the same states.
 */
const NOT_COLLECTED: PaymentStatus[] = [
  PaymentStatus.INITIATED,
  PaymentStatus.FAILED,
  PaymentStatus.REFUNDED,
];

export function isCollected(status: PaymentStatus): boolean {
  return !NOT_COLLECTED.includes(status);
}

/**
 * How far a booking's money has got, for reporting one status across several
 * instalments: the furthest along wins.
 *
 * A failed charge ranks lowest, below one merely begun, so it never hides a
 * payment that did go through. A partial settlement is a dispute that has
 * ended with money moving both ways, so it sits past a plain release. Those two
 * were missing, which reported a booking with a settled dispute by whichever
 * earlier instalment happened to be ranked.
 */
export const PAYMENT_STATUS_RANK: Record<string, number> = {
  [PaymentStatus.FAILED]: 1,
  [PaymentStatus.INITIATED]: 2,
  [PaymentStatus.HELD_IN_ESCROW]: 3,
  [PaymentStatus.DISPUTED]: 4,
  [PaymentStatus.PENDING_PAYOUT]: 5,
  [PaymentStatus.RELEASED]: 6,
  [PaymentStatus.PARTIALLY_SETTLED]: 7,
  [PaymentStatus.REFUNDED]: 8,
};

/**
 * What has actually been collected against each booking, keyed by booking id.
 *
 * Used to put "paid so far" on a provider's queue without asking the instalment
 * endpoint once per row (EZ1-I259). Kept out of the listing method and pure, so
 * the rule about what counts as paid is stated in one place and can be tested
 * without a database.
 */
export function collectedByBooking(payments: CountedPayment[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const payment of payments) {
    if (!isCollected(payment.status)) continue;
    totals.set(
      payment.bookingId,
      (totals.get(payment.bookingId) ?? 0) + Number(payment.amount || 0),
    );
  }
  return totals;
}
