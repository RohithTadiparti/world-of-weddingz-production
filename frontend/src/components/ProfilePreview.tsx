import { formatHeight } from '../lib/height';
import { readBusinessEntries } from '../lib/business-entries';
import { useState } from 'react';
import { CheckCircle, LockSimple } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { isChartImage } from '../lib/horoscope';
import { api, apiMessage } from '../lib/api';
import { formatDate } from '../lib/dates';
import { COMPLEXION_LABEL, LIFE_STATUS_LABEL } from '../lib/permissions';
import { Loading } from './ui/Feedback';
import { PersonPhoto } from './ProfileSilhouette';

interface Viewable {
  profileId: string;
  /**
   * True when only the basic card is shared — a MATCHES_ONLY profile the viewer
   * has not yet mutually accepted. `details` is null in that case by design, so
   * the biodata sections are withheld rather than missing.
   */
  limited?: boolean;
  accessLevel: 'basic' | 'full';
  unlockRequirement: 'accepted_interest' | 'fixed_match' | null;
  profile: {
    id: string;
    displayName: string | null;
    city: string | null;
    gender: string | null;
    dateOfBirth?: string | null;
    /** Exact age on every view; the date of birth itself only on the full one. */
    age?: number | null;
    /** The older five-year band, read only when an older server sends no age. */
    ageRange?: string | null;
    photos: string[];
    bio?: string | null;
    identityVerified: boolean;
    profileCode?: string;
    /** 'bride' | 'groom' when a family member manages this profile. */
    managingFor?: string | null;
    /** Null when the person runs their own profile, which needs no label. */
    stewardship: {
      kind: 'family' | 'agency';
      label: string;
      relation: string | null;
    } | null;
  };
  details: Record<string, unknown> | null;
  siblings: { id: string; name: string; profession?: string | null }[];
  assets: { id: string; type: string; location?: string | null }[];
}

/**
 * A profile, opened from wherever it was listed.
 *
 * Matches, recommendations and interests all showed a name, a city and an age
 * range and stopped there — the name was not clickable and there was nothing
 * behind it, because the endpoint that serves a viewable biodata existed and
 * had never been exposed. That is the whole of the reported defect.
 *
 * What is shown is the subtractive view the server decides: no income unless
 * the profile publishes it, no communication address, no second phone number.
 * This component does not choose what to hide — it renders what it is given,
 * which is the only arrangement where the two cannot drift apart.
 */
