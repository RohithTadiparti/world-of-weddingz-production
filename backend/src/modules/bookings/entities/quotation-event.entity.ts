import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * One step in how a booking's price was arrived at.
 *
 * Quotation rows record the offers a provider made, but not the two figures
 * the negotiation starts from -- the price the provider listed and the budget
 * the customer asked for -- nor a price agreed without any quotation at all.
 * A provider reading "22,000 declined" could not see that it was a counter to
 * a 20,000 budget against a 25,000 listing. Each step is written once, when it
 * happens, and never edited, so the history reads the same months later.
 */
export type QuotationEventKind =
  /** The provider's published price the customer picked when asking. */
  | 'listed_price'
  /** What the customer said they hoped to spend. */
  | 'budget'
  /** A quotation the provider sent, first or revised. */
  | 'quotation_sent'
  /** The customer accepted a quotation: the final price. */
  | 'quotation_accepted'
  /** The customer declined a quotation and asked for a requote. */
  | 'quotation_rejected'
  /** The provider took a quotation back before the customer answered. */
  | 'quotation_withdrawn'
  /** The provider accepted the customer's own price: the final price. */
  | 'request_accepted';

export const QUOTATION_EVENT_KINDS: QuotationEventKind[] = [
  'listed_price',
  'budget',
  'quotation_sent',
  'quotation_accepted',
  'quotation_rejected',
  'quotation_withdrawn',
  'request_accepted',
];

@Entity('quotation_events')
@Index(['bookingId', 'occurredAt'])
export class QuotationEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  bookingId: string;

  @Column({ type: 'varchar', length: 40 })
  kind: QuotationEventKind;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  amount: string | null;

  @Column({ default: 'INR' })
  currency: string;

  /** Which side moved: the customer, the provider, or the platform. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  actorRole: 'customer' | 'provider' | 'system' | null;

  @Column({ type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({ type: 'uuid', nullable: true })
  quotationId: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  /** When it happened. Separate from createdAt so a backfill keeps history. */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  occurredAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
