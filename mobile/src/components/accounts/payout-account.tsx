import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';

import { api, apiMessage } from '@/lib/api';
import { Badge } from '@/components/chrome';
import { PromptSheet } from '@/components/prompt';
import { Alert, Body, Button, Card, Field, SectionTitle } from '@/components/ui';
import { space } from '@/theme';

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

const STATUS_TONE = {
  not_set_up: 'neutral',
  pending_verification: 'caution',
  active: 'positive',
} as const;

const ACCOUNT_TYPE_LABEL: Record<string, string> = { savings: 'Savings', current: 'Current' };

/**
 * Where a provider's money leaves escrow to. The web client's PayoutAccount
 * is the same form; the reasoning in its comments applies here too.
 *
 * Two ways in: bank details, which the server checks and holds until a gateway
 * linked account exists for them, or the linked account id itself for a
 * provider who already has one.
 */
export function PayoutAccount({ endpoint, view }: { endpoint: string; view: PayoutAccountView | null }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'read' | 'bank' | 'linked'>('read');
  const [form, setForm] = useState<PayoutFormState>(emptyForm());
  const [linkedId, setLinkedId] = useState(view?.payoutAccountId ?? '');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof PayoutFormState, string>>>({});
  const [banks, setBanks] = useState<string[]>([]);
  const [bankSelected, setBankSelected] = useState(false);
  const [bankSearch, setBankSearch] = useState('');
  const [showBanks, setShowBanks] = useState(false);
  const [showAccountTypes, setShowAccountTypes] = useState(false);
  const [ifscDetails, setIfscDetails] = useState<IfscDetails | null>(null);
  const [ifscBusy, setIfscBusy] = useState(false);
  const [accountVisible, setAccountVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);

  const status = view?.status ?? 'not_set_up';
  const bank = view?.bankAccount ?? null;

  useEffect(() => setLinkedId(view?.payoutAccountId ?? ''), [view?.payoutAccountId]);

  useEffect(() => {
    void api.get<string[]>('/vendors/payout/banks').then(({ data }) => setBanks(data)).catch(() => setBanks([]));
  }, []);

  const updateField = (field: keyof PayoutFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => ({ ...prev, [field]: undefined }));
    if (field === 'ifscCode') setIfscDetails(null);
  };

  const lookupIfsc = async () => {
    const ifsc = form.ifscCode.trim().toUpperCase();
    setIfscDetails(null);
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
      setFieldErrors((prev) => ({ ...prev, ifscCode: 'Enter a valid IFSC code.' }));
      return;
    }
    setIfscBusy(true);
    try {
      const { data } = await api.get<IfscDetails>(`/vendors/payout/ifsc/${ifsc}`, { params: { bankName: form.bankName || undefined } });
      setIfscDetails(data);
      setForm((prev) => ({ ...prev, bankName: data.bankName, ifscCode: data.ifsc }));
      setBankSelected(true);
      setFieldErrors((prev) => ({ ...prev, ifscCode: undefined, bankName: undefined }));
    } catch (err) {
      setFieldErrors((prev) => ({ ...prev, ifscCode: apiMessage(err, 'Invalid IFSC code or bank mismatch.') }));
    } finally {
      setIfscBusy(false);
    }
  };

  const validate = () => {
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
  };

  async function send(body: Record<string, unknown>, done: string) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await api.put(endpoint, body);
      await Promise.all(
        ['payout-account', 'my-listing', 'earnings', 'vendor-me', 'planner-me'].map((key) =>
          qc.invalidateQueries({ queryKey: [key] }),
        ),
      );
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

  const saveBank = async () => {
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
  };

  const saveLinked = () =>
    send(
      { payoutAccountId: linkedId.trim() },
      linkedId.trim()
        ? 'Saved. Anything already owed to you goes out on the next payout run.'
        : 'Cleared. Payouts will be held until you add an account.',
    );

  const filteredBanks = banks.filter((name) => name.toLowerCase().includes(bankSearch.trim().toLowerCase()));
  const formValid = Boolean(
    form.accountHolderName.trim() && form.bankName && (banks.length === 0 || banks.some((name) => name.toLowerCase() === form.bankName.toLowerCase())) &&
      form.accountType && /^\d{9,18}$/.test(form.accountNumber) && form.accountNumber === form.confirmAccountNumber &&
      bankSelected && ifscDetails && ifscDetails.ifsc === form.ifscCode && ifscDetails.bankName.toLowerCase() === form.bankName.toLowerCase(),
  );

  const messages = (
    <>
      {error ? <Alert tone="critical">{error}</Alert> : null}
      {notice ? <Alert tone="positive">{notice}</Alert> : null}
    </>
  );

  if (mode === 'linked') {
    return (
      <Card style={{ gap: space(3) }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space(2) }}>
          <SectionTitle>Payout Account</SectionTitle>
          <Button label="Cancel" variant="outline" small onPress={() => setMode('read')} />
        </View>
        <Field
          label="Linked account ID"
          placeholder="acc_XXXXXXXXXXXX"
          value={linkedId}
          autoCapitalize="none"
          onChangeText={setLinkedId}
        />
        <Body tone="muted">
          The payment gateway's linked account for this listing, if you already have one. Leave it empty to clear it.
        </Body>
        <Button label="Save" busy={busy} onPress={() => void saveLinked()} />
        {messages}
      </Card>
    );
  }

  if (mode === 'read') {
    return (
      <Card style={{ gap: space(3) }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space(2) }}>
          <SectionTitle>Payout Account</SectionTitle>
          <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
        </View>

        {bank || view?.payoutAccountId ? (
          <View style={{ gap: space(1.5), borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', padding: space(3) }}>
            {bank ? (
              <>
                <Body>{bank.bankName}</Body>
                <Body tone="muted">
                  {ACCOUNT_TYPE_LABEL[bank.accountType] ?? bank.accountType} account · {bank.accountHolderName}
                </Body>
                <Body tone="muted">Account number: {bank.accountNumberMasked}</Body>
                <Body tone="muted">
                  IFSC: {bank.ifsc}
                  {bank.branch ? ` · ${bank.branch}` : ''}
                </Body>
              </>
            ) : null}
            <Body tone="muted">Linked account ID: {view?.payoutAccountId ?? 'Not linked yet'}</Body>
          </View>
        ) : (
          <View style={{ minHeight: 120, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F9FAFB', borderRadius: 12, borderWidth: 1, borderColor: '#E5E7EB', padding: space(4) }}>
            <Body style={{ textAlign: 'center' }}>No payout account added</Body>
            <Body tone="muted" style={{ textAlign: 'center' }}>Add your bank account to receive payouts.</Body>
          </View>
        )}

        {status === 'pending_verification' ? (
          <Alert tone="caution">Your bank details are waiting to be verified and linked. Payouts are held as owed until then.</Alert>
        ) : null}

        <Button label={bank ? 'Update bank details' : 'Add bank account'} small onPress={() => setMode('bank')} />
        <Button
          label={view?.payoutAccountId ? 'Change linked account ID' : 'I have a linked account ID'}
          variant="outline"
          small
          onPress={() => setMode('linked')}
        />
        {bank || view?.payoutAccountId ? (
          <Button label="Remove" variant="ghost" small disabled={busy} onPress={() => setConfirmingClear(true)} />
        ) : null}

        {messages}

        <PromptSheet
          visible={confirmingClear}
          title="Remove payout account?"
          message="Payouts will be held until you add one again."
          confirmLabel="Remove"
          input={false}
          onCancel={() => setConfirmingClear(false)}
          onConfirm={() => {
            setConfirmingClear(false);
            void send({ payoutAccountId: '' }, 'Cleared. Payouts will be held until you add an account.');
          }}
        />
      </Card>
    );
  }

  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space(2) }}>
        <SectionTitle>Payout Account</SectionTitle>
        <Button label="Cancel" variant="outline" small onPress={() => setMode('read')} />
      </View>

      <View style={{ gap: space(2.5) }}>
        <Field label="Account holder name" value={form.accountHolderName} onChangeText={(value) => updateField('accountHolderName', value)} autoCapitalize="words" error={fieldErrors.accountHolderName} />
        <View style={{ gap: space(1.5) }}>
          <Field label="Bank name" placeholder="Search supported banks" value={bankSearch || form.bankName} editable={!ifscDetails} onFocus={() => setShowBanks(true)} onChangeText={(value) => { setBankSearch(value); setBankSelected(false); setShowBanks(true); }} autoCapitalize="words" error={fieldErrors.bankName} />
          {showBanks && (
            <View style={{ maxHeight: 180, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, backgroundColor: '#FFFFFF' }}>
              {filteredBanks.map((name) => (
                <Pressable
                  key={name}
                  onPress={() => {
                    updateField('bankName', name);
                    setBankSelected(true);
                    setBankSearch('');
                    setShowBanks(false);
                    setIfscDetails(null);
                  }}
                  style={{ padding: space(2) }}
                >
                  <Body>{name}</Body>
                </Pressable>
              ))}
              {filteredBanks.length === 0 ? (
                <Body tone="muted" style={{ padding: space(2) }}>
                  {banks.length === 0 ? 'Verify your IFSC code to fill in the bank.' : 'No supported banks found.'}
                </Body>
              ) : null}
            </View>
          )}
        </View>
        <View>
          <Pressable onPress={() => setShowAccountTypes((visible) => !visible)}>
            <Field label="Account type" placeholder="Select Account Type" value={ACCOUNT_TYPE_LABEL[form.accountType] ?? ''} editable={false} error={fieldErrors.accountType} />
          </Pressable>
          {showAccountTypes ? (
            <View style={{ borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, backgroundColor: '#FFFFFF' }}>
              {(['savings', 'current'] as const).map((type) => (
                <Pressable key={type} onPress={() => { updateField('accountType', type); setShowAccountTypes(false); }} style={{ padding: space(2) }}>
                  <Body>{ACCOUNT_TYPE_LABEL[type]}</Body>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space(2) }}>
          <View style={{ flex: 1 }}><Field label="Account number" value={form.accountNumber} secureTextEntry={!accountVisible} keyboardType="number-pad" onChangeText={(value) => updateField('accountNumber', value.replace(/\D/g, ''))} error={fieldErrors.accountNumber} /></View>
          <Button label={accountVisible ? 'Hide' : 'Show'} variant="outline" small onPress={() => setAccountVisible((visible) => !visible)} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space(2) }}>
          <View style={{ flex: 1 }}><Field label="Confirm account number" value={form.confirmAccountNumber} secureTextEntry={!confirmVisible} keyboardType="number-pad" onChangeText={(value) => updateField('confirmAccountNumber', value.replace(/\D/g, ''))} error={fieldErrors.confirmAccountNumber} /></View>
          <Button label={confirmVisible ? 'Hide' : 'Show'} variant="outline" small onPress={() => setConfirmVisible((visible) => !visible)} />
        </View>
        <View style={{ gap: space(1.5) }}>
          <Field label="IFSC code" value={form.ifscCode} autoCapitalize="characters" onChangeText={(value) => updateField('ifscCode', value.toUpperCase())} error={fieldErrors.ifscCode} />
          <Button label={ifscBusy ? 'Verifying IFSC...' : 'Verify IFSC'} variant="outline" small busy={ifscBusy} onPress={() => void lookupIfsc()} />
        </View>
        {ifscDetails ? (
          <View style={{ gap: space(2), padding: space(3), borderRadius: 8, borderWidth: 1, borderColor: '#A7F3D0', backgroundColor: '#ECFDF5' }}>
            {([['Bank Name', ifscDetails.bankName], ['Branch', ifscDetails.branch], ['Address', ifscDetails.address], ['City', ifscDetails.city], ['State', ifscDetails.state], ['PIN Code', ifscDetails.pinCode]] as const).map(([label, value]) => <Field key={label} label={label} value={value} editable={false} />)}
          </View>
        ) : null}
        <Button label="Save bank details" busy={busy} disabled={!formValid || ifscBusy} onPress={() => void saveBank()} />
      </View>

      {messages}
    </Card>
  );
}