export default function ProfilePreview({
  profileId,
  onClose,
  onSendInterest,
  score,
  lastActiveAt,
  commonInterests,
}: {
  profileId: string;
  onClose: () => void;
  onSendInterest?: () => void;
  /**
   * The match score, surfaced from the card that opened this (EZ1-I190). The
   * same value the list shows, so a family does not lose it on opening the
   * profile. Absent when the profile was opened from a link that carried no
   * score (a notification), in which case the badge is simply not drawn.
   */
  score?: number;
  /** For the "Active …" line, carried from the same card. */
  lastActiveAt?: string | null;
  /** Shared match dimensions, carried from the Match result. */
  commonInterests?: string[];
}) {
  const { data, isLoading, isError, error } = useQuery<Viewable>({
    queryKey: ['viewable-profile', profileId],
    queryFn: async () => (await api.get(`/profiles/${profileId}/view`)).data,
    retry: false,
  });

  // Which photo is open full-size, if any (EZ1-I23).
  const [preview, setPreview] = useState<string | null>(null);

  const d = (data?.details ?? {}) as Record<string, unknown>;
  const str = (key: string) => {
    const v = d[key];
    return v === null || v === undefined || v === '' ? null : String(v);
  };
  const bag = (key: string) => (d[key] ?? {}) as Record<string, unknown>;

  const age = (() => {
    const dob = data?.profile.dateOfBirth;
    if (!dob) return null;
    const born = new Date(dob);
    if (Number.isNaN(born.getTime())) return null;
    const now = new Date();
    let years = now.getFullYear() - born.getFullYear();
    if (
      now.getMonth() < born.getMonth() ||
      (now.getMonth() === born.getMonth() && now.getDate() < born.getDate())
    ) {
      years -= 1;
    }
    return years > 0 ? years : null;
  })();

  // "Active today / this week / this month", or nothing rather than a stale
  // claim. The same reading the card gives, kept at the top of the profile.
  const active = (() => {
    if (!lastActiveAt) return null;
    const days = (Date.now() - new Date(lastActiveAt).getTime()) / 86_400_000;
    if (Number.isNaN(days)) return null;
    if (days < 1) return 'Active today';
    if (days < 7) return 'Active this week';
    if (days < 30) return 'Active this month';
    return null;
  })();

  // From the date of birth when the full view carries it, else the exact age
  // the server works out for the limited view; the band only from an old server.
  const exactAge = age ?? data?.profile.age ?? null;
  const shownAge = exactAge ? `${exactAge} years` : data?.profile.ageRange || null;

  const name = data?.profile.displayName ?? 'Profile';
  const heightCm = str('heightCm');
  const facts = [
    shownAge,
    heightCm ? formatHeight(heightCm) : null,
    data?.profile.city || null,
  ].filter(Boolean) as string[];
  const preferenceSummary = (() => {
    const preferences = bag('partnerPreferences');
    const entries = [
      ['Religion', preferences.religion],
      ['Community', preferences.caste ?? preferences.community],
      ['Education', preferences.education],
      ['Profession', preferences.profession],
      ['Locations', preferences.locations ?? preferences.preferredLocations],
      ['Interests', preferences.lifestyle ?? preferences.interests],
    ] as const;
    return entries
      .map(([label, value]) => {
        const display = Array.isArray(value) ? value.filter(Boolean).join(', ') : String(value ?? '').trim();
        return display ? `${label}: ${display}` : null;
      })
      .filter(Boolean) as string[];
  })();

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-8 w-full max-w-lg rounded-lg bg-surface p-6">
        {/*
          The identity, said once and clearly at the top: a lead photo (or an
          gendered silhouette, never a broken image), the name, the profile code,
          the age/height/city on one line, and the two badges families read
          first — identity and activity. The match score sits beside the name,
          the same figure the card carried in (EZ1-I190).
        */}
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <ProfileImage
              url={data?.profile.photos[0]}
              gender={data?.profile.gender}
              className="h-16 w-16 shrink-0 rounded-md object-cover text-xl ring-1 ring-inset ring-gray-900/5"
            />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold tracking-[-0.014em] text-gray-900">
                {name}
              </h2>
              {data?.profile.profileCode && (
                <p className="font-mono text-xs text-gray-400">{data.profile.profileCode}</p>
              )}
              {facts.length > 0 && (
                <p className="mt-0.5 text-sm text-gray-600">{facts.join(' · ')}</p>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {data?.profile.identityVerified && (
                  <span className="inline-flex items-center gap-1 rounded-sm bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                    <CheckCircle size={13} weight="fill" aria-hidden />
                    Identity verified
                  </span>
                )}
                {active && (
                  <span className="rounded-sm bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                    {active}
                  </span>
                )}
                {data?.limited && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                    <LockSimple size={13} weight="fill" aria-hidden />
                    {data.unlockRequirement === 'fixed_match'
                      ? 'Full profile unlocks once match is fixed'
                      : 'Full profile unlocks once interest is accepted'}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <button
              className="text-2xl leading-none text-gray-400 hover:text-gray-600"
              onClick={onClose}
              aria-label="Close"
            >
              ×
            </button>
            {typeof score === 'number' && (
              <span className="flex items-baseline gap-1 rounded-sm bg-brand-soft px-2.5 py-1 text-brand-strong">
                <span className="font-mono text-sm font-semibold leading-none">{score}%</span>
                <span className="text-[0.6875rem] opacity-70">match</span>
              </span>
            )}
          </div>
        </div>

        {isLoading && <Loading rows={3} />}
        {isError && (
          <p className="rounded-sm bg-amber-50 p-3 text-sm text-amber-800">
            {apiMessage(error, 'That profile cannot be opened.')}
          </p>
        )}

        {data && (
          <div className="space-y-5">
            {data.profile.photos.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {data.profile.photos.slice(0, 5).map((url) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setPreview(url)}
                    aria-label="Open photo full size"
                    className="cursor-zoom-in"
                  >
                    <ProfileImage
                      url={url}
                      gender={data.profile.gender}
                      className="h-28 w-28 rounded-sm object-cover text-2xl ring-1 ring-gray-200"
                    />
                  </button>
                ))}
              </div>
            )}

            {data.profile.bio && (
              <p className="whitespace-pre-wrap text-sm text-gray-700">{data.profile.bio}</p>
            )}

            <Group title="Personal details">
              <Row label="Name">{name}</Row>
              <Row label="Age">{shownAge}</Row>
              <Row label="Location">{data.profile.city}</Row>
              <Row label="Height">{heightCm ? formatHeight(heightCm) : null}</Row>
              <Row label="Complexion">
                {str('complexion') ? (COMPLEXION_LABEL[str('complexion')!] ?? str('complexion')) : null}
              </Row>
            </Group>

            {/*
              Before mutual acceptance a MATCHES_ONLY profile shares a basic
              card: the basic biodata a family reads to decide whether to send
              interest — community, education and occupation — while the private
              detail (family, horoscope, marital history, contact) stays behind
              the accept (EZ1-I37). A fully shared profile shows everything.
            */}
            <Group title="Religion and community">
              <Row label="Religion">{str('religion')}</Row>
              <Row label="Caste">{str('caste')}</Row>
              <Row label="Sub-caste">{str('subCaste')}</Row>
              <Row label="Mother tongue">{str('motherTongue')}</Row>
            </Group>

            <Group title="Education">
              <Row label="Qualification">{str('highestQualification')}</Row>
              {!data.limited && <Row label="Course">{str('course')}</Row>}
              {!data.limited && <Row label="Institution">{str('institution')}</Row>}
              {!data.limited && <Row label="College Place">{str('collegePlace')}</Row>}
            </Group>

            <Group title="Occupation">
              <Row label="Occupation">{str('occupationStatus')?.replace(/_/g, ' ')}</Row>
              <Row label="Profession">{str('profession') ?? String(bag('employment').role ?? bag('employment').designation ?? '')}</Row>
              {!data.limited && (
                <Row label="Employer">
                  {String(bag('employment').company ?? readBusinessEntries(bag('business')).map((entry) => [entry.businessName, entry.businessType, entry.businessLocation].filter(Boolean).join(' - ')).join('; ')) || null}
                </Row>
              )}
            </Group>

            <Group title="Compatibility">
              <Row label="Compatibility score">
                {typeof score === 'number' ? `${score}%` : null}
              </Row>
              <Row label="Common interests">
                {commonInterests?.length ? commonInterests.join(', ') : null}
              </Row>
            </Group>

            {!data.limited && (
              <Group title="Partner preferences">
                <Row label="Preferences">
                  {preferenceSummary.length ? preferenceSummary.join(' · ') : null}
                </Row>
              </Group>
            )}

            {/* The horoscope before acceptance, so a family can compare charts
                while deciding whether to send interest (EZ1-I48, EZ1-I231).
                Family, contact and the rest of the biodata stay behind the
                mutual accept; the chart does not, because comparing it is what
                this decision is actually made on. */}
            {data.limited &&
              Boolean(
                str('rashi') ||
                  str('star') ||
                  str('gothram') ||
                  str('kujaDosham') ||
                  d.horoscopeDocumentUrl,
              ) && (
                <Group title="Horoscope">
                  <Row label="Rashi">{str('rashi')}</Row>
                  <Row label="Star">{str('star')}</Row>
                  <Row label="Padam">{str('padam')}</Row>
                  <Row label="Gothram">{str('gothram')}</Row>
                  <Row label="Kuja dosham">{str('kujaDosham')}</Row>
                  {/* The chart is what families actually compare on before
                      sending interest, so it is here rather than behind the
                      accept (EZ1-I231). */}
                  <HoroscopeChart url={d.horoscopeDocumentUrl as string | null | undefined} />
                </Group>
              )}

            {data.limited && (
              <p className="text-xs text-gray-500">
                {data.unlockRequirement === 'fixed_match'
                  ? 'The full profile is shared after the match is fixed and confirmed. Accepting interest alone does not unlock it.'
                  : 'The full profile is shared after interest is accepted. Sending interest alone does not unlock it.'}
              </p>
            )}

            {!data.limited && (
              <>
            <Group title="Family">
              {/* Native place is not shown in View Profile — it stays private
                  until a match is fixed, not merely accepted (EZ1-I136). */}
              <Row label="Father">{String(bag('father').name ?? '') || null}</Row>
              <Row label="Father's profession">{String(bag('father').profession ?? '') || null}</Row>
              <Row label="Father's living status">
                {LIFE_STATUS_LABEL[String(bag('father').lifeStatus ?? '') as keyof typeof LIFE_STATUS_LABEL] ?? null}
              </Row>
              <Row label="Mother">{String(bag('mother').name ?? '') || null}</Row>
              <Row label="Mother's profession">{String(bag('mother').profession ?? '') || null}</Row>
              <Row label="Mother's living status">
                {LIFE_STATUS_LABEL[String(bag('mother').lifeStatus ?? '') as keyof typeof LIFE_STATUS_LABEL] ?? null}
              </Row>
              <Row label="Family type">{str('familyType')}</Row>
              <Row label="Family status">{str('familyStatus')?.replace(/_/g, ' ')}</Row>
              {data.siblings.length > 0 && (
                <Row label="Siblings">
                  {data.siblings.map((s) => s.name).filter(Boolean).join(', ')}
                </Row>
              )}
            </Group>

            <Group title="Horoscope">
              <Row label="Has a horoscope">
                {d.horoscopeAvailable === null || d.horoscopeAvailable === undefined
                  ? null
                  : d.horoscopeAvailable
                    ? 'Yes'
                    : 'No'}
              </Row>
              {Boolean(d.horoscopeAvailable) && (
                <>
                  <Row label="Rashi">{String(bag('horoscope').rashi ?? '') || null}</Row>
                  <Row label="Star">{String(bag('horoscope').star ?? '') || null}</Row>
                  {/* The rest of the chart. Families compare on padam, gothram
                      and kuja dosham as much as on rashi and star, and all five
                      are on the biodata already — only the first two were being
                      shown here (EZ1-I231). */}
                  <Row label="Padam">{String(bag('horoscope').padam ?? '') || null}</Row>
                  <Row label="Gothram">{String(bag('horoscope').gothram ?? '') || null}</Row>
                  <Row label="Kuja dosham">
                    {String(bag('horoscope').kujaDosham ?? '') || null}
                  </Row>
                  <Row label="Place of birth">
                    {String(bag('horoscope').birthPlace ?? '') || null}
                  </Row>
                  <Row label="Time of birth">
                    {String(bag('horoscope').timeOfBirth ?? '') || null}
                  </Row>
                  <HoroscopeChart url={d.horoscopeDocumentUrl as string | null | undefined} />
                </>
              )}
            </Group>

            <Group title="Marital status">
              <Row label="Status">{str('maritalStatus')?.replace(/_/g, ' ')}</Row>
              <Row label="Married on">
                {formatDate(String(bag('maritalHistory').marriageDate ?? ''), '')}
              </Row>
            </Group>
              </>
            )}

            {/*
              Who you would actually be speaking to.

              A family reading a biodata asks this before they ask anything
              else, and the profile said nothing about it — an agency listing
              and a father running his daughter's profile looked identical.
              Shown at the foot, where it reads as provenance rather than as a
              claim about the person.
            */}
            {/*
              What the managed person is — Bride or Groom — at the foot of the
              profile, for a family member opening it from chat (EZ1-I41).
            */}
            {(data.profile.managingFor || data.profile.stewardship) && (
              <div className="rounded-sm border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
                {/* The name is the heading above; this line names what the
                    profile is and who runs it, without repeating the name
                    (EZ1-I97, EZ1-I115) or printing it twice (EZ1-I91). */}
                {data.profile.managingFor && (
                  <span className="font-medium text-gray-800">
                    {data.profile.managingFor === 'bride' ? 'Bride' : 'Groom'} profile
                  </span>
                )}
                {data.profile.stewardship && (
                  <span>
                    {data.profile.managingFor ? ' · ' : ''}
                    Managed by{' '}
                    {data.profile.stewardship.relation
                      ? `their ${data.profile.stewardship.relation}`
                      : data.profile.stewardship.label}
                  </span>
                )}
              </div>
            )}

            {onSendInterest && (
              <button
                className="btn"
                onClick={() => {
                  onSendInterest();
                  onClose();
                }}
              >
                Send interest
              </button>
            )}
          </div>
        )}
      </div>

      {/* Full-size photo preview, closed by clicking anywhere or the × (EZ1-I23). */}
      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreview(null)}
          role="dialog"
          aria-label="Photo preview"
        >
          <button
            className="absolute right-4 top-4 text-4xl leading-none text-white/90"
            onClick={() => setPreview(null)}
            aria-label="Close preview"
          >
            ×
          </button>
          <ProfileImage
            url={preview}
            gender={data?.profile.gender}
            onClick={(e) => e.stopPropagation()}
            className="max-h-full max-w-full rounded-sm object-contain p-16 text-6xl"
          />
        </div>
      )}
    </div>
  );
}

