import { useState } from 'react';
import { ClockCounterClockwise } from '@phosphor-icons/react';
import { Panel } from './ReportParts';
import type { ReportsData } from './reportData';
import ActivityDetailDrawer from '../admin/ActivityDetailDrawer';

/** What each kind of event is called, what it groups under, and its tone. */
const KIND: Record<string, { label: string; group: string; tone: string }> = {
  'account.registered': { label: 'Account', group: 'accounts', tone: 'bg-brand-soft text-brand-strong' },
  'client.onboarded': { label: 'Client', group: 'accounts', tone: 'bg-brand-soft text-brand-strong' },
  'business.created': { label: 'Listing', group: 'accounts', tone: 'bg-caution-bg text-caution-fg' },
  'planner.registered': { label: 'Planner', group: 'accounts', tone: 'bg-caution-bg text-caution-fg' },
  'booking.placed': { label: 'Booking', group: 'bookings', tone: 'bg-positive-bg text-positive-fg' },
  'booking.completed': { label: 'Completed', group: 'bookings', tone: 'bg-positive-bg text-positive-fg' },
  'booking.cancelled': { label: 'Cancelled', group: 'bookings', tone: 'bg-critical-bg text-critical-fg' },
  'payment.received': { label: 'Payment', group: 'payments', tone: 'bg-caution-bg text-caution-fg' },
  'verification.raised': { label: 'Verification', group: 'verification', tone: 'bg-brand-soft text-brand-strong' },
  'verification.approved': { label: 'Approved', group: 'verification', tone: 'bg-positive-bg text-positive-fg' },
  'verification.rejected': { label: 'Rejected', group: 'verification', tone: 'bg-critical-bg text-critical-fg' },
  'case.raised': { label: 'Case', group: 'support', tone: 'bg-critical-bg text-critical-fg' },
  'case.resolved': { label: 'Case resolved', group: 'support', tone: 'bg-positive-bg text-positive-fg' },
  'dispute.raised': { label: 'Dispute', group: 'support', tone: 'bg-critical-bg text-critical-fg' },
};

const GROUPS = [
  { key: 'all', label: 'Everything' },
  { key: 'bookings', label: 'Bookings' },
  { key: 'payments', label: 'Payments' },
  { key: 'verification', label: 'Verification' },
  { key: 'support', label: 'Support' },
  { key: 'accounts', label: 'Accounts' },
];

/**
 * What happened on the platform in the selected period, newest first (EZ1-I242).
 * Each event is placed by its own moment -- a cancellation by when it was
 * cancelled, not when the booking was made.
 */
export default function ActivityTable({ d, limit }: { d: ReportsData; limit?: number }) {
  const [group, setGroup] = useState('all');
  const [role, setRole] = useState('');
  const [record, setRecord] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rows = (d.activity.data ?? [])
    .filter((a) => group === 'all' || KIND[a.kind]?.group === group)
    .filter((a) => !role || a.actorRole === role)
    .filter((a) => !record || a.resourceId.toLowerCase().includes(record.toLowerCase()) || a.resourceType.toLowerCase().includes(record.toLowerCase()))
    .slice(0, limit);
  const roles = [...new Set((d.activity.data ?? []).map((a) => a.actorRole).filter((r): r is string => Boolean(r)))];

  return (
    <Panel
      title="Recent activity"
      subtitle="Sign-ups, listings, bookings, payments, verification and support, newest first."
      icon={ClockCounterClockwise}
      load={d.activity}
      empty={rows.length === 0}
      emptyText={group === 'all' ? 'No activity in this period.' : 'Nothing of that kind in this period.'}
      action={<div className="flex flex-wrap gap-2"><select className="input py-1 text-sm" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Show activity of kind">{GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}</select><select className="input py-1 text-sm" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Filter by performer role"><option value="">All roles</option>{roles.map((item) => <option key={item} value={item}>{item.replace(/_/g, ' ')}</option>)}</select><input className="input w-36 py-1 text-sm" value={record} onChange={(e) => setRecord(e.target.value)} placeholder="Record ID/type" aria-label="Filter by record" /></div>}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="py-2 pr-4 font-medium">When</th>
              <th className="py-2 pr-4 font-medium">Type</th>
              <th className="py-2 font-medium">What happened</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((a) => {
              const kind = KIND[a.kind];
              return (
                <tr key={a.id} className="cursor-pointer hover:bg-brand-soft/30" onClick={() => setSelectedId(a.id)}>
                  <td className="whitespace-nowrap py-2 pr-4 tabular-nums text-gray-500">
                    {new Date(a.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  </td>
                  <td className="py-2 pr-4">
                    <span className={`whitespace-nowrap rounded-sm px-2 py-0.5 text-xs font-medium ${kind?.tone ?? 'bg-surface-sunken text-gray-700'}`}>
                      {kind?.label ?? a.kind}
                    </span>
                  </td>
                  <td className="py-2 text-gray-700">
                    <span className="hover:text-brand-strong hover:underline">{a.summary}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {selectedId && (() => {
        const selected = (d.activity.data ?? []).find((item) => item.id === selectedId);
        return selected ? <ActivityDetailDrawer activity={selected} onClose={() => setSelectedId(null)} /> : null;
      })()}
    </Panel>
  );
}
