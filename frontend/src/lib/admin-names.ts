/**
 * The label an administrator list leads a row with (WOW-01..04).
 *
 * The server names each account — the person's first and last name, else their
 * profile name, else the business they run — and only falls back to the
 * masked email or mobile when there is no name at all. This repeats that last
 * step for an older row without a `name`, so a row is never blank and never
 * shows a contact value the server did not already mask.
 */
export function accountLabel(row: {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}): string {
  return row.name?.trim() || row.email || row.phone || 'No name on file';
}
