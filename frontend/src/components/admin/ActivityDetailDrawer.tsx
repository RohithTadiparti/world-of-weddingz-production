import { Link } from 'react-router-dom';
import { humanize } from '../../lib/labels';

export interface ActivityDetail {
  id: string;
  at: string;
  kind: string;
  summary: string;
  resourceType: string;
  resourceId: string;
  actorUserId: string | null;
  actorName: string | null;
  actorRole: string | null;
  metadata: Record<string, unknown>;
}

function recordLink(type: string, id: string) {
  if (!id) return null;
  if (type === 'booking') return `/admin/bookings/${id}`;
  if (type === 'payment') return `/admin/transactions/${id}`;
  if (type === 'profile') return `/admin/profiles/${id}`;
  if (type === 'user') return `/admin/users/${id}`;
  return null;
}

const value = (item: unknown) => {
  if (item == null) return '—';
  if (typeof item === 'object') return JSON.stringify(item);
  return String(item);
};

/** Quick-review detail for the immutable audit event behind a feed row. */
export default function ActivityDetailDrawer({ activity, onClose }: { activity: ActivityDetail; onClose: () => void }) {
  const metadata = activity.metadata ?? {};
  const link = recordLink(activity.resourceType, activity.resourceId);
  const from = metadata.from ?? metadata.previousStatus ?? metadata.oldValue;
  const to = metadata.to ?? metadata.newStatus ?? metadata.newValue;
  const extras = Object.entries(metadata).filter(([key]) => !['from', 'to', 'previousStatus', 'newStatus', 'oldValue', 'newValue'].includes(key));
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-gray-900/30" role="dialog" aria-modal="true" aria-label="Activity details">
      <button className="absolute inset-0 cursor-default" aria-label="Close activity details" onClick={onClose} />
      <aside className="relative h-full w-full max-w-md overflow-y-auto bg-surface p-5 shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div><p className="text-xs font-medium uppercase tracking-wide text-brand-strong">Activity details</p><h2 className="mt-1 text-xl font-semibold text-gray-900">{activity.summary}</h2></div>
          <button className="btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>
        <dl className="space-y-4 text-sm">
          <Detail label="Performed by" value={activity.actorName ?? 'System'} />
          <Detail label="Role" value={activity.actorRole ? humanize(activity.actorRole) : 'System'} />
          {activity.actorUserId && <Detail label="Account ID" value={activity.actorUserId} />}
          <Detail label="Date & time" value={new Date(activity.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} />
          <Detail label="Action" value={humanize(activity.kind)} />
          <Detail label="Affected record" value={`${humanize(activity.resourceType)}${activity.resourceId ? ` · ${activity.resourceId}` : ''}`} />
          {(from !== undefined || to !== undefined) && <Detail label="Change" value={`${value(from)} → ${value(to)}`} />}
          {extras.map(([key, item]) => <Detail key={key} label={humanize(key)} value={value(item)} />)}
        </dl>
        {link && <Link className="btn mt-6" to={link} onClick={onClose}>View complete record</Link>}
      </aside>
    </div>
  );
}

function Detail({ label, value: detail }: { label: string; value: string }) {
  return <div><dt className="text-xs uppercase tracking-wide text-gray-500">{label}</dt><dd className="mt-1 break-all text-gray-800">{detail}</dd></div>;
}
