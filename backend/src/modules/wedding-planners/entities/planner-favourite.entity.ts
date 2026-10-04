import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * A planner a couple has saved to come back to.
 *
 * One row per person and planner, so saving twice is a no-op rather than a
 * duplicate. Private to the person who saved it: a planner is never told who
 * has them in their favourites.
 */
@Entity('planner_favourites')
@Index(['userId', 'plannerId'], { unique: true })
export class PlannerFavourite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column('uuid')
  userId: string;

  @Index()
  @Column('uuid')
  plannerId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
