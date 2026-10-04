import { formatHeight } from '../lib/height';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { formatDate } from '../lib/dates';
import { PersonPhoto } from './ProfileSilhouette';

interface Details {
  firstName?: string | null;
  lastName?: string | null;
  heightCm?: number | null;
  religion?: string | null;
  caste?: string | null;
  highestQualification?: string | null;
  occupationStatus?: string | null;
  primaryPhotoUrl?: string | null;
}

interface Profile {
  id: string;
  displayName?: string | null;
  city?: string | null;
  dateOfBirth?: string | null;
  photos?: string[];
}

/**
 * The biodata as a card.
 *
 * A form full of your own answers reads as an empty form, which is why the
 * read-back view exists — but a read-back *list* is still a list. What somebody
 * wants after filling this in is to see the thing they made: a photograph, a
 * name, the four facts anybody asks first, and the handful of things they might
 * want to do next.
 *
 * The four actions are the ones people actually reach for. "Delete" clears the
 * biodata and the photographs so somebody can start again — it is not the same
 * as closing an account, which lives under Security, needs a password and
 * refuses while money is in flight. The confirmation says which of the two it
 * is, because the word "delete" does not.
 */
export default function ProfileCard({
  profileId,
  profile,
  details,
  complete,
  percent,
  onEdit,
  onPhotos,
  onView,
  gender,
}: {
  profileId: string;
  profile: Profile | null;
  details: Details;
  complete: boolean;
  percent: number;
  onEdit: () => void;
  onPhotos: () => void;
  onView: () => void;
  /** Picks the groom or bride silhouette shown until there is a photograph. */
  gender?: string | null;
}) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const name =
    [details.firstName, details.lastName].filter(Boolean).join(' ') ||
    profile?.displayName ||
    'Your profile';

  // The first photo is the profile photo; the server keeps the chosen one first.
  const photo = profile?.photos?.[0] ?? details.primaryPhotoUrl ?? null;

  const age = (() => {
    if (!profile?.dateOfBirth) return null;
    const born = new Date(profile.dateOfBirth);
    if (Number.isNaN(born.getTime())) return null;
    const now = new Date();
    let years = now.getFullYear() - born.getFullYear();
    const before =
      now.getMonth() < born.getMonth() ||
      (now.getMonth() === born.getMonth() && now.getDate() < born.getDate());
    if (before) years -= 1;
    return years > 0 ? years : null;
  })();

  // The four facts anybody asks first, in the order they ask them.
  const facts = [
    age ? `${age} years` : null,
    details.heightCm ? formatHeight(details.heightCm) : null,
    profile?.city ?? null,
    [details.religion, details.caste].filter(Boolean).join(' · ') || null,
    details.highestQualification ?? null,
    details.occupationStatus?.replace(/_/g, ' ') ?? null,
  ].filter(Boolean) as string[];

  async function remove() {
    setBusy(true);
    setError('');
    try {
      await api.delete(`/profiles/${profileId}/details`);
      await qc.invalidateQueries();
      setConfirming(false);
      setBusy(false);
    } catch (err) {
      setError(apiMessage(err, 'That could not be cleared.'));
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap gap-4">
        <PersonPhoto
          url={photo}
          gender={gender}
          className="h-28 w-28 shrink-0 rounded-lg object-cover ring-1 ring-gray-200"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="section-title">{name}</h2>
              <p className="text-sm text-gray-500">
                {facts.length > 0 ? facts.join(' · ') : 'Nothing filled in yet'}
              </p>
            </div>
            <span
              className={`rounded-sm px-2 py-1 text-xs font-medium ${
                complete ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
              }`}
            >
              {complete ? 'Ready to circulate' : `${percent}% complete`}
            </span>
          </div>

          {profile?.dateOfBirth && (
            <p className="mt-1 text-xs text-gray-400">
              Born {formatDate(profile.dateOfBirth)}
            </p>
          )}
        </div>
      </div>

      {error && <p className="alert-critical">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button className="btn" onClick={onEdit}>
          Edit
        </button>
        <button className="btn-outline" onClick={onView}>
          View complete profile
        </button>
        <button className="btn-outline" onClick={onPhotos}>
          Upload photos
        </button>
        <button
          className="btn-outline text-red-600"
          onClick={() => setConfirming(!confirming)}
        >
          Delete profile
        </button>
      </div>

      {/*
        In words rather than a browser confirm: what goes with it is the part
        people do not think about until afterwards.
      */}
      {confirming && (
        <div className="rounded-sm border border-red-200 bg-red-50 p-3 text-sm">
          <p className="font-medium text-red-800">Clear this biodata and start again?</p>
          <p className="mt-1 text-red-700">
            The details, the family information and every photograph are removed, and the profile
            stops being matchable until you fill it in again. Your account stays, closing that is
            under Security. Interests already exchanged and the consent record are kept.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-outline" onClick={() => setConfirming(false)}>
              Keep it
            </button>
            <button
              className="btn bg-red-600 hover:bg-red-700"
              disabled={busy}
              onClick={remove}
            >
              {busy ? 'Clearing…' : 'Yes, clear it'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
