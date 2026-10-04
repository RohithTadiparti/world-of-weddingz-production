export function isAllowedSocketOrigin(
  origin: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  return origin === undefined || allowedOrigins.includes(origin);
}

export const socketCorsOrigin = (
  origin: string | undefined,
  callback: (error: Error | null, allow?: boolean) => void,
) => {
  const allowed = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  callback(isAllowedSocketOrigin(origin, allowed) ? null : new Error('Origin not allowed'), true);
};
