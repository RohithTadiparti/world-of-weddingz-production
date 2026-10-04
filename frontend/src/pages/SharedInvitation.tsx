import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { formatDate } from '../lib/dates';
import { Loading } from '../components/ui/Feedback';

/** The invitation somebody was forwarded. */
interface Invitation {
  eventName: string;
  eventDate: string | null;
  startTime: string | null;
  venue: string | null;
  venueAddress: string | null;
  city: string | null;
  hostName: string;
  cardUrl: string | null;
}

type SharedRsvpStatus = 'attending' | 'maybe' | 'declined';

const RSVP_CHOICES: Array<{ status: SharedRsvpStatus; label: string; className: string }> = [
  { status: 'attending', label: 'Coming', className: 'btn' },
  { status: 'maybe', label: 'Maybe', className: 'btn-outline' },
  { status: 'declined', label: 'Unable to attend', className: 'btn-outline' },
];

/**
 * This public page deliberately stays thin: anyone with the forwarded link
 * can see the invitation and send their own reply, but not the guest list.
 */
export default function SharedInvitation() {
  const { token = '' } = useParams<{ token: string }>();
  const { data, isPending, error } = useQuery<Invitation>({
    queryKey: ['shared-invitation', token],
    queryFn: async () => (await api.get(`/events/share/${token}`)).data,
    enabled: Boolean(token),
    retry: false,
  });

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [partySize, setPartySize] = useState('1');
  const [sent, setSent] = useState<null | { status: SharedRsvpStatus; name: string }>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');

  async function reply(status: SharedRsvpStatus) {
    if (name.trim().length < 2) {
      setFailed('Please give a name so the hosts know who replied.');
      return;
    }
    setFailed('');
    setBusy(true);
    try {
      const body: Record<string, unknown> = { name: name.trim(), status };
      if (phone.trim()) body.contact = phone.trim();
      if (status === 'attending' && Number(partySize) > 0) body.partySize = Number(partySize);
      const { data: result } = await api.post(`/events/share/${token}`, body);
      setSent({ status: result.status ?? status, name: result.name ?? name.trim() });
    } catch (err) {
      setFailed(apiMessage(err, 'That could not be sent. Try again in a moment.'));
    } finally {
      setBusy(false);
    }
  }

  if (isPending) return <div className="mx-auto max-w-xl p-6"><Loading rows={4} /></div>;

  if (error || !data) {
    return (
      <main className="flex min-h-[100dvh] items-center px-4 py-8 sm:px-6">
        <div className="card mx-auto w-full max-w-xl text-center">
          <h1 className="section-title">This invitation is not available</h1>
          <p className="mt-2 text-sm leading-relaxed text-gray-600">
            The link may have been withdrawn, or copied incompletely. Ask whoever sent it for a fresh one.
          </p>
        </div>
      </main>
    );
  }

  const sentMessage = sent?.status === 'attending'
    ? 'The hosts can see your reply.'
    : sent?.status === 'maybe'
      ? 'You can update your answer at any time.'
      : 'They will be sorry to miss you.';
  const sentHeading = sent?.status === 'attending'
    ? 'Thank you — see you there'
    : sent?.status === 'maybe'
      ? 'Thank you — we will keep a place in mind'
      : 'Thank you for letting them know';

  return (
    <main className="flex min-h-[100dvh] items-center px-4 py-8 sm:px-6">
      <div className="mx-auto w-full max-w-xl space-y-4">
        <section className="card px-5 py-7 text-center sm:px-8">
          {data.cardUrl && (
            <img
              src={data.cardUrl}
              alt="Wedding invitation card"
              className="mx-auto mb-6 max-h-96 w-full border border-gray-200 object-contain"
            />
          )}
          <span aria-hidden className="mx-auto block h-px w-16 bg-gold" />
          <p className="eyebrow mt-4">You are invited to</p>
          <h1 className="page-title mx-auto mt-2">{data.eventName}</h1>
          <p className="mt-2 text-sm text-gray-600">Hosted by {data.hostName}</p>

          {(data.eventDate || data.venue || data.venueAddress || data.city) && (
            <dl className="mx-auto mt-6 grid max-w-md gap-y-1 border-y border-gray-200 py-4 text-sm leading-relaxed text-gray-700">
              {data.eventDate && <p>{formatDate(data.eventDate)}{data.startTime ? `, ${data.startTime}` : ''}</p>}
              {data.venue && <p className="font-medium text-gray-900">{data.venue}</p>}
              {(data.venueAddress || data.city) && (
                <p className="text-gray-500">{[data.venueAddress, data.city].filter(Boolean).join(', ')}</p>
              )}
            </dl>
          )}
        </section>

        {sent ? (
          <section className="card space-y-2 text-center">
            <h2 className="section-title">{sentHeading}</h2>
            <p className="text-sm leading-relaxed text-gray-600">
              Recorded for {sent.name}. {sentMessage}
            </p>
            <button className="btn-outline mt-2" onClick={() => setSent(null)}>
              Reply again, or for somebody else
            </button>
          </section>
        ) : (
          <section className="card space-y-5 px-5 py-6 sm:px-8">
            <div>
              <p className="eyebrow">Your reply</p>
              <h2 className="section-title mt-1">Will you be there?</h2>
              <p className="section-subtitle">Let your hosts know when you can. You can change this later.</p>
            </div>
            {failed && <p className="alert-critical" role="alert">{failed}</p>}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="rsvp-name">Your name</label>
                <input id="rsvp-name" className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <label className="label" htmlFor="rsvp-contact">
                  Phone number <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <input id="rsvp-contact" className="input" inputMode="tel" value={phone} maxLength={20} onChange={(e) => setPhone(e.target.value)} />
              </div>
            </div>

            <div>
              <label className="label" htmlFor="rsvp-party">How many of you, including yourself</label>
              <input id="rsvp-party" className="input" type="number" min={1} max={100} value={partySize} onChange={(e) => setPartySize(e.target.value)} />
              <p className="mt-1 text-xs text-gray-500">Only used when you are coming.</p>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              {RSVP_CHOICES.map((choice) => (
                <button
                  key={choice.status}
                  className={`${choice.className} min-w-0 whitespace-normal px-3 tracking-[0.12em]`}
                  disabled={busy}
                  onClick={() => reply(choice.status)}
                >
                  {busy ? 'Sending…' : choice.label}
                </button>
              ))}
            </div>
            <p className="border-t border-gray-200 pt-4 text-xs leading-relaxed text-gray-500">
              Choose Maybe if you are still deciding. Not answering leaves you as “not responded”.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
