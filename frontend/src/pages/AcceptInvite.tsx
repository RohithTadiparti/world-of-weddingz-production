import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';

interface InvitationPreview {
  displayName: string;
  /** Null when the invitation went out by SMS alone; email remains optional. */
  email: string | null;
  phoneHint: string | null;
  invitedBy: string;
  city: string | null;
  photoCount: number;
  expiresAt: string;
}

/**
 * Where an invited person lands from their email.
 *
 * The agent (or family member) who built the profile never sees this password:
 * the subject sets it here, which is the whole point of the invitation flow.
 * Accepting also verifies the email address, since following the link proved
 * control of it.
 */
export default function AcceptInvite() {
  const { token = '' } = useParams();
  const nav = useNavigate();
  const setAuth = useAuth((s) => s.setAuth);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [otpNotice, setOtpNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { data, isLoading, isError, error: previewError } = useQuery({
    queryKey: ['invitation', token],
    queryFn: async () => (await api.get(`/auth/invitations/${token}`)).data as InvitationPreview,
    retry: false,
    enabled: Boolean(token),
  });

  async function requestOtp() {
    setSendingOtp(true);
    setError('');
    setOtpNotice('');
    try {
      await api.post('/auth/invitations/send-otp', { token });
      setOtpSent(true);
      setOtpNotice('A 6-digit verification code has been sent to your mobile phone.');
    } catch (err) {
      setError(apiMessage(err, 'Failed to send verification code.'));
    } finally {
      setSendingOtp(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      /*
       * A mobile-only invitation carries no address. The person may add one
       * and it is optional; when the invitation already has an email it is
       * fixed and read-only. Sending an empty string would fail validation,
       * so an untouched field is omitted entirely (EZ1-I233).
       */
      const typed = email.trim();
      const payload: Record<string, unknown> = {
        token,
        password,
      };
      if (typed) payload.email = typed;
      if (otpCode.trim()) payload.otpCode = otpCode.trim();
      const res = await api.post('/auth/invitations/accept', payload);
      setAuth(res.data);
      nav('/profile');
    } catch (err) {
      setError(apiMessage(err, 'That invitation could not be accepted.'));
    } finally {
      setLoading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="text-gray-500">Checking your invitation…</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="card w-full max-w-md text-center">
          <p className="text-4xl" aria-hidden>
            ⌛
          </p>
          <h1 className="page-title mt-2">This invitation is not usable</h1>
          <p className="page-subtitle">
            {apiMessage(previewError, 'The link may have expired or already been used.')} Ask
            whoever invited you to send a new one.
          </p>
          <Link to="/login" className="btn mt-4">
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  const expires = new Date(data.expiresAt).toLocaleDateString();

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <form onSubmit={submit} className="card w-full max-w-md space-y-5">
        <div>
          <h1 className="page-title">Welcome, {data.displayName}</h1>
          <p className="page-subtitle">
            <strong>{data.invitedBy}</strong> has prepared a profile for you
            {data.city ? ` in ${data.city}` : ''}
            {data.photoCount > 0
              ? `, with ${data.photoCount} photo${data.photoCount === 1 ? '' : 's'}`
              : ''}
            . Choose a password to take ownership of it.
          </p>
        </div>

        <div className="rounded-lg bg-brand-light p-3 text-sm text-brand-dark">
          Once you accept, the profile is yours: only you can edit it, and{' '}
          <strong>{data.invitedBy}</strong> can no longer change it. This link expires on {expires}.
        </div>

        {error && <p className="alert-critical">{error}</p>}

        {data.email ? (
          <div>
            <label className="label">Your email</label>
            <input className="input bg-gray-50" value={data.email} readOnly disabled />
            <p className="mt-1 text-xs text-gray-500">
              You will sign in with this address. It is confirmed automatically by using this link.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="invited-mobile">Your mobile number</label>
              <div className="flex gap-2">
                <input id="invited-mobile" className="input bg-gray-50 flex-1" value={data.phoneHint ?? ''} readOnly />
                <button
                  type="button"
                  className="btn-outline shrink-0 text-xs px-3"
                  onClick={requestOtp}
                  disabled={sendingOtp}
                >
                  {sendingOtp ? 'Sending…' : otpSent ? 'Resend code' : 'Verify mobile (Send OTP)'}
                </button>
              </div>
              {otpNotice && <p className="mt-1 text-xs text-brand font-medium">{otpNotice}</p>}
              {!otpSent && (
                <p className="mt-1 text-xs text-gray-500">
                  Tap verify to receive a 6-digit code on your mobile.
                </p>
              )}
            </div>

            {otpSent && (
              <div>
                <label className="label" htmlFor="otp-code">
                  Verification code <span className="text-red-500">*</span>
                </label>
                <input
                  id="otp-code"
                  className="input"
                  type="text"
                  maxLength={6}
                  placeholder="6-digit code"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                  required
                />
              </div>
            )}

            <div>
              <label className="label" htmlFor="email">
                Your email <span className="font-normal text-gray-500">(optional)</span>
              </label>
              <input
                id="email"
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-500">
                You were invited by text message to {data.phoneHint}. Email is optional.
              </p>
            </div>
          </div>
        )}

        <div>
          <label className="label" htmlFor="password">
            Choose a password
          </label>
          <input
            id="password"
            className="input"
            type="password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <p className="mt-1 text-xs text-gray-500">
            At least 8 characters, with an uppercase letter, a lowercase letter and a digit.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="confirm">
            Confirm password
          </label>
          <input
            id="confirm"
            className="input"
            type="password"
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>

        {/*
          An SMS-only invitation cannot be accepted without the code, so the
          button waits for one to be requested rather than failing on the server.
        */}
        <button
          className="btn w-full"
          disabled={loading || (!data.email && (!otpSent || otpCode.length !== 6))}
        >
          {loading ? 'Setting up your account…' : 'Accept and create my account'}
        </button>

        <p className="text-center text-sm text-gray-500">
          Not you?{' '}
          <Link className="text-brand" to="/register">
            Create your own account instead
          </Link>
        </p>
      </form>
    </div>
  );
}
