import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * The card is owned by the wedding host, rather than by a single function.
 * It can therefore be replaced without changing a guest or an RSVP.
 */
@Entity('wedding_invitations')
@Index(['userId'], { unique: true })
export class WeddingInvitation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @Column({ type: 'varchar', length: 2000, nullable: true })
  cardUrl: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
