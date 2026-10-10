import { useState } from 'react';
import { MILESTONE_LABEL } from '../lib/permissions';
import PhotoUploader from './PhotoUploader';

/**
 * Raising an issue on a booking, from either side.
 *
 * Asks for the two things that decide a case -- which instalment is in
 * question and what proof there is -- rather than a line of prose. Used by the
 * customer's booking and, since a vendor may also be waiting on a customer who
 * paid but will not sign the delivery off (row 20), by the vendor's.
 */
export default function RaiseIssueForm({
  bookingId,
  onRaise,
  onCancel,
  intro,
}: {
  bookingId: string;
  onRaise: (body: Record<string, unknown>) => void | Promise<void>;
  onCancel: () => void;
  intro?: string;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [milestone, setMilestone] = useState('');
  const [evidence, setEvidence] = useState<string[]>([]);
  const [url, setUrl] = useState('');

  const ready = title.trim().length >= 5 && description.trim().length >= 10;

  return (
    <form
      className="w-full space-y-3 border-t pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        void onRaise({
          subjectType: 'booking',
          subjectId: bookingId,
          title: title.trim(),
          description: description.trim(),
          ...(milestone ? { milestone } : {}),
          ...(evidence.length ? { evidence } : {}),
        });
      }}
    >
      <p className="text-sm text-gray-600">
        {intro ??
          'An officer investigates. Everything held in escrow on this booking stays frozen until they decide, neither side can move it in the meantime.'}
      </p>

      <label className="block text-sm">
        <span className="text-gray-700">In one line, what happened?</span>
        <input
          className="input mt-1"
          placeholder="Photographer did not attend the reception"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>

      <label className="block text-sm">
        <span className="text-gray-700">Tell them the whole story</span>
        <textarea
          className="input mt-1"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>

      <label className="block text-sm">
        <span className="text-gray-700">Which payment is this about?</span>
        <select className="input mt-1" value={milestone} onChange={(e) => setMilestone(e.target.value)}>
          <option value="">Not about a specific payment</option>
          {Object.keys(MILESTONE_LABEL).map((key) => (
            <option key={key} value={key}>
              {MILESTONE_LABEL[key as keyof typeof MILESTONE_LABEL]}
            </option>
          ))}
        </select>
      </label>

      <div>
        <p className="label">Evidence</p>
        <p className="text-xs text-gray-500">
          Photographs, invoices, message screenshots. Anything that shows what you are describing.
        </p>
        {evidence.length > 0 && (
          <ul className="mt-1 space-y-1 text-sm text-gray-700">
            {evidence.map((e) => (
              <li key={e} className="flex items-center justify-between gap-2">
                <span className="truncate">{e}</span>
                <button
                  type="button"
                  className="text-xs text-gray-500 underline"
                  onClick={() => setEvidence((list) => list.filter((u) => u !== e))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-1 flex flex-wrap gap-2">
          <input
            className="input flex-1"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button
            type="button"
            className="btn-outline"
            disabled={!/^https?:\/\/\S+$/.test(url.trim())}
            onClick={() => {
              setEvidence((list) => [...list, url.trim()]);
              setUrl('');
            }}
          >
            Add
          </button>
          <PhotoUploader
            kind="attachment"
            label="Upload a file"
            onUploaded={(u) => setEvidence((list) => [...list, u])}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button className="btn" disabled={!ready}>
          Raise the issue
        </button>
        <button type="button" className="btn-outline" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
