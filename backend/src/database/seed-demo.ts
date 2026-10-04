import 'reflect-metadata';
import * as bcrypt from 'bcryptjs';
import { config as loadEnv } from 'dotenv';
import dataSource from './data-source';
import { UserRole } from '../common/enums';

loadEnv();

/**
 * One sign-in per role, for walking the interface on a local stack.
 *
 *   npm run seed:demo          (source, needs ts-node)
 *   npm run seed:demo:prod     (compiled, inside the container)
 *
 * Every screen in the app is gated by the permissions of a role, so checking
 * the interface end to end means being each of them in turn. Several roles
 * cannot be self-registered at all (an officer, an administrator), which is
 * why this is a seeder rather than a trip through the sign-up form.
 *
 * Unlike the admin seeder there is no built-in password: DEMO_PASSWORD must be
 * set, and nothing is written without it. A deployment that never sets it can
 * never grow eight accounts with a shared password, which is the whole of the
 * safety this needs. Idempotent: re-running resets the password and role of
 * the existing accounts rather than failing on the unique email index.
 *
 * The accounts start where a real one starts — verified email, empty profile —
 * so what they show is the interface a new member of that role actually sees.
 */
const DEMO_ROLES: UserRole[] = [
  UserRole.BRIDE,
  UserRole.GROOM,
  UserRole.FAMILY,
  UserRole.AGENT,
  UserRole.VENDOR,
  UserRole.PLANNER,
  UserRole.IN_PERSON,
  UserRole.ADMIN,
];

const demoEmail =(role: UserRole) => `demo.${role.replace(/_/g, '-')}@wow.local`;

async function main(): Promise<void> {
  const password = process.env.DEMO_PASSWORD?.trim();
  if (!password) {
    console.log('DEMO_PASSWORD is not set, so no demo accounts were created.');
    return;
  }
  if (password.length < 12) {
    console.error('DEMO_PASSWORD must be at least 12 characters.');
    process.exitCode = 1;
    return;
  }

  await dataSource.initialize();
  try {
    const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
    const passwordHash = await bcrypt.hash(password, rounds);

    for (const role of DEMO_ROLES) {
      const email = demoEmail(role);
      await dataSource.query(
        `INSERT INTO users (email, "passwordHash", role, "isVerified", "isActive", "emailVerifiedAt")
         VALUES ($1, $2, $3, true, true, now())
         ON CONFLICT (email) DO UPDATE
            SET "passwordHash" = EXCLUDED."passwordHash",
                role = EXCLUDED.role,
                "isVerified" = true,
                "isActive" = true,
                "failedLoginAttempts" = 0,
                "lockedUntil" = NULL`,
        [email, passwordHash, role],
      );
      console.log(`  ${role.padEnd(10)} ${email}`);
    }
    console.log(`Demo accounts ready (${DEMO_ROLES.length}). They share the password in DEMO_PASSWORD.`);
  } finally {
    await dataSource.destroy();
  }
}

void main().catch((err) => {
  console.error('Demo seed failed:', err);
  process.exitCode = 1;
});
