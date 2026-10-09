import { MigrationInterface, QueryRunner } from 'typeorm';

export class OperationalCapacity1710000114000 implements MigrationInterface {
  name = 'OperationalCapacity1710000114000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "capacity_snapshots" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "periodStart" timestamptz NOT NULL,
        "metrics" jsonb NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_capacity_snapshots" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_capacity_snapshots_period" UNIQUE ("periodStart")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "operational_alerts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "fingerprint" varchar(128) NOT NULL,
        "metric" varchar(64) NOT NULL,
        "severity" varchar(16) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'open',
        "observedValue" double precision NOT NULL,
        "thresholdValue" double precision NOT NULL,
        "unit" varchar(24) NOT NULL,
        "source" varchar(128) NOT NULL,
        "firstObservedAt" timestamptz NOT NULL,
        "lastObservedAt" timestamptz NOT NULL,
        "acknowledgedAt" timestamptz,
        "acknowledgedBy" uuid,
        "resolvedAt" timestamptz,
        "lastNotifiedAt" timestamptz,
        "deliveryMetadata" jsonb NOT NULL DEFAULT '{}',
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_operational_alerts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_operational_alerts_fingerprint" UNIQUE ("fingerprint"),
        CONSTRAINT "CK_operational_alerts_severity" CHECK ("severity" IN ('warning','critical')),
        CONSTRAINT "CK_operational_alerts_status" CHECK ("status" IN ('open','acknowledged','resolved'))
      )
    `);
    await queryRunner.query('CREATE INDEX "IDX_operational_alerts_metric" ON "operational_alerts" ("metric")');
    await queryRunner.query('CREATE INDEX "IDX_operational_alerts_status" ON "operational_alerts" ("status")');
    await queryRunner.query('CREATE INDEX "IDX_operational_alerts_severity" ON "operational_alerts" ("severity")');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "operational_alerts"');
    await queryRunner.query('DROP TABLE "capacity_snapshots"');
  }
}
