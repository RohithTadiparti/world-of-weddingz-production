import 'reflect-metadata';
import * as bcrypt from 'bcryptjs';
import { config as loadEnv } from 'dotenv';
import dataSource from './data-source';
import { UserRole } from '../common/enums';
import { resolveAdminSeedConfig } from './seed-admin-config';

loadEnv();

/**
 * Bootstraps the first administrator.
 *
 *   npm run seed:admin          (source, needs ts-node)
 *   npm run seed:admin:prod     (compiled, inside the container)
 *
 * ADMIN_EMAIL and ADMIN_PASSWORD are required. Idempotent: re-running promotes
 * and re-activates the existing account rather than failing on the unique
 * email index.
 */
async function main(): Promise<void> {
  const { email, password } = resolveAdminSeedConfig(process.env);

  await dataSource.initialize();
  try {
    const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
    const passwordHash = await bcrypt.hash(password, rounds);

    const existing = await dataSource.query('SELECT id FROM users WHERE email = $1', [email]);

    if (existing.length > 0) {
      await dataSource.query(
        `UPDATE users
            SET "passwordHash" = $1, role = $2, "isActive" = true, "isVerified" = true
          WHERE email = $3`,
        [passwordHash, UserRole.ADMIN, email],
      );
      console.log(`Updated existing account ${email} to an active administrator.`);
      return;
    }

    await dataSource.query(
      `INSERT INTO users (email, "passwordHash", role, "isVerified", "isActive")
       VALUES ($1, $2, $3, true, true)`,
      [email, passwordHash, UserRole.ADMIN],
    );
    console.log(`Created administrator ${email}.`);
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((err) => {
  console.error('Admin seed failed:', err);
  process.exitCode = 1;
});
