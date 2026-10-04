import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '@/lib/api';
import { Alert, Body, Button, Caption, Card, Field, PageSubtitle, PageTitle, Screen, SectionTitle } from '@/components/ui';
import { MediaStrip, PhotoPicker } from '@/components/uploader';

type Agency = { agencyName: string; registrationNumber?: string | null; contactPhone?: string | null; city?: string | null; address?: string | null; startDate?: string | null; about?: string | null; pictures?: string[]; isApproved: boolean; rejectionReason?: string | null };
type Form = { agencyName: string; registrationNumber: string; contactPhone: string; city: string; address: string; startDate: string; about: string };
const blank: Form = { agencyName: '', registrationNumber: '', contactPhone: '', city: '', address: '', startDate: '', about: '' };

/** The same agency record, approval state and ledger as the web Agency page. */
export default function AgentAgency() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(blank); const [pictures, setPictures] = useState<string[]>([]); const [message, setMessage] = useState('');
  const agency = useQuery({ queryKey: ['agent-agency'], queryFn: async () => (await api.get('/agents/agency')).data as Agency, retry: false });
  const verification = useQuery({ queryKey: ['my-verification'], queryFn: async () => (await api.get('/verification/me')).data as { status: string | null; remarks: string | null }, retry: false });
  const billing = useQuery({ queryKey: ['agent-billing'], queryFn: async () => (await api.get('/agents/billing')).data as { totals: Record<string, string>; charges: { id: string; type: string; amount: string; status: string }[] }, retry: false });
  const status = useQuery({ queryKey: ['agent-agency-status'], queryFn: async () => (await api.get('/agents/agency/status')).data as { shareLinkActive: boolean }, retry: false });
  useEffect(() => { const a = agency.data; if (a) { setForm({ agencyName: a.agencyName ?? '', registrationNumber: a.registrationNumber ?? '', contactPhone: a.contactPhone ?? '', city: a.city ?? '', address: a.address ?? '', startDate: a.startDate?.slice(0, 10) ?? '', about: a.about ?? '' }); setPictures(a.pictures ?? []); } }, [agency.data]);
  const save = useMutation({ mutationFn: async () => api.put('/agents/agency', { ...Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim())), pictures }), onSuccess: () => { setMessage('Agency details saved.'); void qc.invalidateQueries({ queryKey: ['agent-agency'] }); void qc.invalidateQueries({ queryKey: ['agent-agency-status'] }); }, onError: (e) => setMessage(apiMessage(e, 'Agency details could not be saved.')) });
  const share = useMutation({ mutationFn: async () => (await api.post('/agents/agency/share-link', {})).data as { url: string }, onSuccess: ({ url }) => { setMessage(`Share this client sign-up link: ${url}`); void qc.invalidateQueries({ queryKey: ['agent-agency-status'] }); }, onError: (e) => setMessage(apiMessage(e, 'A sign-up link could not be created.')) });
  const set = (key: keyof Form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const a = agency.data;
  return <Screen onRefresh={() => { void agency.refetch(); void billing.refetch(); }} refreshing={agency.isFetching}>
    <PageTitle>Your Agency</PageTitle><PageSubtitle>Keep your agency details, approval and client intake link in one place.</PageSubtitle>
    {message ? <Alert tone={message.includes('could not') ? 'critical' : 'positive'}>{message}</Alert> : null}
    {a && <Card><SectionTitle>{a.isApproved ? 'Approved' : verification.data?.status === 'rejected' ? 'Rejected' : 'Awaiting approval'}</SectionTitle><Caption tone="faint">{a.isApproved ? 'You can manage clients and send invitations.' : (verification.data?.remarks ?? a.rejectionReason ?? 'An administrator will review your agency before client invitations can be sent.')}</Caption></Card>}
    <Card><SectionTitle>Agency details</SectionTitle><Field label="Agency name" required value={form.agencyName} onChangeText={set('agencyName')} autoCapitalize="words" /><Field label="Registration number" value={form.registrationNumber} onChangeText={set('registrationNumber')} /><Field label="Mobile number" value={form.contactPhone} onChangeText={set('contactPhone')} keyboardType="phone-pad" /><Field label="City" value={form.city} onChangeText={set('city')} autoCapitalize="words" /><Field label="Office address" value={form.address} onChangeText={set('address')} multiline /><Field label="Trading since" value={form.startDate} onChangeText={set('startDate')} placeholder="YYYY-MM-DD" /><Field label="About your agency" value={form.about} onChangeText={set('about')} multiline /><Caption tone="faint">Office photographs help families recognise your agency.</Caption><MediaStrip urls={pictures} onRemove={(url) => setPictures((current) => current.filter((picture) => picture !== url))} /><PhotoPicker label="Add office photo" onUploaded={(url) => setPictures((current) => current.length < 10 ? [...current, url] : current)} /><Button label="Save agency" busy={save.isPending} disabled={form.agencyName.trim().length < 2} onPress={() => save.mutate()} /></Card>
    <Card><SectionTitle>Client sign-up link</SectionTitle><Caption tone="faint">{status.data?.shareLinkActive ? 'A link is active. Creating another withdraws the previous one.' : 'Create a link for a new client to register themselves.'}</Caption><Button label="Create and copy link" variant="outline" busy={share.isPending} onPress={() => share.mutate()} /></Card>
    <Card><SectionTitle>Your ledger</SectionTitle><Body>Owed: ₹{Number(billing.data?.totals.outstanding ?? 0).toLocaleString('en-IN')}</Body><Body>In escrow: ₹{Number(billing.data?.totals.inEscrow ?? 0).toLocaleString('en-IN')}</Body><Body>Earned: ₹{Number(billing.data?.totals.earned ?? 0).toLocaleString('en-IN')}</Body>{billing.data?.charges.slice(0, 5).map((charge) => <Caption key={charge.id} tone="faint">{charge.type.replace(/_/g, ' ')} · ₹{Number(charge.amount).toLocaleString('en-IN')} · {charge.status}</Caption>)}</Card>
  </Screen>;
}
