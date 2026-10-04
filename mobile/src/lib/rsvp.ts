/**
 * Where a guest's RSVP link opens: the web client's `/rsvp/:token` page, the
 * same address the invitation email carries. Must match the server's
 * APP_BASE_URL, whose default this mirrors.
 */
const APP_URL = (process.env.EXPO_PUBLIC_APP_URL ?? 'http://localhost:8080').replace(/\/+$/, '');

/** `rsvpUrl` as `POST /events/:id/invite` returns it: a path, `/rsvp/<token>`. */
export function rsvpLink(rsvpUrl: string): string {
  return `${APP_URL}${rsvpUrl}`;
}

export type RsvpStatus = 'invited' | 'attending' | 'declined' | 'maybe';
export type RsvpTone = 'positive' | 'caution' | 'critical' | 'neutral';

export function rsvpBadge(status: RsvpStatus | undefined): { label: string; tone: RsvpTone } {
  switch (status) {
    case 'attending':
      return { label: 'Confirmed', tone: 'positive' };
    case 'declined':
      return { label: 'Declined', tone: 'critical' };
    case 'maybe':
      return { label: 'Maybe', tone: 'caution' };
    case 'invited':
      return { label: 'Pending', tone: 'caution' };
    default:
      return { label: 'Not invited', tone: 'neutral' };
  }
}

/** WhatsApp's own share address. Addressed to the guest when their number is on file. */
export function whatsappUrl(message: string, phone?: string | null): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
