export type AdminSeedEnvironment = Partial<
  Pick<NodeJS.ProcessEnv, 'ADMIN_EMAIL' | 'ADMIN_PASSWORD' | 'SEED_ADMIN_ALLOW_WEAK_PASSWORD'>
>;

export function resolveAdminSeedConfig(environment: AdminSeedEnvironment): {
  email: string;
  password: string;
} {
  const set = (value: string | undefined) => (value?.trim() ? value.trim() : undefined);
  const email = set(environment.ADMIN_EMAIL)?.toLowerCase();
  const password = set(environment.ADMIN_PASSWORD);

  if (!email || !password) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required.');
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error(`ADMIN_EMAIL is not a valid email address: ${email}`);
  }
  if (password.length < 12 && environment.SEED_ADMIN_ALLOW_WEAK_PASSWORD !== 'true') {
    throw new Error('ADMIN_PASSWORD must be at least 12 characters.');
  }

  return { email, password };
}