/**
 * A profile photo that never renders the browser's broken-image icon: a
 * missing URL, or one that 404s, shows the groom or bride silhouette instead.
 * Sizing comes from `className`, so one component serves the header avatar,
 * the gallery thumbs and the full-size overlay (EZ1-I190).
 */
function ProfileImage(props: {
  url?: string | null;
  gender?: string | null;
  className: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return <PersonPhoto {...props} />;
}


/**
 * The chart the family uploaded, shown rather than merely stored.
 *
 * It was written to the biodata, saved, returned in this very payload, and
 * never rendered anywhere — so a family who attached their daughter's chart
 * saw no sign of it on any profile view (EZ1-I231). An image is worth showing
 * inline, because that is what people want to look at; a PDF opens in a tab,
 * because an inline PDF viewer inside a modal is worse than a new tab. When
 * nothing was uploaded the row says so, rather than leaving a blank the reader
 * has to interpret.
 */
function HoroscopeChart({ url }: { url: string | null | undefined }) {
  /*
   * Nothing attached is its own answer, and not the same one as a field the
   * family chose not to share. They keep a horoscope — that is why this section
   * is here — and have not put the chart on it (EZ1-I231).
   */
  if (!url) {
    return (
      <div className="flex gap-3 py-1.5">
        <dt className="w-40 shrink-0 text-gray-500">Chart</dt>
        <dd className="text-gray-400">Not uploaded</dd>
      </div>
    );
  }

  // The stored path decides the treatment. Anything that is not an image we
  // can render is offered as a link, which is the safe fallback for a PDF and
  // for any format we have not thought of.
  const isImage = isChartImage(url);

  return (
    <div className="flex gap-3 py-1.5">
      <dt className="w-40 shrink-0 text-gray-500">Chart</dt>
      <dd className="min-w-0 font-medium text-gray-900">
        {isImage ? (
          <a href={url} target="_blank" rel="noreferrer" className="block">
            <img
              src={url}
              alt="Horoscope chart"
              loading="lazy"
              className="max-h-64 rounded-sm border border-gray-200 object-contain"
            />
            <span className="mt-1 block text-xs text-brand-strong">Open full size</span>
          </a>
        ) : (
          <a href={url} target="_blank" rel="noreferrer" className="text-brand-strong underline">
            Open the chart
          </a>
        )}
      </dd>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      <dl className="divide-y text-sm">{children}</dl>
    </div>
  );
}

/** An empty value says so, rather than rendering a blank row that reads as broken. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  const empty = children === null || children === undefined || children === '';
  return (
    <div className="flex gap-3 py-1.5">
      <dt className="w-40 shrink-0 text-gray-500">{label}</dt>
      <dd className={empty ? 'text-gray-400' : 'font-medium text-gray-900'}>
        {empty ? 'Not shared' : children}
      </dd>
    </div>
  );
}
