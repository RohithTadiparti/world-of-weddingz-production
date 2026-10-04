import { FormEvent, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';

/**
 * Where a provider's payout setup stands, as the server reports it.
 *
 * The badge is driven from `status` and nothing else: a form that shows
 * "Pending verification" because it was just submitted, or "Verified" because
 * an id happens to be present, says something the server never said.
 */
export interface PayoutAccountView {
  payoutAccountId: string | null;
  status: 'not_set_up' | 'pending_verification' | 'active';
  bankAccount: {
    accountHolderName: string;
    bankName: string;
    accountType: string;
    accountNumberMasked: string;
    ifsc: string;
    branch: string;
    status: 'pending_verification' | 'linked';
    submittedAt: string;
  } | null;
}

type PayoutFormState = {
  accountHolderName: string;
  bankName: string;
  accountType: '' | 'savings' | 'current';
  accountNumber: string;
  confirmAccountNumber: string;
  ifscCode: string;
};

type IfscDetails = {
  ifsc: string;
  bankName: string;
  branch: string;
  address: string;
  city: string;
  state: string;
  pinCode: string;
};

const emptyForm = (): PayoutFormState => ({
  accountHolderName: '',
  bankName: '',
  accountType: '',
  accountNumber: '',
  confirmAccountNumber: '',
  ifscCode: '',
});

const STATUS_LABEL: Record<PayoutAccountView['status'], string> = {
  not_set_up: 'Not set up',
  pending_verification: 'Pending verification',
  active: 'Active',
};

const STATUS_CLASS: Record<PayoutAccountView['status'], string> = {
  not_set_up: 'bg-slate-100 text-slate-700',
  pending_verification: 'bg-amber-50 text-amber-800',
  active: 'bg-emerald-50 text-emerald-800',
};

const ACCOUNT_TYPE_LABEL: Record<string, string> = { savings: 'Savings', current: 'Current' };

/**
 * Where a provider's money leaves escrow to.
 *
 * Lives on Accounts alongside the rest of the payment picture (EZ1-I100) rather
 * than inside My Business, which is only about the shop window.
 *
 * Takes the whole endpoint rather than an id, because the two providers
 * address their listing differently: a vendor may own several and names the
 * one being paid, a planner has exactly one and says "me" (council round 2).
 *
 * Two ways in: bank details, which the server checks and holds until a gateway
 * linked account exists for them, or the linked account id itself for a
 * provider who already has one.
 */
function PayoutAccount({ endpoint, view }: { endpoint: string; view: PayoutAccountView | null }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'read' | 'bank' | 'linked'>('read');
  const [form, setForm] = useState<PayoutFormState>(emptyForm());
  const [linkedId, setLinkedId] = useState(view?.payoutAccountId ?? '');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof PayoutFormState, string>>>({});
  const [banks, setBanks] = useState<string[]>([]);
  const [bankSelected, setBankSelected] = useState(false);
  const [bankSearch, setBankSearch] = useState('');
  const [showBanks, setShowBanks] = useState(false);
  const [ifscDetails, setIfscDetails] = useState<IfscDetails | null>(null);
  const [ifscBusy, setIfscBusy] = useState(false);
  const [accountVisible, setAccountVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);

  const status = view?.status ?? 'not_set_up';
  const bank = view?.bankAccount ?? null;

  useEffect(() => setLinkedId(view?.payoutAccountId ?? ''), [view?.payoutAccountId]);

  useEffect(() => {
    void api
      .get<string[]>('/vendors/payout/banks')
      .then(({ data }) => setBanks(data))
      .catch(() => setBanks([]));
  }, []);

  function updateField(field: keyof PayoutFormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    if (field === 'ifscCode') setIfscDetails(null);
  }

  async function lookupIfsc() {
    const ifsc = form.ifscCode.trim().toUpperCase();
    setIfscDetails(null);
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
      setFieldErrors((prev) => ({ ...prev, ifscCode: 'Enter a valid IFSC code.' }));
      return;
    }
    setIfscBusy(true);
    try {
      const { data } = await api.get<IfscDetails>(`/vendors/payout/ifsc/${ifsc}`, {
        params: { bankName: form.bankName || undefined },
      });
      setIfscDetails(data);
      setForm((prev) => ({ ...prev, bankName: data.bankName, ifscCode: data.ifsc }));
      setBankSelected(true);
      setFieldErrors((prev) => ({ ...prev, ifscCode: undefined, bankName: undefined }));
    } catch (err) {
      setFieldErrors((prev) => ({ ...prev, ifscCode: apiMessage(err, 'Invalid IFSC code or bank mismatch.') }));
    } finally {
      setIfscBusy(false);
    }
  }

  function validate() {
    const nextErrors: Partial<Record<keyof PayoutFormState, string>> = {};
    const holder = form.accountHolderName.trim();
    const bankName = form.bankName.trim();
    const digits = form.accountNumber.replace(/\s+/g, '');
    const confirmDigits = form.confirmAccountNumber.replace(/\s+/g, '');
    const ifsc = form.ifscCode.trim();

    if (!holder) nextErrors.accountHolderName = 'Account holder name is required.';
    if (!bankName) nextErrors.bankName = 'Select a supported bank.';
    else if (!bankSelected || (banks.length > 0 && !banks.some((supported) => supported.toLowerCase() === bankName.toLowerCase()))) nextErrors.bankName = 'Select a supported bank from the list.';
    if (!form.accountType) nextErrors.accountType = 'Select an account type.';
    if (!digits) nextErrors.accountNumber = 'Account number is required.';
    else if (!/^\d{9,18}$/.test(digits)) nextErrors.accountNumber = 'Enter a valid account number.';
    if (!confirmDigits) nextErrors.confirmAccountNumber = 'Confirm account number.';
    else if (digits !== confirmDigits) nextErrors.confirmAccountNumber = 'Account numbers do not match.';
    if (!ifsc) nextErrors.ifscCode = 'IFSC code is required.';
    else if (!ifscDetails || ifscDetails.ifsc !== ifsc || ifscDetails.bankName.toLowerCase() !== bankName.toLowerCase()) nextErrors.ifscCode = 'Verify the IFSC code and bank match.';

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function send(body: Record<string, unknown>, done: string) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await api.put(endpoint, body);
      await qc.invalidateQueries({ queryKey: ['payout-account'] });
      await qc.invalidateQueries({ queryKey: ['my-listing'] });
      await qc.invalidateQueries({ queryKey: ['earnings'] });
      setMode('read');
      setForm(emptyForm());
      setIfscDetails(null);
      setBankSelected(false);
      setNotice(done);
    } catch (err) {
      setError(apiMessage(err, 'That could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveBank(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    await send(
      {
        bankAccount: {
          accountHolderName: form.accountHolderName.trim(),
          bankName: form.bankName.trim(),
          accountType: form.accountType,
          accountNumber: form.accountNumber.replace(/\s+/g, ''),
          ifsc: form.ifscCode.trim().toUpperCase(),
        },
      },
      'Bank details saved. Payouts start once they are verified and linked; until then what you earn is held as owed.',
    );
  }

  async function saveLinked(e: FormEvent) {
    e.preventDefault();
    await send(
      { payoutAccountId: linkedId.trim() },
      linkedId.trim()
        ? 'Saved. Anything already owed to you goes out on the next payout run.'
        : 'Cleared. Payouts will be held until you add an account.',
    );
  }

  async function clearAll() {
    if (!window.confirm('Remove this payout account? Payouts will be held until you add one again.')) return;
    await send({ payoutAccountId: '' }, 'Cleared. Payouts will be held until you add an account.');
  }

  const filteredBanks = banks.filter((name) => name.toLowerCase().includes(bankSearch.trim().toLowerCase()));
  const formValid = Boolean(
    form.accountHolderName.trim() &&
      form.bankName &&
      (banks.length === 0 || banks.some((name) => name.toLowerCase() === form.bankName.toLowerCase())) &&
      form.accountType &&
      /^\d{9,18}$/.test(form.accountNumber) &&
      form.accountNumber === form.confirmAccountNumber &&
      ifscDetails &&
      ifscDetails.ifsc === form.ifscCode &&
      bankSelected &&
      ifscDetails.bankName.toLowerCase() === form.bankName.toLowerCase(),
  );

  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="section-title">Payout Account</h2>
        <p className="text-sm text-gray-600">
          Where money leaves escrow to. Until it is active, what you have earned is held as owed rather than paid.
        </p>
      </div>
      <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATUS_CLASS[status]}`}>
        {STATUS_LABEL[status]}
      </span>
    </div>
  );

  const messages = (
    <>
      {error && <p className="alert-critical">{error}</p>}
      {notice && <p className="rounded-sm bg-emerald-50 p-2 text-sm text-emerald-700">{notice}</p>}
    </>
  );

  if (mode === 'linked') {
    return (
      <div className="card space-y-4">
        {header}
        <form onSubmit={saveLinked} className="space-y-3">
          <label className="block text-sm text-gray-700">
            <span className="mb-1 block">Linked account ID</span>
            <input
              className="input font-mono"
              placeholder="acc_XXXXXXXXXXXX"
              value={linkedId}
              onChange={(e) => setLinkedId(e.target.value)}
            />
            <span className="mt-1 block text-xs text-gray-500">
              The payment gateway's linked account for this listing, if you already have one. Leave it empty to clear it.
            </span>
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-outline" onClick={() => setMode('read')}>
              Cancel
            </button>
            <button className="btn" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
        {messages}
      </div>
    );
  }

  if (mode === 'read') {
    return (
      <div className="card space-y-4">
        {header}
        {bank || view?.payoutAccountId ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
              {bank && (
                <>
                  <div>
                    <div className="text-gray-500">Bank</div>
                    <div className="font-medium text-gray-900">{bank.bankName}</div>
                    <div className="text-xs text-gray-500">
                      {ACCOUNT_TYPE_LABEL[bank.accountType] ?? bank.accountType} account · {bank.accountHolderName}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Account number</div>
                    <div className="font-mono text-gray-900">{bank.accountNumberMasked}</div>
                  </div>
                  <div>
                    <div className="text-gray-500">IFSC code</div>
                    <div className="font-mono text-gray-900">{bank.ifsc}</div>
                    {bank.branch && <div className="text-xs text-gray-500">{bank.branch}</div>}
                  </div>
                </>
              )}
              <div>
                <div className="text-gray-500">Linked account ID</div>
                <div className="font-mono text-gray-900">{view?.payoutAccountId ?? 'Not linked yet'}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-[120px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-center">
            <div>
              <div className="text-lg font-medium text-gray-700">No payout account added</div>
              <div className="mt-1 text-sm text-gray-500">Add your bank account to receive payouts.</div>
            </div>
          </div>
        )}

        {status === 'pending_verification' && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Your bank details are waiting to be verified and linked. Payouts are held as owed until then.
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-outline" onClick={() => setMode('linked')}>
            {view?.payoutAccountId ? 'Change linked account ID' : 'I have a linked account ID'}
          </button>
          {(bank || view?.payoutAccountId) && (
            <button type="button" className="btn-outline text-critical-fg" disabled={busy} onClick={() => void clearAll()}>
              Remove
            </button>
          )}
          <button type="button" className="btn" onClick={() => setMode('bank')}>
            {bank ? 'Update bank details' : '+ Add bank account'}
          </button>
        </div>
        {messages}
      </div>
    );
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="section-title">Payout Account</h2>
          <p className="text-sm text-gray-600">Add your bank account details to receive payouts.</p>
        </div>
        <button type="button" className="btn-outline" onClick={() => setMode('read')}>
          Cancel
        </button>
      </div>

      <form onSubmit={saveBank} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm text-gray-700">
            <span className="mb-1 block">Account Holder Name</span>
            <input
              className={`input ${fieldErrors.accountHolderName ? 'border-red-300' : ''}`}
              value={form.accountHolderName}
              onChange={(e) => updateField('accountHolderName', e.target.value)}
            />
            {fieldErrors.accountHolderName && <span className="mt-1 block text-xs text-red-600">{fieldErrors.accountHolderName}</span>}
          </label>

          <div className="relative text-sm text-gray-700">
            <span className="mb-1 block">Bank Name</span>
            <input
              className={`input ${fieldErrors.bankName ? 'border-red-300' : ''}`}
              placeholder="Search supported banks"
              value={bankSearch || form.bankName}
              readOnly={Boolean(ifscDetails)}
              onFocus={() => setShowBanks(true)}
              onChange={(e) => {
                setBankSearch(e.target.value);
                setBankSelected(false);
                setShowBanks(true);
              }}
              onBlur={() => window.setTimeout(() => setShowBanks(false), 150)}
              autoComplete="off"
            />
            {showBanks && (
              <div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
                {filteredBanks.map((name) => (
                  <button
                    type="button"
                    key={name}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onMouseDown={() => {
                      updateField('bankName', name);
                      setBankSelected(true);
                      setBankSearch('');
                      setShowBanks(false);
                      setIfscDetails(null);
                    }}
                  >
                    {name}
                  </button>
                ))}
                {filteredBanks.length === 0 && (
                  <div className="px-3 py-2 text-sm text-gray-500">
                    {banks.length === 0 ? 'Verify your IFSC code to fill in the bank.' : 'No supported banks found.'}
                  </div>
                )}
              </div>
            )}
            {fieldErrors.bankName && <span className="mt-1 block text-xs text-red-600">{fieldErrors.bankName}</span>}
          </div>

          <label className="text-sm text-gray-700">
            <span className="mb-1 block">Account Type</span>
            <select
              className="input"
              value={form.accountType}
              onChange={(e) => updateField('accountType', e.target.value as PayoutFormState['accountType'])}
            >
              <option value="">Select Account Type</option>
              <option value="savings">Savings</option>
              <option value="current">Current</option>
            </select>
            {fieldErrors.accountType && <span className="mt-1 block text-xs text-red-600">{fieldErrors.accountType}</span>}
          </label>

          <label className="text-sm text-gray-700 md:col-span-2">
            <span className="mb-1 block">Account Number</span>
            <input
              className={`input ${fieldErrors.accountNumber ? 'border-red-300' : ''}`}
              type={accountVisible ? 'text' : 'password'}
              autoComplete="off"
              value={form.accountNumber}
              onChange={(e) => updateField('accountNumber', e.target.value.replace(/\D/g, ''))}
            />
            <button type="button" className="mt-1 text-xs text-sky-700 underline" onClick={() => setAccountVisible((visible) => !visible)}>{accountVisible ? 'Hide' : 'Show'} account number</button>
            {fieldErrors.accountNumber && <span className="mt-1 block text-xs text-red-600">{fieldErrors.accountNumber}</span>}
          </label>

          <label className="text-sm text-gray-700 md:col-span-2">
            <span className="mb-1 block">Confirm Account Number</span>
            <input
              className={`input ${fieldErrors.confirmAccountNumber ? 'border-red-300' : ''}`}
              type={confirmVisible ? 'text' : 'password'}
              autoComplete="off"
              value={form.confirmAccountNumber}
              onChange={(e) => updateField('confirmAccountNumber', e.target.value.replace(/\D/g, ''))}
            />
            <button type="button" className="mt-1 text-xs text-sky-700 underline" onClick={() => setConfirmVisible((visible) => !visible)}>{confirmVisible ? 'Hide' : 'Show'} confirmation</button>
            {fieldErrors.confirmAccountNumber && <span className="mt-1 block text-xs text-red-600">{fieldErrors.confirmAccountNumber}</span>}
          </label>

          <label className="text-sm text-gray-700 md:col-span-2">
            <span className="mb-1 block">IFSC Code</span>
            <input
              className={`input uppercase ${fieldErrors.ifscCode ? 'border-red-300' : ''}`}
              value={form.ifscCode}
              onChange={(e) => updateField('ifscCode', e.target.value.toUpperCase())}
            />
            <button type="button" className="mt-1 text-xs text-sky-700 underline disabled:text-gray-400" onClick={() => void lookupIfsc()} disabled={ifscBusy}>
              {ifscBusy ? 'Verifying IFSC...' : 'Verify IFSC'}
            </button>
            {fieldErrors.ifscCode && <span className="mt-1 block text-xs text-red-600">{fieldErrors.ifscCode}</span>}
          </label>
        </div>

        {ifscDetails && (
          <div className="grid gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm md:grid-cols-2">
            {(['bankName', 'branch', 'address', 'city', 'state', 'pinCode'] as const).map((key) => (
              <label key={key} className="text-gray-700">
                <span className="mb-1 block capitalize">{key === 'pinCode' ? 'PIN Code' : key.replace(/([A-Z])/g, ' $1')}</span>
                <input className="input bg-white" value={ifscDetails[key]} readOnly />
              </label>
            ))}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-outline" onClick={() => setMode('read')}>
            Cancel
          </button>
          <button className="btn disabled:cursor-not-allowed disabled:bg-slate-200" disabled={!formValid || ifscBusy || busy}>
            {busy ? 'Saving…' : 'Save bank details'}
          </button>
        </div>
      </form>

      {messages}
    </div>
  );
}

export default PayoutAccount;
