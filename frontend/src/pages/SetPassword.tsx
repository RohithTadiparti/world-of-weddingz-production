import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import PasswordField from '../components/PasswordField';

/**
 * Where a provisioned account lands on its first sign-in.
 *
 * The platform created this account after a match was fixed and emailed a
 * temporary password. Until that password is replaced the server refuses
 * everything else, so this screen is deliberately the only thing on it — no
 * navigation, no "skip for now".
 *
 * Changing the password also ends the session it was used to open, which is why
 * the last step here is signing back in rather than continuing.
 */
export default function SetPassword() {
  const user = useAuth((s) => s.user);
  const clear = useAuth((s) => s.clear);
  const nav = useNavigate();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (next === current) {
      setError('New password must be different from your current password.');
      return;
    }
    if (next !== confirm) {
      setError('New password and confirm password must match.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/password/change', { currentPassword: current, newPassword: next });
      // The server has just revoked every session for this account, including
      // the one this page is running in. Clearing locally keeps the client
      // honest instead of leaving it holding a token the server has retired.
      clear();
      nav('/login', { replace: true });
    } catch (err) {
      setError(apiMessage(err, 'That password could not be set.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <form onSubmit={submit} className="card w-full max-w-md space-y-4">
        <div>
          <h1 className="page-title">Choose your password</h1>
          <p className="page-subtitle">
            Your account was created for you when your match was confirmed. Replace the temporary
            password we emailed {user?.email ? <strong>{user.email}</strong> : 'you'} with one of
            your own. The temporary one stops working the moment you do.
          </p>
        </div>

        {error && <p className="alert-critical">{error}</p>}

        <PasswordField
          label="Temporary password"
          autoComplete="current-password"
          value={current}
          onChange={setCurrent}
          maxLength={128}
          required
        />

        <PasswordField
          label="New password"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}"
          title="Use an uppercase letter, a lowercase letter and a digit."
          hint="At least 8 characters, with an upper-case letter, a lower-case letter and a digit."
          value={next}
          onChange={setNext}
          required
        />

        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          value={confirm}
          onChange={setConfirm}
          required
        />

        <button className="btn w-full" disabled={busy}>
          {busy ? 'Saving...' : 'Set password and sign in again'}
        </button>
      </form>
    </div>
  );
}
