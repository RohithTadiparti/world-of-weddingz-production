import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { useAuth } from '../store/auth';
import PasswordField from '../components/PasswordField';
import type { AccountType } from '../lib/permissions';
import { EMAIL_PATTERN, MOBILE_10_PATTERN, NAME_PATTERN } from '../lib/permissions';
import { usernameRequired, validateUsername } from '../lib/vendor-listing-rules';

/**
 * Sign-up is a two-step choice: first *what kind of account*, then the details.
 * The account type decides which persona (and therefore which permission set)
 * the new account gets, so it is the first thing we ask for.
 *
 * Which types exist is the server's to say, not ours. GET /auth/account-types
 * mirrors the INDIVIDUAL_USER_ENABLED switch, so with Individual sign-up closed
 * the option is not offered at all rather than offered and then refused with a
 * 403 after the visitor has filled the whole form in (council review).
 */
interface AccountTypeOption {
  type: AccountType;
  label: string;
  description: string;
  /** Individual accounts additionally pick bride/groom/family. */
  requiresRole: boolean;
  roles?: string[];
}


const ROLE_LABELS: Record<string, string> = {
  bride: 'Bride',
  groom: 'Groom',
  family: 'Family member',
};

export default function Register() {
  const nav = useNavigate();
  const setAuth = useAuth((s) => s.setAuth);

  const { data: catalogue, isPending: typesPending } = useQuery<{
    individualUserEnabled: boolean;
    accountTypes: AccountTypeOption[];
  }>({
    queryKey: ['account-types'],
    queryFn: async () => (await api.get('/auth/account-types')).data,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const accountTypes = catalogue?.accountTypes ?? [];
  // Nothing is chosen until the visitor picks; until then the first type the
  // server offered stands in, so the default can never be a closed flow.
  const [chosenType, setChosenType] = useState<AccountType | null>(null);
  const [chosenRole, setChosenRole] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  // An individual gives first and last name separately, as the biodata asks
  // them; every other account type keeps one "Your name" box.
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const accountType: AccountType = chosenType ?? accountTypes[0]?.type ?? 'individual';
  const selected = accountTypes.find((a) => a.type === accountType);
  const roles = selected?.roles ?? [];
  const role = chosenRole && roles.includes(chosenRole) ? chosenRole : (roles[0] ?? 'bride');
  // Every account is reached on its mobile number — it is what an OTP goes to
  // and how the other side gets in touch — so it is required at sign-up for all
  // personas, not offered as an optional afterthought.
  const phoneRequired = true;
  const isIndividual = accountType === 'individual';
  const name = isIndividual
    ? [firstName.trim(), lastName.trim()].filter(Boolean).join(' ')
    : displayName.trim();

  /**
   * The same rules the server applies, checked before the round trip.
   *
   * Field-level and specific: "Enter a 10-digit mobile number" beats a single
   * banner saying the form is invalid, because it says which field and what to
   * do about it. The server still enforces all of this.
   */
  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    const digits = phone.replace(/\s|-/g, '').replace(/^\+91/, '');

    if (isIndividual) {
      const letters = 'A name may only contain letters and spaces';
      if (!firstName.trim()) errors.firstName = 'Enter your first name';
      else if (!NAME_PATTERN.test(firstName.trim())) errors.firstName = letters;
      if (!lastName.trim()) errors.lastName = 'Enter your last name';
      else if (!NAME_PATTERN.test(lastName.trim())) errors.lastName = letters;
    } else if (!name) errors.displayName = 'Enter your name';

    if (!EMAIL_PATTERN.test(email.trim())) errors.email = 'Enter a valid email address';
    // Optional for a vendor, who signs in with the email or mobile number
    // given here; still checked when one is typed.
    const usernameError = validateUsername(username, accountType);
    if (usernameError) errors.username = usernameError;

    if (phoneRequired && !digits) errors.phone = 'Enter your mobile number';
    else if (digits && !MOBILE_10_PATTERN.test(digits)) {
      errors.phone = 'Enter a 10-digit Indian mobile number, starting 6 to 9';
    }

    if (password.length < 8) errors.password = 'At least 8 characters';
    else if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
      errors.password = 'Needs an uppercase letter, a lowercase letter and a digit';
    }

    if (!confirm) errors.confirm = 'Type the password again';
    // The same words the app uses, so a vendor who signed up on one and is
    // being talked through the other is not told two different things.
    else if (confirm !== password) errors.confirm = 'Password and Confirm Password do not match.';

    return errors;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');

    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        email: email.trim(),
        password,
        accountType,
        displayName: name,
      };
      // Left out when blank: an optional username is not an empty one.
      if (username.trim()) payload.username = username.trim().toLowerCase();
      if (phone.trim()) payload.phone = phone.replace(/\s|-/g, '');
      // `role` is only meaningful where the server said the type needs one; it
      // derives the role from accountType for every other persona.
      if (selected?.requiresRole) payload.role = role;

      const { data } = await api.post('/auth/register', payload);
      setAuth(data);
      // Agents land on agency registration: nothing else works until an
      // administrator has approved them.
      if (accountType === 'agent') nav('/agency');
      else nav(accountType === 'individual' ? '/profile' : '/');
    } catch (err) {
      setError(apiMessage(err, 'Could not register. The email may already be in use.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative isolate min-h-screen overflow-hidden px-4 py-8 sm:px-8 sm:py-12">
      <div className="relative mx-auto grid w-full max-w-[100rem] overflow-hidden border border-gray-200 bg-surface shadow-lifted lg:grid-cols-[0.88fr_1.12fr]">
        <aside className="relative min-h-[28rem] overflow-hidden bg-brand-strong p-8 text-brand-fg sm:p-12">
          <img src="/images/wow-home-hero.webp" alt="A couple beginning a beautiful life together" fetchPriority="high" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
          <span aria-hidden className="absolute inset-0 bg-gradient-to-br from-brand-strong/95 via-brand-strong/65 to-brand/45" />
          <div className="relative flex h-full max-w-sm flex-col">
            <Link to="/" className="text-xs uppercase tracking-[0.28em] text-gold-lit hover:text-brand-fg">
              World of Weddingz
            </Link>
            <div className="my-auto py-14">
              <p className="text-xs uppercase tracking-[0.26em] text-gold-lit">Your first chapter</p>
              <h1 className="mt-5 font-serif text-[3.25rem] leading-[0.94] text-white sm:text-[4.25rem]">
                Begin with a profile that feels like you.
              </h1>
              <p className="mt-7 text-[0.9375rem] leading-[1.75] text-white/90">
                Start it yourself or with your family. You remain in control of what is shared and when a conversation begins.
              </p>
            </div>
            <p className="text-xs uppercase tracking-[0.2em] text-[rgb(var(--ink-100))]">Private · thoughtful · family-aware</p>
          </div>
        </aside>
        <form onSubmit={submit} className="relative space-y-6 p-6 sm:p-10 lg:p-12" noValidate>
        <div>
          <h2 className="page-title">Create your WOW account</h2>
          <p className="page-subtitle">
            Pick the kind of account you need. This decides what you can do on the platform, and
            you cannot change it later without contacting support.
          </p>
        </div>

        {error && <p className="alert-critical">{error}</p>}

        <fieldset>
          <legend className="label">I am joining as</legend>
          {typesPending && <p className="text-sm text-gray-500">Loading the account types…</p>}
          {!typesPending && accountTypes.length === 0 && (
            <p className="alert-critical">
              Sign-up is closed at the moment. Please try again later.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {accountTypes.map((opt, i) => {
              const active = opt.type === accountType;
              return (
                <button
                  type="button"
                  key={opt.type}
                  onClick={() => {
                    setChosenType(opt.type);
                    setChosenRole(null);
                  }}
                  aria-pressed={active}
                  className={`rounded-lg border p-3 text-left transition ${
                    active
                      ? 'border-brand bg-brand-light ring-1 ring-brand'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <span className="font-serif text-[1.75rem] leading-none text-gold" aria-hidden>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <p className="mt-2 font-serif text-[1.375rem] leading-tight text-brand">{opt.label}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{opt.description}</p>
                </button>
              );
            })}
          </div>
        </fieldset>

        {roles.length > 0 && (
          <fieldset>
            <legend className="label">Who is this profile for?</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {roles.map((r) => {
                const active = role === r;
                return (
                  <button
                    type="button"
                    key={r}
                    aria-pressed={active}
                    onClick={() => setChosenRole(r)}
                    className={`min-h-14 border px-3 text-left text-sm transition ${
                      active
                        ? 'border-brand bg-brand-soft text-brand-strong ring-1 ring-brand'
                        : 'border-gray-200 text-gray-700 hover:border-gold'
                    }`}
                  >
                    <span className="block font-serif text-lg leading-tight">{ROLE_LABELS[r] ?? r}</span>
                    <span className="mt-0.5 block text-xs text-gray-500">
                      {r === 'family' ? 'For a family member' : `For the ${ROLE_LABELS[r]?.toLowerCase() ?? r}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        {isIndividual && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="firstName">
                First name
              </label>
              <input
                id="firstName"
                className="input"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                maxLength={60}
                autoComplete="given-name"
                aria-invalid={Boolean(fieldErrors.firstName)}
              />
              {fieldErrors.firstName && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.firstName}</p>
              )}
            </div>
            <div>
              <label className="label" htmlFor="lastName">
                Last name
              </label>
              <input
                id="lastName"
                className="input"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                maxLength={60}
                autoComplete="family-name"
                aria-invalid={Boolean(fieldErrors.lastName)}
              />
              {fieldErrors.lastName && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.lastName}</p>
              )}
            </div>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {!isIndividual && (
            <div>
              <label className="label" htmlFor="displayName">
                Your name
              </label>
              <input
                id="displayName"
                className="input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={120}
                aria-invalid={Boolean(fieldErrors.displayName)}
              />
              {fieldErrors.displayName && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.displayName}</p>
              )}
            </div>
          )}
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={Boolean(fieldErrors.email)}
            />
            {fieldErrors.email && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.email}</p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="username">
              Username{' '}
              {!usernameRequired(accountType) && (
                <span className="font-normal text-gray-400">(optional)</span>
              )}
            </label>
            <input
              id="username"
              className="input"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              aria-invalid={Boolean(fieldErrors.username)}
            />
            {fieldErrors.username && <p className="mt-1 text-xs text-red-600">{fieldErrors.username}</p>}
          </div>
        </div>

        <div>
          <label className="label" htmlFor="phone">
            Mobile number{' '}
            {!phoneRequired && <span className="font-normal text-gray-400">(optional)</span>}
          </label>
          <input
            id="phone"
            className="input"
            inputMode="numeric"
            placeholder="9876543210"
            maxLength={13}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            aria-invalid={Boolean(fieldErrors.phone)}
          />
          {fieldErrors.phone ? (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.phone}</p>
          ) : (
            <p className="mt-1 text-xs text-gray-500">
              Ten digits, starting 6 to 9. The +91 is added for you.
            </p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <PasswordField
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            minLength={8}
            error={fieldErrors.password}
            hint="At least 8 characters, with an uppercase letter, a lowercase letter and a digit."
          />
          {/*
            Typed twice, because it is typed blind and used once.
            
            An account is created from a password nobody can read back, and the
            first time anybody discovers a typo is when they try to sign in and
            cannot — by which point the only way back is a reset email. The
            check is here and not on the server on purpose: the server never
            sees the second field, and it should not, because what is being
            checked is that the person typed what they meant, not anything
            about the account.
          */}
          <PasswordField
            label="Confirm password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            error={fieldErrors.confirm}
            hint="Type it again so a slip does not lock you out."
          />
        </div>

        <button className="btn w-full" disabled={loading || !selected}>
          {loading ? 'Creating...' : `Create ${selected ? `${selected.label.toLowerCase()} ` : ''}account`}
        </button>

        <p className="text-center text-sm text-gray-500">
          Have an account?{' '}
          <Link className="text-brand" to="/login">
            Sign in
          </Link>
        </p>
        </form>
      </div>
    </main>
  );
}
