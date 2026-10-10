import { useState } from 'react';
import { api, apiMessage } from '../lib/api';
import { Permission, can } from '../lib/permissions';
import { usePermissions } from '../store/auth';

export interface RevealedContact {
  id: string;
  email: string | null;
  phone: string | null;
  /** An account reveal also returns the contact line of each vendor business it owns. */
  businesses?: { id: string; contactPhone: string | null }[];
  /** ...and of each planner business. */
  plannerBusinesses?: { id: string; contactPhone: string | null; contactEmail: string | null }[];
}

/**
 * An account's email and mobile, masked until an administrator asks to see them.
 *
 * `/admin/accounts/:id` returns both masked (`r***@gmail.com`, `******3210`).
 * The full values come from a separate read that needs its own permission and
 * writes an audit row, so the button says what it does: the reveal is
 * recorded against the administrator who pressed it.
 */
export function useContactReveal(
  accountId: string,
  /**
   * Where the full values come from. An account by default; a marriage profile
   * carries contact lines of its own, revealed at `/admin/profiles/:id/contact`.
   */
  url = `/admin/accounts/${accountId}/contact`,
) {
  const permissions = usePermissions();
  const [contact, setContact] = useState<RevealedContact | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function reveal() {
    setError('');
    setBusy(true);
    try {
      setContact((await api.get(url)).data as RevealedContact);
    } catch (err) {
      setError(apiMessage(err, 'Those details could not be revealed.'));
    } finally {
      setBusy(false);
    }
  }

  return {
    canReveal: can(permissions, Permission.ADMIN_CONTACT_REVEAL),
    contact,
    error,
    busy,
    reveal,
    hide: () => setContact(null),
  };
}

export function ContactRevealButton({
  state,
}: {
  state: ReturnType<typeof useContactReveal>;
}) {
  if (!state.canReveal) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {state.contact ? (
        <button type="button" className="btn-ghost btn-sm" onClick={state.hide}>
          Hide contact details
        </button>
      ) : (
        <button
          type="button"
          className="btn-outline btn-sm"
          disabled={state.busy}
          title="Shows the full email and mobile number. The reveal is recorded in the audit log."
          onClick={() => void state.reveal()}
        >
          {state.busy ? 'Revealing…' : 'Reveal contact details'}
        </button>
      )}
      {state.error && <span className="text-xs text-critical-fg">{state.error}</span>}
    </span>
  );
}
