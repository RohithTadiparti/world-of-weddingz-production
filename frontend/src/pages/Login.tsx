import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AxiosError } from 'axios';
import { api, apiMessage } from '../lib/api';
import { motion, useReducedMotion } from 'motion/react';
import { CircleNotch, WarningCircle } from '@phosphor-icons/react';
import { useAuth } from '../store/auth';
import SupportContact from '../components/SupportContact';
import PasswordField from '../components/PasswordField';
import OtpSignIn from '../components/OtpSignIn';

export default function Login() {
  const nav = useNavigate();
  const location = useLocation();
  const setAuth = useAuth((s) => s.setAuth);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  /** Flipped once the server tells us this account has two-factor on. */
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  /**
   * Which way in (EZ1-I258).
   *
   * Email and password stays the default: it is what every existing account
   * already uses and nothing about it has changed. The number is offered
   * underneath, for the families an agent took on over the phone.
   */
  const [byMobile, setByMobile] = useState(false);
  const reduce = useReducedMotion();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', {
        email,
        password,
        ...(needsMfa ? { mfaCode } : {}),
      });
      setAuth(data);
      nav('/');
    } catch (err) {
      // The global filter nests the thrown payload under 'error', which is
      // where the challenge code lands -- never at the top level (council review).
      const body = (err as AxiosError<{ error?: { code?: string } }>).response?.data?.error;
      if (body?.code === 'MFA_REQUIRED') {
        // Not an error the user caused: ask for the second factor instead.
        setNeedsMfa(true);
        setError('');
      } else {
        setError(apiMessage(err, 'Invalid email or password.'));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    /*
     * A split. The form sits left at a comfortable reading width; the right
     * half is the only place in the whole application where the product gets
     * to say what it is for before asking for anything.
     *
     * Below `lg` the panel is dropped rather than stacked. A photograph above
     * a sign-in form on a phone is a photograph somebody scrolls past to reach
     * the thing they opened the page to do.
     */
    <div className="grid min-h-[100dvh] lg:grid-cols-[minmax(0,1fr)_1.1fr]">
      <div className="flex items-center justify-center px-6 py-12 sm:px-10">
        {/*
          A div rather than a form, because there are two forms here now: the
          password one below and the code one inside OtpSignIn, and a form
          nested in a form is not markup any browser agrees about (EZ1-I258).
        */}
        <motion.div
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-[22rem]"
        >
          <Link to="/" className="mb-10 block font-serif text-[1.35rem] uppercase tracking-[0.2em] text-brand">
            World of Weddingz
          </Link>

          <h1 className="font-serif text-[2.75rem] font-light leading-[1.05] text-brand">Welcome back</h1>
          {location.state?.passwordChanged === true && (
            <p role="status" className="rounded-sm bg-brand-light p-3 text-sm text-brand-dark">
              Password changed successfully. Sign in with your new password.
            </p>
          )}
          <p className="page-subtitle mb-8">
            Sign in to pick up where your family left off.
          </p>

          {byMobile ? (
            <OtpSignIn onUsePassword={() => setByMobile(false)} onSignedIn={() => nav('/')} />
          ) : (
            <form onSubmit={submit}>
          {error && (
            <p
              role="alert"
              className="mb-5 flex items-start gap-2 rounded-md bg-critical-bg px-3 py-2.5 text-sm text-critical-fg"
            >
              <WarningCircle size={17} className="mt-px shrink-0" aria-hidden />
              {error}
            </p>
          )}

          <div className="space-y-4">
            <div>
              <label className="label" htmlFor="email">
                Email or mobile number
              </label>
              {/*
                `type="text"`, not `type="email"`: a client an agency took on by
                phone signs in with the number they gave them, and the browser's
                own email validation refused it before the form could be
                submitted (EZ1-I233). `autoComplete="username"` covers both.
              */}
              <input
                id="email"
                className="input"
                type="text"
                inputMode="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <PasswordField
              label="Password"
              value={password}
              onChange={setPassword}
              autoComplete="current-password"
              labelAside={
                <Link
                  className="text-[0.8125rem] text-gray-500 underline-offset-2 transition-colors hover:text-brand-strong hover:underline"
                  to="/forgot-password"
                >
                  Forgot?
                </Link>
              }
            />

            {needsMfa && (
              <div>
                <label className="label" htmlFor="mfaCode">
                  Authentication code
                </label>
                <input
                  id="mfaCode"
                  className="input font-mono tracking-[0.35em]"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  autoFocus
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  required
                />
                <p className="mt-1.5 text-xs text-gray-500">
                  Open your authenticator app and enter the current 6-digit code.
                </p>
              </div>
            )}
          </div>

          <button className="btn mt-6 w-full" disabled={loading}>
            {loading && (
              <CircleNotch size={16} className="animate-spin" aria-hidden />
            )}
            {loading ? 'Signing in' : 'Sign in'}
          </button>

          {/* Offered, not defaulted to — and hidden mid-MFA, where the account
              is already half signed in. */}
          {!needsMfa && (
            <button
              type="button"
              className="btn-ghost btn-sm mt-2 w-full"
              onClick={() => {
                setByMobile(true);
                setError('');
              }}
            >
              Sign in with a mobile number instead
            </button>
          )}
            </form>
          )}

          <p className="mt-6 text-center text-sm text-gray-500">
            No account?{' '}
            <Link
              className="font-medium text-brand-strong underline-offset-2 hover:underline"
              to="/register"
            >
              Register
            </Link>
          </p>

          {/*
            Here rather than only inside the app.

            Somebody who cannot get past this screen is exactly the person who
            needs a phone number, and a contact address visible only after
            signing in is no use to them. Renders nothing when no channel is
            configured, so it never leaves a dead heading behind.
          */}
          <div className="mt-4 border-t border-gray-100 pt-4">
            <SupportContact compact />
          </div>
        </motion.div>
      </div>

      {/*
        The right half, in the matrimony home template's manner: the ivory
        ground and the app-wide field of gold hearts, a gold rule, and one line
        in the serif. It replaces a blurred stock photograph that was only ever a
        placeholder for a brand image nobody had.
      */}
      <div className="relative hidden overflow-hidden border-l border-gray-200 lg:flex lg:items-end">
        <div className="p-12 xl:p-16">
          <span aria-hidden className="mb-7 block h-px w-16 bg-gold" />
          <p className="plate max-w-[20ch] font-serif text-[2.75rem] font-light italic leading-[1.2] text-brand">
            Every family deserves to know who they are talking to.
          </p>
          <p className="plate mt-6 max-w-[40ch] text-[0.9375rem] leading-relaxed text-gray-700">
            A conversation opens only once both families agree to it.
          </p>
        </div>
      </div>
    </div>
  );
}
