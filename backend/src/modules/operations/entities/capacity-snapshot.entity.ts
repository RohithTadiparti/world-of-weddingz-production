import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { CapacityMetric } from '../capacity/capacity.types';

@Entity('capacity_snapshots')
export class CapacitySnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'timestamptz' })
  periodStart: Date;

  @Column({ type: 'jsonb' })
  metrics: CapacityMetric[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
