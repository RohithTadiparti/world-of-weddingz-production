import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye } from '@phosphor-icons/react';
import PhotoUploader from './PhotoUploader';
import { api, apiMessage } from '../lib/api';

/** The card belongs to the wedding, so changing it never touches RSVP rows. */
export default function WeddingInvitationCard() {
  const qc = useQueryClient();
  const { data, isPending, error } = useQuery<{ cardUrl: string | null }>({
    queryKey: ['wedding-invitation'],
    queryFn: async () => (await api.get('/events/wedding-invitation')).data,
  });
  const cardUrl = data?.cardUrl ?? null;
  async function save(cardUrl: string) {
    await api.put('/events/wedding-invitation/card', { cardUrl });
    await qc.invalidateQueries({ queryKey: ['wedding-invitation'] });
  }
  async function remove() {
    try {
      await api.delete('/events/wedding-invitation/card');
      await qc.invalidateQueries({ queryKey: ['wedding-invitation'] });
    } catch (err) {
      window.alert(apiMessage(err, 'The invitation card could not be removed.'));
    }
  }
  return <section className="card space-y-3">
    <div><h2 className="section-title">Invitation card</h2><p className="mt-1 text-sm text-gray-600">Used for your whole wedding. Replacing it never changes guests or replies.</p></div>
    {error && <p className="alert-critical">Could not load the invitation card.</p>}
    {isPending ? <p className="text-sm text-gray-500">Loading invitation card…</p> : cardUrl ? <div className="space-y-3">
      <a href={cardUrl} target="_blank" rel="noreferrer" className="block overflow-hidden border border-gray-200 bg-surface-sunken"><img src={cardUrl} alt="Wedding invitation card" className="max-h-80 w-full object-contain" /></a>
      <div className="flex flex-wrap gap-2"><PhotoUploader label="Replace card" onUploaded={save} /><a className="btn-outline" href={cardUrl} target="_blank" rel="noreferrer"><Eye size={16} /> Preview</a><button type="button" className="btn-ghost text-critical-fg" onClick={() => void remove()}>Remove</button></div>
    </div> : <div className="flex flex-wrap items-center gap-3"><PhotoUploader label="Upload invitation card" onUploaded={save} /><p className="text-xs text-gray-500">Upload an image of your wedding invitation.</p></div>}
  </section>;
}
