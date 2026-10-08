import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { CapacityMetricKey, CapacityUnit } from '../capacity/capacity.types';

export type OperationalAlertSeverity = 'warning' | 'critical';
export type OperationalAlertStatus = 'open' | 'acknowledged' | 'resolved';

@Entity('operational_alerts')
export class OperationalAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128 })
  fingerprint: string;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  metric: CapacityMetricKey;

  @Index()
  @Column({ type: 'varchar', length: 16 })
  severity: OperationalAlertSeverity;

  @Index()
  @Column({ type: 'varchar', length: 16, default: 'open' })
  status: OperationalAlertStatus;

  @Column({ type: 'double precision' })
  observedValue: number;

  @Column({ type: 'double precision' })
  thresholdValue: number;

  @Column({ type: 'varchar', length: 24 })
  unit: CapacityUnit;

  @Column({ type: 'varchar', length: 128 })
  source: string;

  @Column({ type: 'timestamptz' })
  firstObservedAt: Date;

  @Column({ type: 'timestamptz' })
  lastObservedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  acknowledgedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  acknowledgedBy: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastNotifiedAt: Date | null;

  @Column({ type: 'jsonb', default: {} })
  deliveryMetadata: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
