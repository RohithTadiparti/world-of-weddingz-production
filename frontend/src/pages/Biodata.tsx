import BusinessEntriesFields from '../components/BusinessEntriesFields';
import HeightInput from '../components/HeightInput';
import PackageRangeFields from '../components/PackageRangeFields';
import { BusinessEntry, readBusinessEntries } from '../lib/business-entries';
import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, apiMessage } from '../lib/api';
import { Draft, createDraftGuard, loadDraft, saveDraft, submitDraft } from '../lib/biodata-draft';
import { useAuth } from '../store/auth';
import {
  ASSET_TYPE_LABEL,
  FAMILY_TYPE_LABEL,
  LIFE_STATUS_LABEL,
  MARITAL_LABEL,
  SELF_MARITAL_STATUSES,
  MaritalStatus,
  OCCUPATION_LABEL,
  OTHER_INCOME_LABEL,
  OccupationStatus,
  Permission,
  COMPLEXION_LABEL,
  FAMILY_STATUS_LABEL,
  can,
} from '../lib/permissions';
import { FileText } from '@phosphor-icons/react';
import { isChartImage } from '../lib/horoscope';
import ProfileSelector from '../components/ProfileSelector';
import ProfilePhotos from '../components/ProfilePhotos';
import PhotoUploader from '../components/PhotoUploader';
import ChoiceField from '../components/ChoiceField';
import DependentLocation from '../components/DependentLocation';
import {
  CASTES_BY_RELIGION,
  CITIES,
  COUNTRIES,
  MOTHER_TONGUES,
  NAKSHATRAS,
  OTHER,
  PADAMS,
  PROFESSIONS,
  QUALIFICATIONS,
  RASHIS,
  RELIGIONS,
} from '../lib/reference';
import SavedBiodata from '../components/SavedBiodata';
import ProfileCard from '../components/ProfileCard';
import BiodataImport from '../components/BiodataImport';
import { formatDate } from '../lib/dates';
import RequiredMark, { RequiredNote } from '../components/ui/RequiredMark';
import IndividualPageMasthead from '../components/individual/IndividualPageMasthead';

interface Section {
  section: string;
  complete: boolean;
  label: string;
}

interface Completion {
  profileId: string;
  complete: boolean;
  percent: number;
  sections: Section[];
  missing: string[];
}

/**
 * The two numbers, each labelled.
 *
 * They live in different places for good reasons — the primary is on the
 * account because it signs you in, the alternate is on the biodata because it
 * is usually the family's — but a page showing one without the other reads as
 * though the primary is missing.
 */
interface ContactBlock {
  primaryMobile: string | null;
  primaryMobileVerified: boolean;
  primaryMobileSource: 'account' | 'profile' | 'agency_record';
  alternateMobile: string | null;
  email: string | null;
}

/** Shared fields are owned by the profile, not duplicated in biodata details. */
interface SharedProfile {
  displayName: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  contactPhone: string | null;
  city: string | null;
  address: string | null;
  bio: string | null;
  visibility: 'public' | 'matches_only' | 'private' | null;
  managingFor?: 'bride' | 'groom' | null;
}

/** One caste in the reference catalogue, with the sub-castes filed under it. */
interface CasteEntry {
  casteName: string;
  religions: string[];
  subCastes: { subCasteName: string }[];
}

interface Sibling {
  id: string;
  name: string;
  age: number | null;
  maritalStatus: MaritalStatus | null;
  qualification: string | null;
  profession: string | null;
}

interface Asset {
  id: string;
  type: string;
  location: string | null;
  area: string | null;
  estimatedValue: string | null;
  visible: boolean;
}

/**
 * The matrimonial biodata, section by section.
 *
 * Saved a section at a time on purpose. People fill this in over days, from a
 * phone, often with a relative reading answers out — a single form that only
 * commits at the end loses all of it the first time somebody closes the tab.
 */
export default function Biodata() {
  const qc = useQueryClient();
  const userRole = useAuth((s) => s.user?.role);
  const permissions = useAuth((s) => s.user?.permissions ?? []);
  const isFamily = userRole === 'family';
  const isIndividual = userRole === 'bride' || userRole === 'groom';
  const isSteward = can(permissions, Permission.ACT_ON_BEHALF);
  const isAgent = can(permissions, Permission.AGENCY_MANAGE);

  const [params, setParams] = useSearchParams();
  const [profileId, setProfileId] = useState(params.get('profileId') ?? '');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [step, setStep] = useState<StepName>('photos');
  const [direction, setDirection] = useState<'next' | 'prev'>('next');
  const [savedOpen, setSavedOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [importedFields, setImportedFields] = useState<Record<string, string> | null>(null);
  const [importRevision, setImportRevision] = useState(0);

  // Individuals edit their own profile and never pick one.
  const { data: me } = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/users/me')).data,
    retry: false,
    enabled: !isAgent,
  });
  const targetId = profileId || (me?.id ?? '');

  useEffect(() => {
    if (profileId) setParams({ profileId }, { replace: true });
  }, [profileId, setParams]);

  const { data } = useQuery({
    queryKey: ['biodata', targetId],
    queryFn: async () => (await api.get(`/profiles/${targetId}/details`)).data,
    retry: false,
    enabled: Boolean(targetId),
  });

  const details = data?.details ?? {};
  const sharedProfile: SharedProfile | undefined = data?.profile;
  // Managed records predate the gender field in some installations. Their
  // bride/groom assignment remains the authoritative fallback in the agent
  // portal, so profile cards and saved biodata never render an empty gender.
  const profileGender =
    sharedProfile?.gender ??
    (sharedProfile?.managingFor === 'bride'
      ? 'Female'
      : sharedProfile?.managingFor === 'groom'
        ? 'Male'
        : null);
  const contact: ContactBlock | undefined = data?.contact;
  const completion: Completion | undefined = data?.completion;
  const siblings: Sibling[] = data?.siblings ?? [];
  const assets: Asset[] = data?.assets ?? [];

  // The same steps as the mobile app: marital history is only asked for once
  // somebody has said they have been married.
  const steps = stepsFor(details.maritalStatus);
  // A step that has dropped out (marital, after changing back to never
  // married) falls back to the one before it.
  const current: StepName = steps.includes(step)
    ? step
    : steps[Math.max(0, ALL_STEPS.indexOf(step) - 1)] ?? steps[0];

  /** Swap the card, sliding forward or back depending on where it lands. */
  function goTo(next: StepName, list: StepName[] = steps) {
    setDirection(list.indexOf(next) >= list.indexOf(current) ? 'next' : 'prev');
    setStep(next);
    requestAnimationFrame(() => {
      document
        .getElementById('biodata-steps')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /** The step a biodata section is filled in on. */
  function stepForSection(section: string): StepName | null {
    if (section === 'personal' || section === 'religion') return 'basic';
    if (section === 'occupation') return 'education';
    if (section === 'marital') return steps.includes('marital') ? 'marital' : 'basic';
    return (steps as string[]).includes(section) ? (section as StepName) : null;
  }

  async function importDocument(fields: Record<string, string>, _documentUrl: string, key: string) {
    // Keep the source alongside the profile. The values themselves deliberately
    // remain drafts until the person has reviewed them in the normal forms.
    await api.put(`/profiles/${targetId}/details/source-document`, { key });
    seedImportedDrafts(targetId, fields);
    setImportedFields(fields);
    setImportRevision((revision) => revision + 1);
    goTo('basic');
    setNotice('Recognised details are ready to review. Items in red still need your input.');
    await qc.invalidateQueries({ queryKey: ['biodata', targetId] });
  }

  /**
   * Saves one or more sections in order, then moves to the next card.
   * Resolves true once the server has accepted all of them, false otherwise.
   */
  async function save(
    from: StepName,
    sections: [section: string, body: unknown][],
  ): Promise<boolean> {
    setError('');
    setNotice('');
    try {
      for (const [section, body] of sections) {
        await api.put(`/profiles/${targetId}/details/${section}`, body);
      }
      await qc.invalidateQueries({ queryKey: ['biodata', targetId] });
      // Preferences and income feed the match suggestions.
      if (sections.some(([section]) => section === 'preferences' || section === 'education')) {
        await Promise.all([
          qc.invalidateQueries({ queryKey: ['suggestions'] }),
          qc.invalidateQueries({ queryKey: ['recommended'] }),
        ]);
      }

      // Straight on to the next card. The steps are worked out from what was
      // just saved, since a new marital status can add or remove one.
      const saved = sections.find(([section]) => section === 'marital')?.[1] as
        | Draft
        | undefined;
      const list = stepsFor(saved?.maritalStatus ?? details.maritalStatus);
      const next = list[list.indexOf(from) + 1];
      if (next) {
        goTo(next, list);
        setNotice(`Saved. Next: ${STEP_TITLE[next]}.`);
      } else {
        setNotice('Saved. That is the last section.');
      }
      return true;
    } catch (err) {
      setError(apiMessage(err, 'That section could not be saved.'));
      return false;
    }
  }

  async function mutate(fn: () => Promise<unknown>) {
    setError('');
    try {
      await fn();
      qc.invalidateQueries({ queryKey: ['biodata', targetId] });
    } catch (err) {
      setError(apiMessage(err, 'That did not work.'));
    }
  }

  if (isAgent && !profileId) {
    return (
      <div className="space-y-4">
        <h1 className="page-title">Client biodata</h1>
        <ProfileSelector value={profileId} onChange={setProfileId} label="Client" />
        <p className="card text-sm text-gray-600">
          Pick a client to fill in their biodata. Everything here is what the other family will
          ask about, so a profile is not ready to circulate until it is complete.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        {isIndividual ? (
          <IndividualPageMasthead
            eyebrow="Your biodata"
            title="Build an introduction with care"
            description="Each section saves as you go, so you can return whenever you are ready."
            action={{ to: '/profile', label: 'Review personal details' }}
            density="quiet"
          />
        ) : (
          <div>
            <h1 className="page-title">Biodata</h1>
            <p className="page-subtitle">
              Saved section by section. You can stop and come back.
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <RequiredNote />
          {/*
            "Client" is an agency's word for an agency's business. A father
            filling in his daughter's biodata is not looking at a client, and
            being told he is reads as the platform having mistaken him for one.
          */}
          {isSteward && !isFamily && (
            <ProfileSelector
              value={profileId}
              onChange={setProfileId}
              label={isAgent ? 'Client' : 'Browsing as'}
            />
          )}
        </div>
      </div>

      {completion && (
        <section className="card space-y-2" aria-labelledby="biodata-readiness-heading">
          <div className="flex items-center justify-between">
            <h2 id="biodata-readiness-heading" className="font-semibold text-gray-900">
              {completion.complete ? 'Complete' : `${completion.percent}% complete`}
            </h2>
            {!completion.complete && (
              <p className="text-sm text-gray-600">
                {completion.missing.length} section{completion.missing.length === 1 ? '' : 's'} to go
              </p>
            )}
          </div>
          <div className="h-2 w-full overflow-hidden rounded-sm bg-gray-100">
            <div
              className="h-full rounded-sm bg-brand transition-all"
              style={{ width: `${completion.percent}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {completion.sections.map((s) => (
              <button
                key={s.section}
                onClick={() => {
                  if (s.section === 'identity') return setIdentityOpen(true);
                  const target = stepForSection(s.section);
                  if (target) goTo(target);
                }}
                className={`rounded-sm px-3 py-1 text-xs font-medium ${
                  s.complete ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
                }`}
              >
                {s.complete ? '✓' : '•'} {s.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {error && <p className="alert-critical">{error}</p>}
      {notice && <p className="alert-positive">{notice}</p>}

      {targetId && (
        <BiodataImport onImported={importDocument} />
      )}

      {/* The biodata document an agent created this profile from, if any. */}
      {typeof details.biodataDocumentUrl === 'string' && details.biodataDocumentUrl && (
        <p className="text-sm text-gray-600">
          Created from an uploaded biodata.{' '}
          <a className="text-brand" href={details.biodataDocumentUrl} target="_blank" rel="noreferrer">
            Open the original document
          </a>
        </p>
      )}

      {/*
        The thing they made, before the forms that made it. A read-back list is
        still a list; what somebody wants after filling this in is to see a
        photograph and a name.
      */}
      {targetId && Object.keys(details).length > 0 && (
        <ProfileCard
          profileId={targetId}
          profile={me ?? null}
          details={details}
          complete={completion?.complete ?? false}
          percent={completion?.percent ?? 0}
          onEdit={() => goTo('basic')}
          onPhotos={() => goTo('photos')}
          onView={() => setSavedOpen(true)}
          gender={profileGender ?? me?.gender ?? data?.gender}
        />
      )}

      {/*
        Read-back first, forms after. A form full of your own answers looks
        exactly like a form you have not filled in yet, which is why people
        saved, saw the same boxes and concluded nothing had been stored.
      */}
      <Accordion id="saved-details" title="Saved details" open={savedOpen} setOpen={setSavedOpen}>
        <SavedBiodata
          details={details}
          profile={sharedProfile ? { ...sharedProfile, gender: profileGender } : sharedProfile}
          siblings={siblings}
          assets={assets}
        />
      </Accordion>

      {/*
        One section at a time, in the same steps as the mobile app. Forms
        stacked on one page read as one very long form, and people stopped
        partway down it. A single card with "Step 3 of 7" and a way back is a
        much shorter-looking task.
      */}
      <StepCard
        current={current}
        steps={steps}
        direction={direction}
        onGo={goTo}
        completion={completion}
        missingFields={importedFields ? importedMissing(current, importedFields, details) : []}
      >
        {current === 'photos' &&
          (targetId ? (
            <div className="space-y-6">
              <ProfilePhotos profileId={targetId} gender={me?.gender ?? data?.gender} />
              {/* One group photograph of the family, kept apart from the profile photos. */}
              <section id="family-photo" key={targetId} className="space-y-3 border-t pt-4">
                <h3 className="font-semibold text-gray-800">Family photo</h3>
                {details.familyPhotoUrl && (
                  <img
                    src={details.familyPhotoUrl}
                    alt="Family photo"
                    className="max-h-80 object-contain"
                  />
                )}
                <PhotoUploader
                  label={details.familyPhotoUrl ? 'Replace family photo' : 'Upload family photo'}
                  onUploaded={(url) =>
                    mutate(() => api.put(`/profiles/${targetId}/details/family-photo`, { url }))
                  }
                />
              </section>
            </div>
          ) : (
            <p className="text-sm text-gray-400">Pick a profile first.</p>
          ))}

        {current === 'basic' && (
          <BasicInfoForm
            key={`basic:${targetId}:${importRevision}`}
            // The bride/groom's date of birth belongs to this managed profile and
            // must never be inherited from the logged-in family member's own
            // account DOB (EZ1-I182). `me.dateOfBirth` is the account holder's, so
            // it is not used here. Seed from the managed profile's own saved DOB —
            // the value `savePersonal` writes from this very form — but only once
            // the personal section has been filled in; before that the field
            // starts empty so the family enters the bride/groom's date
            // deliberately rather than carrying the parent's over.
            initial={{
              ...details,
              ...namesFrom(data?.displayName, details),
              dateOfBirth: data?.dateOfBirth ?? '',
            }}
            contact={contact}
            onSave={(sections) => save('basic', sections)}
            storageKey={`biodata:${targetId}`}
            /*
            Whose date of birth this field is for.

            Shown whenever the biodata being edited is not the viewer's own,
            which is exactly the case where the date belongs to somebody the
            viewer is entering it on behalf of — a family member filling in
            their daughter's, or an agent filling in a client's. An individual
            editing their own biodata does not see it, because their date is
            set on their profile instead (EZ1-I158).

            It used to read the viewer's own `managingFor` column, which is a
            self-description a family account has usually never filled in — so
            the field vanished and the bride's date of birth could not be
            entered at all, which is the other half of EZ1-I182. The value
            above seeds from `data`, the *managed* profile's own record, so the
            parent's date is never carried across either.
          */
            showDob={Boolean(targetId) && targetId !== me?.id}
          />
        )}

        {current === 'marital' && (
          <MaritalForm
            initial={details}
            onSave={(b) => save('marital', [['marital', b]])}
            storageKey={`biodata:${targetId}:marital`}
          />
        )}

        {current === 'education' && (
          <EducationForm
            initial={details}
            onSave={(b) => save('education', [['education', b]])}
            storageKey={`biodata:${targetId}:education`}
          />
        )}

        {current === 'family' && (
          <FamilyForm
            initial={details}
            isGroom={
              sharedProfile?.managingFor === 'groom' ||
              (!sharedProfile?.managingFor && String(sharedProfile?.gender ?? data?.gender ?? '').toLowerCase() === 'male')
            }
            siblings={siblings}
            assets={assets}
            onSave={(b) => save('family', [['family', b]])}
            storageKey={`biodata:${targetId}:family`}
            onAddSibling={(b) =>
              mutate(() => api.post(`/profiles/${targetId}/details/siblings`, b))
            }
            onRemoveSibling={(id) =>
              mutate(() => api.delete(`/profiles/${targetId}/details/siblings/${id}`))
            }
            onAddAsset={(b) => mutate(() => api.post(`/profiles/${targetId}/details/assets`, b))}
            onRemoveAsset={(id) =>
              mutate(() => api.delete(`/profiles/${targetId}/details/assets/${id}`))
            }
          />
        )}

        {current === 'horoscope' && (
          <HoroscopeForm
            initial={details}
            onSave={(b) => save('horoscope', [['horoscope', b]])}
            storageKey={`biodata:${targetId}:horoscope`}
          />
        )}

        {current === 'preferences' && (
          <PreferencesForm
            initial={details}
            onSave={(b) => save('preferences', [['preferences', b]])}
            storageKey={`biodata:${targetId}:preferences`}
          />
        )}
      </StepCard>

      {/* Its own screen on mobile, so not one of the steps here either. */}
      <Accordion title="Identity verification" open={identityOpen} setOpen={setIdentityOpen}>
        <AadhaarPanel profileId={targetId} />
      </Accordion>
    </div>
  );
}

/**
 * The order the form is filled in, matching the mobile app's steps.
 *
 * Saving a section moves to the next one rather than leaving somebody scrolling
 * back up to find where they were — which is the reported complaint, and the
 * reason people stopped halfway. Photographs come first here (last on mobile)
 * because the server will not save the personal details without three of them.
 */
const ALL_STEPS = [
  'photos',
  'basic',
  'marital',
  'education',
  'family',
  'horoscope',
  'preferences',
] as const;

type StepName = (typeof ALL_STEPS)[number];

/** What each step is called, in the header and the "next" line after a save. */
const STEP_TITLE: Record<StepName, string> = {
  photos: 'Photographs',
  basic: 'Basic Information',
  marital: 'Marital History',
  education: 'Education & Career',
  family: 'Family Background',
  horoscope: 'Horoscope',
  preferences: 'Partner Preferences',
};

const IMPORT_REQUIRED: Record<StepName, { key: string; label: string }[]> = {
  photos: [{ key: 'photos', label: 'Three profile photographs' }],
  basic: [
    { key: 'firstName', label: 'First name' }, { key: 'lastName', label: 'Last name' },
    { key: 'heightCm', label: 'Height' }, { key: 'complexion', label: 'Complexion' },
    { key: 'communicationAddress', label: 'Communication address' }, { key: 'religion', label: 'Religion' },
    { key: 'caste', label: 'Caste' }, { key: 'subCaste', label: 'Sub-caste' },
    { key: 'motherTongue', label: 'Mother tongue' }, { key: 'maritalStatus', label: 'Marital status' },
  ],
  marital: [],
  education: [
    { key: 'highestQualification', label: 'Highest qualification' },
    { key: 'occupationStatus', label: 'Occupation status' },
  ],
  family: [
    { key: 'fatherName', label: "Father's name" }, { key: 'motherName', label: "Mother's name" },
    { key: 'familyType', label: 'Family type' },
  ],
  horoscope: [{ key: 'horoscopeAvailable', label: 'Whether a horoscope is available' }],
  preferences: [{ key: 'preferences', label: 'Partner preferences' }],
};

function valueAt(source: Draft, key: string): unknown {
  if (key === 'horoscopeAvailable') return source.horoscopeAvailable;
  return source[key];
}

function importedMissing(step: StepName, fields: Record<string, string>, details: Draft): string[] {
  return IMPORT_REQUIRED[step]
    .filter(({ key }) => {
      const imported = fields[key];
      if (key === 'complexion' && imported) return !importedChoice(imported, Object.keys(COMPLEXION_LABEL));
      if (key === 'maritalStatus' && imported) return !importedChoice(imported, SELF_MARITAL_STATUSES);
      if (key === 'familyType' && imported) return !importedChoice(imported, Object.keys(FAMILY_TYPE_LABEL));
      return !String(imported ?? valueAt(details, key) ?? '').trim();
    })
    .map(({ label }) => label);
}

function occupationFromImport(fields: Record<string, string>): OccupationStatus {
  const source = `${fields.occupationStatus ?? ''} ${fields.profession ?? ''}`.toLowerCase();
  if (/self|business|entrepreneur/.test(source)) return 'self_employed';
  if (/student/.test(source)) return 'student';
  if (/home.?maker/.test(source)) return 'homemaker';
  if (/retired/.test(source)) return 'retired';
  if (/unemployed|not employed/.test(source)) return 'not_employed';
  return 'employed';
}

function importedChoice(value: string | undefined, choices: readonly string[]): string | undefined {
  const normalised = String(value ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  return choices.includes(normalised) ? normalised : undefined;
}

function seedImportedDrafts(profileId: string, fields: Record<string, string>) {
  const prefix = `biodata:${profileId}`;
  const take = (...keys: string[]) => Object.fromEntries(
    keys.filter((key) => fields[key]).map((key) => [key, fields[key]]),
  );
  const personal = take(
    'firstName', 'lastName', 'dateOfBirth', 'heightCm', 'complexion', 'communicationAddress', 'alternateMobile',
  );
  const complexion = importedChoice(fields.complexion, Object.keys(COMPLEXION_LABEL));
  if (complexion) personal.complexion = complexion;
  else delete personal.complexion;
  saveDraft(`${prefix}:personal`, personal);
  saveDraft(`${prefix}:religion`, take('religion', 'caste', 'subCaste', 'motherTongue'));
  const maritalStatus = importedChoice(fields.maritalStatus, SELF_MARITAL_STATUSES);
  saveDraft(`${prefix}:status`, maritalStatus ? { maritalStatus } : {});
  saveDraft(`${prefix}:education`, {
    status: occupationFromImport(fields),
    values: {
      ...take('highestQualification', 'course', 'institution', 'collegePlace', 'company', 'designation', 'workLocation', 'salary'),
      businessEntries: [{}], otherIncome: [], incomeVisible: false,
    },
  });
  const family = take(
    'fatherName', 'fatherProfession', 'motherName', 'motherProfession', 'familyType', 'familyStatus',
    'nativePlace', 'nativeState', 'nativeCountry', 'nativeDistrict', 'brothers', 'sisters',
  );
  const familyType = importedChoice(fields.familyType, Object.keys(FAMILY_TYPE_LABEL));
  if (familyType) family.familyType = familyType;
  else delete family.familyType;
  const familyStatus = importedChoice(fields.familyStatus, Object.keys(FAMILY_STATUS_LABEL));
  if (familyStatus) family.familyStatus = familyStatus;
  else delete family.familyStatus;
  saveDraft(`${prefix}:family`, family);
  const horoscope = take('rashi', 'star', 'padam', 'gothram', 'kujaDosham', 'timeOfBirth');
  if (fields.placeOfBirth) horoscope.birthCity = fields.placeOfBirth;
  saveDraft(`${prefix}:horoscope`, { available: Boolean(Object.keys(horoscope).length), values: horoscope });
}

/** Marital history is a step only for somebody who has been married. */
function stepsFor(maritalStatus: unknown): StepName[] {
  const married = Boolean(maritalStatus) && maritalStatus !== 'never_married';
  return ALL_STEPS.filter((s) => s !== 'marital' || married);
}

function Accordion({
  id,
  title,
  open,
  setOpen,
  children,
}: {
  id?: string;
  title: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div id={id} className="card">
      <button
        className="flex w-full items-center justify-between text-left"
        onClick={() => setOpen(!open)}
      >
        <span className="font-serif text-[1.375rem] font-normal text-brand">{title}</span>
        <span className="text-gray-400">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="mt-4">{children}</div>}
    </div>
  );
}

/**
 * The biodata as a deck of cards, one step showing at a time, as on mobile.
 *
 * Saving a form swaps in the next card on its own; Back and Skip are here for
 * the photographs (nothing to save) and for somebody who wants to come back
 * to a step later.
 */
function StepCard({
  current,
  steps,
  direction,
  onGo,
  completion,
  missingFields = [],
  children,
}: {
  current: StepName;
  steps: StepName[];
  direction: 'next' | 'prev';
  onGo: (step: StepName) => void;
  completion?: Completion;
  missingFields?: string[];
  children: ReactNode;
}) {
  const index = steps.indexOf(current);
  const prev = index > 0 ? steps[index - 1] : null;
  const next = index < steps.length - 1 ? steps[index + 1] : null;
  // Basic information is two server sections; it is done when both are.
  const sectionsOf: Record<StepName, string[]> = {
    photos: [],
    basic: ['personal', 'religion'],
    marital: ['marital'],
    education: ['education', 'occupation'],
    family: ['family'],
    horoscope: ['horoscope'],
    preferences: ['preferences'],
  };
  const done = (name: StepName) =>
    sectionsOf[name].length > 0 &&
    sectionsOf[name].every(
      (s) => completion?.sections.find((sec) => sec.section === s)?.complete ?? false,
    );

  return (
    <section id="biodata-steps" className="scroll-mt-4" aria-label="Biodata steps">
      <div className="overflow-hidden">
        <div
          // A new key per section remounts the card, which is what plays the
          // swap; the direction decides which side it comes in from.
          key={current}
          className={`card ${direction === 'next' ? 'card-swap-next' : 'card-swap-prev'}`}
        >
          <header className="mb-4 flex items-baseline justify-between gap-3 border-b pb-3">
            <h2 className="font-serif text-[1.375rem] font-normal text-brand">
              {STEP_TITLE[current]}
              {done(current) && (
                <span className="ml-3 whitespace-nowrap font-sans text-[0.6875rem] uppercase tracking-[0.18em] text-emerald-700">
                  ✓ Saved
                </span>
              )}
            </h2>
            <span className="whitespace-nowrap font-sans text-[0.6875rem] uppercase tracking-[0.22em] text-gold-deep">
              Step {index + 1} of {steps.length}
            </span>
          </header>

          {missingFields.length > 0 && (
            <div className="mb-4 border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-900" role="status">
              <span className="font-semibold">Needs your input:</span>{' '}
              {missingFields.join(', ')}.
            </div>
          )}

          {children}

          <footer className="mt-6 flex items-center justify-between gap-3 border-t pt-4">
            <button
              type="button"
              className="btn-ghost"
              disabled={!prev}
              onClick={() => prev && onGo(prev)}
            >
              ← Back
            </button>
            {next ? (
              <button type="button" className="btn-outline btn-sm" onClick={() => onGo(next)}>
                {current === 'photos' || done(current) ? 'Continue' : 'Skip'} →
              </button>
            ) : (
              <span className="text-xs text-gray-500">Last step</span>
            )}
          </footer>
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  children,
  hint,
  required = false,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  /** Keep the visible label aligned with the control's native requirement. */
  required?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="text-gray-700">
        {label}
        {required && <RequiredMark />}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
    </label>
  );
}

function useDraft(initial: Draft, keys: string[], storageKey?: string) {
  const seed = (): Draft => {
    const next: Draft = {};
    for (const key of keys) next[key] = initial?.[key] ?? '';
    return next;
  };
  // Only an edited draft is written (EZ1-I236); see createDraftGuard.
  const [guard] = useState(createDraftGuard);
  const [draft, seedDraft] = useState<Draft>(() => loadDraft(storageKey) ?? seed());
  useEffect(() => {
    // Prefer an unsaved local draft over re-seeding from the server (EZ1-I73).
    const stored = loadDraft(storageKey);
    guard.seeded(Boolean(stored));
    seedDraft(stored ?? seed());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initial), keys.join(','), storageKey]);

  useEffect(() => {
    guard.persist(storageKey, draft);
  }, [guard, storageKey, draft]);

  const edit = guard.edit((fn: (d: Draft) => Draft) => seedDraft(fn));
  const set = (key: string) => (e: { target: { value: string } }) =>
    edit((d) => ({ ...d, [key]: e.target.value }));
  /** For controls that hand back a value rather than an event. */
  const put = (key: string) => (value: string) => edit((d) => ({ ...d, [key]: value }));
  const clear = () => guard.clear(storageKey);
  return { draft, setDraft: edit, set, put, clear };
}

/**
 * Personal details, religion and marital status on one card, as the mobile
 * app's "Basic Information" step asks them. Three server sections, one save.
 */
function BasicInfoForm({
  initial,
  contact,
  onSave,
  storageKey,
  showDob = false,
}: {
  initial: Draft;
  contact?: ContactBlock;
  onSave: (sections: [section: string, body: unknown][]) => Promise<boolean>;
  /** Prefix for the local drafts; each section keeps its own. */
  storageKey?: string;
  /** Family login only: the bride/groom's date of birth is entered here. */
  showDob?: boolean;
}) {
  const keys = [
    'firstName',
    'lastName',
    'dateOfBirth',
    'heightCm',
    'complexion',
    'communicationAddress',
    'alternateMobile',
  ];
  const personal = useDraft(initial, keys, storageKey && `${storageKey}:personal`);
  const faith = useDraft(
    initial,
    ['religion', 'caste', 'subCaste', 'motherTongue'],
    storageKey && `${storageKey}:religion`,
  );
  const marital = useDraft(initial, ['maritalStatus'], storageKey && `${storageKey}:status`);
  const { draft, set } = personal;
  const put = faith.put;
  const status = String(marital.draft.maritalStatus ?? '');

  const religion = String(faith.draft.religion ?? '');
  /*
   * Castes follow the religion, not one list for everybody.
   *
   * Offering a Hindu caste list to a Christian family is not a neutral
   * mistake. Religions with no caste structure get an empty list, and the
   * field then offers only the free-text box. The sub-castes come from the
   * same catalogue, under the caste they belong to.
   */
  const { data: casteCatalog } = useQuery({
    queryKey: ['reference', 'castes'],
    queryFn: async () => (await api.get('/reference/castes')).data,
    staleTime: 60 * 60 * 1000,
  });
  const casteEntries = ((casteCatalog?.castes ?? []) as CasteEntry[]).filter((entry) =>
    entry.religions.includes(religion),
  );
  const casteOptions = casteEntries.length
    ? casteEntries.map((entry) => entry.casteName)
    : (CASTES_BY_RELIGION[religion] ?? []);
  const caste = String(faith.draft.caste ?? '');
  const subCasteOptions = (
    casteEntries.find((entry) => entry.casteName === caste)?.subCastes ?? []
  ).map((entry) => entry.subCasteName);

  function submit(e: FormEvent) {
    e.preventDefault();
    const sections: [string, unknown][] = [
      [
        'personal',
        {
          ...draft,
          heightCm: Number(draft.heightCm) || undefined,
          // null, not undefined: an absent field is left alone by the server,
          // so emptying the box has to be said explicitly.
          alternateMobile: draft.alternateMobile || null,
          // Only meaningful for a family login; blank otherwise, and the server
          // ignores it for a self-registered individual (EZ1-I158).
          dateOfBirth: draft.dateOfBirth || undefined,
        },
      ],
      // Denomination is deliberately not sent: the field is gone, and the
      // server treats it as optional, so an old value simply stops being
      // rewritten. Nothing is deleted from rows that already have one.
      ['religion', faith.draft],
    ];
    // Only when it has changed: saving the status alone replaces the marital
    // history, so re-saving this card must not wipe what the next step holds.
    if (status && status !== initial?.maritalStatus) {
      sections.push(['marital', { maritalStatus: status }]);
    }
    // The local copies go only once the server has everything: until then
    // they are the only copy, and a refused save must not lose them (EZ1-I73).
    void submitDraft(onSave(sections), () => {
      personal.clear();
      faith.clear();
      marital.clear();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="First name" hint="What people call you" required>
          <input className="input mt-1" value={String(draft.firstName ?? '')} onChange={set('firstName')} required />
        </Field>
        {/*
          One name field. The two used to be separate — in much of India the
          house or gothram name and the family name are different words — but
          they were read as duplicates often enough that a single field is the
          clearer answer.
        */}
        <Field label="Last name" hint="Family name, as on your documents" required>
          <input className="input mt-1" value={String(draft.lastName ?? '')} onChange={set('lastName')} required />
        </Field>
        {/*
          The bride/groom's date of birth, shown only for a family member
          filling this in on their behalf (EZ1-I158). An individual sets their
          own date of birth on their profile, so the field is not shown to them
          here.
        */}
        {showDob && (
          <Field label="Bride/Groom date of birth" hint="Of the person this profile is for" required>
            <input
              className="input mt-1"
              type="date"
              value={String(draft.dateOfBirth ?? '')}
              onChange={set('dateOfBirth')}
              required
            />
          </Field>
        )}
        <Field label="Height" required>
          <HeightInput
            value={draft.heightCm}
            onChange={(value) => set('heightCm')({ target: { value } })}
            required
          />
        </Field>
        <Field label="Complexion" required>
          <select
            className="input mt-1"
            value={String(draft.complexion ?? '')}
            onChange={set('complexion')}
            required
          >
            <option value="">Select…</option>
            {Object.entries(COMPLEXION_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {/*
          The primary number lives on the account, not the biodata, so it is
          shown here rather than edited here. Without it the page appeared to
          have lost the main number entirely, which is what was reported.
        */}
        <Field
          label="Primary mobile"
          hint={
            contact?.primaryMobileSource === 'agency_record'
              ? 'Taken by the agency. Changes when the profile is claimed.'
              : contact?.primaryMobileSource === 'profile'
                ? 'Your main profile number. Update it in Your Profile.'
                : 'Your sign-in number. Change it under Security.'
          }
        >
          <div className="input mt-1 flex items-center justify-between bg-gray-50">
            <span className={contact?.primaryMobile ? 'text-gray-900' : 'text-gray-400'}>
              {contact?.primaryMobile ?? 'Not on file'}
            </span>
            {contact?.primaryMobile && (
              <span
                className={`rounded-sm px-2 py-0.5 text-xs ${
                  contact.primaryMobileVerified
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'bg-amber-50 text-amber-800'
                }`}
              >
                {contact.primaryMobileVerified ? 'Verified' : 'Not verified'}
              </span>
            )}
          </div>
        </Field>
        <Field label="Alternate mobile" hint="Optional: often the family's number">
          <input
            className="input mt-1"
            inputMode="tel"
            value={String(draft.alternateMobile ?? '')}
            onChange={set('alternateMobile')}
          />
        </Field>
      </div>
      <Field label="Communication address" required>
        <textarea
          className="input mt-1"
          rows={2}
          value={String(draft.communicationAddress ?? '')}
          onChange={set('communicationAddress')}
          required
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <ChoiceField
          label="Religion"
          value={religion}
          onChange={(value) => {
            put('religion')(value);
            put('caste')('');
            put('subCaste')('');
          }}
          options={RELIGIONS}
          required
          markRequired
        />
        <ChoiceField
          label="Caste"
          value={caste}
          onChange={(value) => {
            put('caste')(value);
            put('subCaste')('');
          }}
          options={casteOptions}
          hint={
            religion
              ? 'Options are commonly reported labels and may vary by region.'
              : 'Pick a religion first, or type the caste.'
          }
          required
          markRequired
        />
        {/*
          The catalogue lists the common sub-castes under each caste; there
          are thousands and they vary by district, so the free-text escape
          stays for everything it does not name.
        */}
        <ChoiceField
          key={caste}
          label="Sub-caste"
          value={String(faith.draft.subCaste ?? '')}
          onChange={put('subCaste')}
          options={subCasteOptions}
          otherOption="Other / Not Listed"
          disabled={!caste}
          hint={caste ? undefined : 'Select a caste first.'}
          required
          markRequired
        />
        <ChoiceField
          label="Mother tongue"
          value={String(faith.draft.motherTongue ?? '')}
          onChange={put('motherTongue')}
          options={MOTHER_TONGUES}
          required
          markRequired
        />
        {/*
          Asked here, as on mobile, so the marital history step can appear
          only for somebody who has been married.
        */}
        <Field label="Marital status" required>
          <select
            className="input mt-1"
            value={status}
            onChange={(e) => marital.put('maritalStatus')(e.target.value)}
            required
          >
            <option value="">Select…</option>
            {SELF_MARITAL_STATUSES.map((value) => (
              <option key={value} value={value}>
                {MARITAL_LABEL[value]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <button className="btn">Save and continue</button>
    </form>
  );
}

/**
 * Rupees, grouped the Indian way.
 *
 * 75,00,000 rather than 7,500,000 — the grouping is not decoration, it is how
 * the number is read aloud, and a lakh written in thousands has to be counted
 * on fingers before it means anything.
 */
function rupees(value: number | string): string {
  const amount = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(amount)) return String(value);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function HoroscopeForm({
  initial,
  onSave,
  storageKey,
}: {
  initial: Draft;
  onSave: (b: Draft) => Promise<boolean>;
  storageKey?: string;
}) {
  const chart = (initial?.horoscope ?? {}) as Draft;
  // Only an edited draft is written (EZ1-I236); see createDraftGuard.
  const [guard] = useState(createDraftGuard);
  const stored0 = loadDraft(storageKey);
  const [available, seedAvailable] = useState(
    stored0 ? Boolean(stored0.available) : Boolean(initial?.horoscopeAvailable),
  );
  const [values, seedValues] = useState<Draft>(
    stored0 ? ((stored0.values as Draft) ?? {}) : {},
  );

  useEffect(() => {
    // An unsaved draft wins over re-seeding from the server (EZ1-I73).
    const stored = loadDraft(storageKey);
    guard.seeded(Boolean(stored));
    if (stored) {
      seedAvailable(Boolean(stored.available));
      seedValues((stored.values as Draft) ?? {});
      return;
    }
    seedAvailable(Boolean(initial?.horoscopeAvailable));
    const place = (chart.birthPlace ?? {}) as Draft;
    seedValues({
      rashi: chart.rashi ?? '',
      star: chart.star ?? '',
      padam: chart.padam ?? '',
      gothram: chart.gothram ?? '',
      kujaDosham: chart.kujaDosham ?? '',
      timeOfBirth: chart.timeOfBirth ?? '',
      birthCity: place.city ?? '',
      birthState: place.state ?? '',
      birthCountry: place.country ?? '',
      horoscopeDocumentUrl: initial?.horoscopeDocumentUrl ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initial), storageKey]);

  useEffect(() => {
    guard.persist(storageKey, { available, values });
  }, [guard, storageKey, available, values]);

  const setAvailable = guard.edit(seedAvailable);
  const setValues = guard.edit(seedValues);

  const set = (k: string) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));
  const put = (k: string) => (value: string) => setValues((v) => ({ ...v, [k]: value }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        /*
         * Where and when somebody was born is true either way.
         *
         * These used to live inside the "a horoscope is available" branch, so
         * a family that does not keep one could not record a birthplace they
         * plainly know. The requirement is explicit that all three of place,
         * time and document are optional and none of them gates a save.
         */
        const place = {
          ...(values.birthCity ? { city: String(values.birthCity) } : {}),
          ...(values.birthState ? { state: String(values.birthState) } : {}),
          ...(values.birthCountry ? { country: String(values.birthCountry) } : {}),
        };
        const always = {
          ...(values.timeOfBirth ? { timeOfBirth: String(values.timeOfBirth) } : {}),
          ...(Object.keys(place).length ? { birthPlace: place } : {}),
          ...(values.horoscopeDocumentUrl
            ? { horoscopeDocumentUrl: String(values.horoscopeDocumentUrl) }
            : {}),
        };
        const chartOnly = ['rashi', 'star', 'padam', 'gothram', 'kujaDosham'];
        const sent = onSave(
          available
            ? {
                horoscopeAvailable: true,
                ...Object.fromEntries(
                  Object.entries(values).filter(([k, v]) => chartOnly.includes(k) && v !== ''),
                ),
                ...always,
              }
            : { horoscopeAvailable: false, ...always },
        );
        void submitDraft(sent, () => guard.clear(storageKey));
      }}
      className="space-y-3"
    >
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={available}
          onChange={(e) => setAvailable(e.target.checked)}
        />
        <span>A horoscope is available</span>
      </label>
      <p className="text-xs text-gray-500">
        Answering &ldquo;no&rdquo; completes this section, plenty of families do not use one.
      </p>

      {available && (
        <div className="grid gap-3 sm:grid-cols-3">
          <ChoiceField
            label="Rashi"
            value={String(values.rashi ?? '')}
            onChange={put('rashi')}
            options={RASHIS}
            allowOther={false}
            required
          />
          <ChoiceField
            label="Star / Nakshatra"
            value={String(values.star ?? '')}
            onChange={put('star')}
            options={NAKSHATRAS}
            allowOther={false}
          />
          <ChoiceField
            label="Padam"
            value={String(values.padam ?? '')}
            onChange={put('padam')}
            options={PADAMS}
            allowOther={false}
          />
          {/* Gothrams run to thousands; the list is empty and the box is the point. */}
          <ChoiceField
            label="Gothram"
            value={String(values.gothram ?? '')}
            onChange={put('gothram')}
            options={[]}
          />
          <Field label="Kuja Dosham">
            <select className="input mt-1" value={String(values.kujaDosham ?? '')} onChange={set('kujaDosham')}>
              <option value="">Not stated</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
              <option value="unknown">Unknown</option>
            </select>
          </Field>
        </div>
      )}

      {/*
        Outside the checkbox on purpose.

        Where and when somebody was born is true whether or not the family
        keeps a chart, and the requirement is explicit that none of these three
        may block a save.
      */}
      <div className="grid gap-3 border-t pt-3 sm:grid-cols-4">
        {/*
          Country → State → City, dependent. Choosing the country narrows the
          state list and choosing the state narrows the city list, so an
          Australian birthplace no longer offers Indian states and cities.
        */}
        <DependentLocation
          country={String(values.birthCountry ?? '')}
          state={String(values.birthState ?? '')}
          city={String(values.birthCity ?? '')}
          onCountry={put('birthCountry')}
          onState={put('birthState')}
          onCity={put('birthCity')}
          labels={{ country: 'Birth country', state: 'Birth state', city: 'Birth city' }}
        />
        <Field label="Time of birth" hint="Optional">
          <input className="input mt-1" type="time" value={String(values.timeOfBirth ?? '')} onChange={set('timeOfBirth')} />
        </Field>
      </div>

      {/*
        The chart itself, back where it belongs.

        This lived on Partner Preferences — the screen for what you want of
        somebody else — so the section describing your own horoscope had no way
        to attach one. Optional: ticking "a horoscope is available" says a
        chart exists, not that it has been scanned.
      */}
      <div className="space-y-3 rounded-sm border border-gray-200 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-gray-800">Horoscope document</p>
            {/*
              What actually happens to it, which is not what this said.
              The chart is on the profile card from the start — families compare
              charts before deciding whether to send interest at all, which is
              why it is not held back with the rest of the private biodata
              (EZ1-I231). Telling somebody it is only shared after an accept,
              while showing it before one, is the worst of both.
            */}
            <p className="text-xs text-gray-500">
              Optional. A JPG, PNG or PDF. Anyone who can see your profile can open it — families
              compare charts before deciding whether to send interest.
            </p>
          </div>
          <PhotoUploader
            kind="attachment"
            label={values.horoscopeDocumentUrl ? 'Replace chart' : 'Attach chart'}
            onUploaded={(url: string) => setValues((v) => ({ ...v, horoscopeDocumentUrl: url }))}
          />
        </div>
        {values.horoscopeDocumentUrl ? (
          <div className="flex flex-wrap items-start gap-3 rounded-sm bg-surface-sunken p-3">
            {/*
              A PDF is not an image, and was drawn as one: the thumbnail was a
              broken-image icon, which reads as an upload that failed. Whether
              the file can be shown is decided by what it is (EZ1-I231).
            */}
            <a
              href={String(values.horoscopeDocumentUrl)}
              target="_blank"
              rel="noreferrer"
              className="shrink-0"
              title="Open the full chart"
            >
              {isChartImage(String(values.horoscopeDocumentUrl)) ? (
                <img
                  src={String(values.horoscopeDocumentUrl)}
                  alt="The horoscope chart you attached"
                  className="h-28 w-28 rounded-sm border border-gray-200 bg-surface object-cover"
                />
              ) : (
                <span className="flex h-28 w-28 flex-col items-center justify-center gap-1 rounded-sm border border-gray-200 bg-surface text-xs text-brand-strong">
                  <FileText size={28} aria-hidden />
                  Open the chart
                </span>
              )}
            </a>
            <div className="min-w-[12rem] flex-1 space-y-1">
              <p className="text-sm font-medium text-gray-800">
                {isChartImage(String(values.horoscopeDocumentUrl))
                  ? 'Chart attached'
                  : 'Chart attached as a document'}
              </p>
              <button
                type="button"
                className="btn-ghost btn-sm -ml-2 text-critical-fg"
                onClick={() => setValues((v) => ({ ...v, horoscopeDocumentUrl: '' }))}
              >
                Remove chart
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <button className="btn">Save horoscope</button>
    </form>
  );
}

function MaritalForm({
  initial,
  onSave,
  storageKey,
}: {
  initial: Draft;
  onSave: (b: Draft) => Promise<boolean>;
  storageKey?: string;
}) {
  const history = (initial?.maritalHistory ?? {}) as Draft;
  // Only an edited draft is written (EZ1-I236); see createDraftGuard.
  const [guard] = useState(createDraftGuard);
  const stored0 = loadDraft(storageKey);
  const [status, seedStatus] = useState<MaritalStatus>(
    stored0
      ? (stored0.status as MaritalStatus)
      : ((initial?.maritalStatus as MaritalStatus) ?? 'never_married'),
  );
  const [values, seedValues] = useState<Draft>(stored0 ? ((stored0.values as Draft) ?? {}) : {});

  useEffect(() => {
    const stored = loadDraft(storageKey);
    guard.seeded(Boolean(stored));
    if (stored) {
      seedStatus(stored.status as MaritalStatus);
      seedValues((stored.values as Draft) ?? {});
      return;
    }
    seedStatus((initial?.maritalStatus as MaritalStatus) ?? 'never_married');
    seedValues({
      marriageDate: history.marriageDate ?? '',
      divorceDate: history.divorceDate ?? '',
      yearsMarried: history.yearsMarried ?? '',
      hasChildren: history.hasChildren ?? false,
      boys: history.boys ?? '',
      girls: history.girls ?? '',
      childrenLivingWith: history.childrenLivingWith ?? '',
      reason: history.reason ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initial), storageKey]);

  useEffect(() => {
    guard.persist(storageKey, { status, values });
  }, [guard, storageKey, status, values]);

  const setStatus = guard.edit(seedStatus);
  const setValues = guard.edit(seedValues);

  const set = (k: string) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const body: Draft = { maritalStatus: status };
        if (status !== 'never_married') {
          if (values.marriageDate) body.marriageDate = values.marriageDate;
          if (values.divorceDate) body.divorceDate = values.divorceDate;
          if (values.yearsMarried) body.yearsMarried = Number(values.yearsMarried);
          body.hasChildren = Boolean(values.hasChildren);
          if (values.boys !== '') body.boys = Number(values.boys);
          if (values.girls !== '') body.girls = Number(values.girls);
          if (values.childrenLivingWith) body.childrenLivingWith = values.childrenLivingWith;
          if (values.reason) body.reason = values.reason;
        }
        void submitDraft(onSave(body), () => guard.clear(storageKey));
      }}
      className="space-y-3"
    >
      <Field label="Marital status">
        <select
          className="input mt-1"
          value={status}
          onChange={(e) => setStatus(e.target.value as MaritalStatus)}
        >
          {SELF_MARITAL_STATUSES.map((value) => (
            <option key={value} value={value}>
              {MARITAL_LABEL[value]}
            </option>
          ))}
        </select>
      </Field>

      {/*
        Asked only where it applies, and never required. Somebody who would
        rather not explain must still be able to finish the section — a
        mandatory box here gets answered with a full stop, which is worse than
        silence because it looks like an answer.
      */}
      {(status === 'divorced' || status === 'separated') && (
        <Field
          label="What happened, if you would like to say"
          hint="Optional. Shown only to people who can already see your marital history."
        >
          <textarea
            className="input mt-1"
            rows={3}
            maxLength={2000}
            value={String(values.reason ?? '')}
            onChange={set('reason')}
          />
        </Field>
      )}

      {status !== 'never_married' && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Marriage date">
            <input className="input mt-1" type="date" value={String(values.marriageDate ?? '')} onChange={set('marriageDate')} />
          </Field>
          <Field label="Divorce / separation date">
            <input className="input mt-1" type="date" value={String(values.divorceDate ?? '')} onChange={set('divorceDate')} />
          </Field>
          <Field label="Years married">
            <input className="input mt-1" type="number" min={0} value={String(values.yearsMarried ?? '')} onChange={set('yearsMarried')} />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-3">
            <input
              type="checkbox"
              checked={Boolean(values.hasChildren)}
              onChange={(e) => setValues((v) => ({ ...v, hasChildren: e.target.checked }))}
            />
            <span>There are children</span>
          </label>
          {Boolean(values.hasChildren) && (
            <>
              <Field label="Boys">
                <input className="input mt-1" type="number" min={0} value={String(values.boys ?? '')} onChange={set('boys')} />
              </Field>
              <Field label="Girls">
                <input className="input mt-1" type="number" min={0} value={String(values.girls ?? '')} onChange={set('girls')} />
              </Field>
              <Field label="Living with">
                <input className="input mt-1" value={String(values.childrenLivingWith ?? '')} onChange={set('childrenLivingWith')} />
              </Field>
            </>
          )}
        </div>
      )}
      <button className="btn">Save marital status</button>
    </form>
  );
}

/**
 * Where the family is from.
 *
 * Asked here rather than in the personal section: it is a fact about a family,
 * which is what the other side is asking when they ask, and it used to sit
 * beside a "place of birth" that people answered as though it were the same
 * question.
 */
function FamilyForm({
  initial,
  isGroom,
  siblings,
  assets,
  onSave,
  onAddSibling,
  onRemoveSibling,
  onAddAsset,
  onRemoveAsset,
  storageKey,
}: {
  initial: Draft;
  isGroom: boolean;
  siblings: Sibling[];
  assets: Asset[];
  onSave: (b: Draft) => Promise<boolean>;
  onAddSibling: (b: Draft) => void;
  onRemoveSibling: (id: string) => void;
  onAddAsset: (b: Draft) => void;
  onRemoveAsset: (id: string) => void;
  storageKey?: string;
}) {
  const father = (initial?.father ?? {}) as Draft;
  const mother = (initial?.mother ?? {}) as Draft;
  // Only an edited draft is written (EZ1-I236); see createDraftGuard.
  const [guard] = useState(createDraftGuard);
  const [values, seedValues] = useState<Draft>(() => (loadDraft(storageKey) as Draft) ?? {});
  const [sibling, setSibling] = useState<Draft>({ name: '' });
  const [asset, setAsset] = useState<Draft>({ type: 'independent_house' });

  useEffect(() => {
    const stored = loadDraft(storageKey);
    guard.seeded(Boolean(stored));
    if (stored) {
      seedValues(stored);
      return;
    }
    seedValues({
      fatherName: father.name ?? '',
      fatherProfession: father.profession ?? '',
      // Accepted by the API from the beginning and never asked for here, so
      // every profile on the platform carries an empty one.
      fatherLifeStatus: father.lifeStatus ?? '',
      motherName: mother.name ?? '',
      motherProfession: mother.profession ?? '',
      motherLifeStatus: mother.lifeStatus ?? '',
      familyType: initial?.familyType ?? 'nuclear',
      familyStatus: initial?.familyStatus ?? '',
      nativePlace: initial?.nativePlace ?? '',
      nativeState: initial?.nativeState ?? '',
      nativeCountry: initial?.nativeCountry ?? '',
      nativeDistrict: initial?.nativeDistrict ?? '',
      isNri: Boolean(initial?.isNri),
      nriCity: initial?.nriCity ?? '',
      nriCountry: initial?.nriCountry ?? '',
      brothers: initial?.brothers ?? 0,
      sisters: initial?.sisters ?? 0,
      // `numeric` comes back from the API as a string, so it is kept as one
      // here and only converted on the way out.
      familyNetWorth: initial?.familyNetWorth ?? '',
      familyNetWorthVisible: Boolean(initial?.familyNetWorthVisible),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initial), storageKey]);

  useEffect(() => {
    guard.persist(storageKey, values);
  }, [guard, storageKey, values]);

  const setValues = guard.edit(seedValues);

  const set = (k: string) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));
  const put = (k: string) => (value: string) => setValues((v) => ({ ...v, [k]: value }));

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const sent = onSave({
            father: {
              name: values.fatherName,
              profession: values.fatherProfession || undefined,
              lifeStatus: values.fatherLifeStatus || undefined,
            },
            mother: {
              name: values.motherName,
              profession: values.motherProfession || undefined,
              lifeStatus: values.motherLifeStatus || undefined,
            },
            familyType: values.familyType,
            familyStatus: values.familyStatus,
            nativePlace: values.nativePlace || undefined,
            nativeState: values.nativeState || undefined,
            nativeCountry: values.nativeCountry || undefined,
            nativeDistrict: values.nativeDistrict || undefined,
            isNri: Boolean(values.isNri),
            // Only sent when the answer is yes. A city and country left behind
            // by somebody who changed their mind would otherwise stay on the
            // record, invisible, and reappear if the answer ever flipped back.
            nriCity: values.isNri ? values.nriCity || undefined : undefined,
            nriCountry: values.isNri ? values.nriCountry || undefined : undefined,
            brothers: Number(values.brothers) || 0,
            sisters: Number(values.sisters) || 0,
            ...(isGroom
              ? {
                  familyNetWorth: Number(values.familyNetWorth),
                  familyNetWorthVisible: Boolean(values.familyNetWorthVisible),
                }
              : {}),
          });
          void submitDraft(sent, () => guard.clear(storageKey));
        }}
        className="space-y-3"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Father's name" required>
            <input className="input mt-1" value={String(values.fatherName ?? '')} onChange={set('fatherName')} required />
          </Field>
          <Field label="Father's profession">
            <ChoiceField
              label=""
              value={String(values.fatherProfession ?? '')}
              onChange={put('fatherProfession')}
              options={PROFESSIONS}
            />
          </Field>
          {/*
            Living status sits directly under each parent rather than as a pair
            of fields further down, so it reads as a fact about that person and
            not as a separate question about the family.
          */}
          <Field label="Father's living status">
            <select
              className="input mt-1"
              value={String(values.fatherLifeStatus ?? '')}
              onChange={set('fatherLifeStatus')}
            >
              <option value="">Not said</option>
              <option value="alive">{LIFE_STATUS_LABEL.alive}</option>
              <option value="deceased">{LIFE_STATUS_LABEL.deceased}</option>
            </select>
          </Field>
          <Field label="Mother's name" required>
            <input className="input mt-1" value={String(values.motherName ?? '')} onChange={set('motherName')} required />
          </Field>
          <Field label="Mother's profession">
            <ChoiceField
              label=""
              value={String(values.motherProfession ?? '')}
              onChange={put('motherProfession')}
              options={PROFESSIONS}
            />
          </Field>
          <Field label="Mother's living status">
            <select
              className="input mt-1"
              value={String(values.motherLifeStatus ?? '')}
              onChange={set('motherLifeStatus')}
            >
              <option value="">Not said</option>
              <option value="alive">{LIFE_STATUS_LABEL.alive}</option>
              <option value="deceased">{LIFE_STATUS_LABEL.deceased}</option>
            </select>
          </Field>
          <Field label="Family type">
            <select className="input mt-1" value={String(values.familyType ?? '')} onChange={set('familyType')}>
              {Object.entries(FAMILY_TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Family status" required>
            <select
              className="input mt-1"
              value={String(values.familyStatus ?? '')}
              onChange={set('familyStatus')}
              required
            >
              <option value="">Select…</option>
              {Object.entries(FAMILY_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          {/*
            Native place is a hierarchy, not a town: Country → State → District,
            then the village or town as free text under it. Choosing India
            narrows the state list to Indian states, and choosing a state
            narrows the district list — so the ambiguity that made two families
            from the same district unmatchable is gone, and a village the list
            has never heard of still goes in via the free-text leaf.
          */}
          <DependentLocation
            country={String(values.nativeCountry ?? '')}
            state={String(values.nativeState ?? '')}
            city={String(values.nativeDistrict ?? '')}
            onCountry={put('nativeCountry')}
            onState={put('nativeState')}
            onCity={put('nativeDistrict')}
            labels={{ country: 'Native country', state: 'Native state', city: 'Native district' }}
          />
          <Field label="Native place (village / town)" hint="Where the family is from">
            <input
              className="input mt-1"
              value={String(values.nativePlace ?? '')}
              onChange={set('nativePlace')}
              placeholder="Village or town"
              maxLength={120}
            />
          </Field>
          <Field label="Brothers">
            <input className="input mt-1" type="number" min={0} value={String(values.brothers ?? 0)} onChange={set('brothers')} />
          </Field>
          <Field label="Sisters">
            <input className="input mt-1" type="number" min={0} value={String(values.sisters ?? 0)} onChange={set('sisters')} />
          </Field>
          {/*
            Asked as yes/no with the detail hanging off the yes, rather than as
            a country box that is blank for most people. A blank country cannot
            be told apart from "lives in India" or "did not answer", and
            families treat those as different answers.
          */}
          <Field label="Settled abroad">
            <select
              className="input mt-1"
              value={values.isNri ? 'yes' : 'no'}
              onChange={(e) =>
                setValues((v) => ({ ...v, isNri: e.target.value === 'yes' }))
              }
            >
              <option value="no">No</option>
              <option value="yes">Yes, an NRI</option>
            </select>
          </Field>
          {values.isNri ? (
            <>
              <Field label="City abroad">
                <input
                  className="input mt-1"
                  value={String(values.nriCity ?? '')}
                  onChange={set('nriCity')}
                  placeholder="Dubai"
                />
              </Field>
              <Field label="Country">
                <input
                  className="input mt-1"
                  value={String(values.nriCountry ?? '')}
                  onChange={set('nriCountry')}
                  placeholder="United Arab Emirates"
                />
              </Field>
            </>
          ) : null}
          {/*
            One figure for the family, alongside the itemised assets rather
            than instead of them. Optional, and private unless the family says
            otherwise — the same rule money follows everywhere else here.
          */}
          {isGroom && (
            <>
              <Field label="Family net worth" hint="Rupees. Required for groom biodata." required>
                <input
                  className="input mt-1"
                  type="number"
                  min={1}
                  required
                  value={String(values.familyNetWorth ?? '')}
                  onChange={set('familyNetWorth')}
                />
              </Field>
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(values.familyNetWorthVisible)}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, familyNetWorthVisible: e.target.checked }))
                  }
                />
                <span>Show net worth on the biodata</span>
              </label>
            </>
          )}
        </div>
        <button className="btn">Save family details</button>
      </form>

      <div className="border-t pt-4">
        <h3 className="section-title">Siblings</h3>
        <div className="mt-2 divide-y">
          {siblings.map((s) => (
            <div key={s.id} className="flex items-center justify-between py-2 text-sm">
              <span>
                {s.name}
                {s.age ? `, ${s.age}` : ''}
                {s.maritalStatus ? ` · ${MARITAL_LABEL[s.maritalStatus]}` : ''}
                {s.profession ? ` · ${s.profession}` : ''}
              </span>
              <button className="btn-outline" onClick={() => onRemoveSibling(s.id)}>
                Remove
              </button>
            </div>
          ))}
          {siblings.length === 0 && <p className="py-2 text-sm text-gray-400">None added.</p>}
        </div>
        {/*
          A labelled grid, and every input controlled.

          Only "Name" had a `value`, so after adding a sibling the state reset
          and the two uncontrolled boxes kept what had been typed in them — the
          form showed an empty name next to a stale age and profession, which is
          exactly the "not looking good, should be in good order" report. React
          never wrote to those inputs at all; they were the browser's.
        */}
        <div className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Name">
            <input
              className="input mt-1"
              value={String(sibling.name ?? '')}
              onChange={(e) => setSibling((s) => ({ ...s, name: e.target.value }))}
            />
          </Field>
          <Field label="Age">
            <input
              className="input mt-1"
              type="number"
              min={0}
              max={120}
              value={String(sibling.age ?? '')}
              onChange={(e) =>
                setSibling((s) => ({ ...s, age: Number(e.target.value) || undefined }))
              }
            />
          </Field>
          <Field label="Marital status">
            <select
              className="input mt-1"
              value={String(sibling.maritalStatus ?? '')}
              onChange={(e) =>
                setSibling((s) => ({ ...s, maritalStatus: e.target.value || undefined }))
              }
            >
              <option value="">Not stated</option>
              {Object.entries(MARITAL_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <ChoiceField
            label="Profession"
            value={String(sibling.profession ?? '')}
            onChange={(v) => setSibling((s) => ({ ...s, profession: v || undefined }))}
            options={PROFESSIONS}
          />
        </div>
        <button
          className="btn mt-2"
          disabled={!String(sibling.name ?? '').trim() || siblings.length >= 10}
          onClick={() => {
            onAddSibling(sibling);
            setSibling({ name: '' });
          }}
        >
          Add sibling
        </button>
        {siblings.length >= 10 && (
          <p className="mt-2 text-xs text-amber-600">
            You can add up to 10 brothers and sisters. Remove one to add another.
          </p>
        )}
      </div>

      <div className="border-t pt-4">
        <h3 className="section-title">Family assets</h3>
        <p className="text-xs text-gray-500">
          Hidden from everyone unless you mark one visible. Nothing here is part of the biodata you
          circulate by default.
        </p>
        <div className="mt-2 divide-y">
          {assets.map((a) => (
            <div key={a.id} className="flex items-center justify-between py-2 text-sm">
              <span>
                {ASSET_TYPE_LABEL[a.type] ?? a.type}
                {a.location ? ` · ${a.location}` : ''}
                {a.area ? ` · ${a.area}` : ''}
                {a.estimatedValue ? ` · ${rupees(a.estimatedValue)}` : ''}
                {a.visible ? ' · shown on biodata' : ' · private'}
              </span>
              <button className="btn-outline" onClick={() => onRemoveAsset(a.id)}>
                Remove
              </button>
            </div>
          ))}
          {assets.length === 0 && <p className="py-2 text-sm text-gray-400">None recorded.</p>}
        </div>
        {/*
          Estimated value has a box now.

          The field existed on the API and had done from the start, and this
          form never offered it — so a family that entered one through some
          other route saw it saved and never displayed, which is precisely what
          was reported. Same fix on both halves: a labelled, controlled input
          here, and the figure printed in the list above.
        */}
        <div className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Type">
            <select
              className="input mt-1"
              value={String(asset.type ?? '')}
              onChange={(e) => setAsset((a) => ({ ...a, type: e.target.value }))}
            >
              {Object.entries(ASSET_TYPE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Location">
            <input
              className="input mt-1"
              value={String(asset.location ?? '')}
              onChange={(e) => setAsset((a) => ({ ...a, location: e.target.value || undefined }))}
            />
          </Field>
          <Field label="Area" hint="Acres, square yards, whatever it is measured in">
            <input
              className="input mt-1"
              value={String(asset.area ?? '')}
              onChange={(e) => setAsset((a) => ({ ...a, area: e.target.value || undefined }))}
            />
          </Field>
          <Field label="Estimated value" hint="Rupees">
            <input
              className="input mt-1"
              type="number"
              min={0}
              value={String(asset.estimatedValue ?? '')}
              onChange={(e) =>
                setAsset((a) => ({ ...a, estimatedValue: Number(e.target.value) || undefined }))
              }
            />
          </Field>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(asset.visible)}
              onChange={(e) => setAsset((a) => ({ ...a, visible: e.target.checked }))}
            />
            <span>Show on biodata</span>
          </label>
          <button
            className="btn"
            onClick={() => {
              onAddAsset(asset);
              setAsset({ type: 'independent_house' });
            }}
          >
            Add asset
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * First and last name to start the form with: the biodata's own when it has
 * them, otherwise the profile's display name split at the first space.
 */
function namesFrom(displayName: unknown, details: Draft): { firstName: string; lastName: string } {
  const first = String(details.firstName ?? '').trim();
  const last = String(details.lastName ?? details.surname ?? '').trim();
  if (first || last) return { firstName: first, lastName: last };
  const [head = '', ...rest] = String(displayName ?? '').trim().split(/\s+/);
  return { firstName: head, lastName: rest.join(' ') };
}

interface OtherIncome {
  source: string;
  details?: string;
  annualIncome?: string;
}

/** The server takes up to five. */
const OTHER_INCOME_LIMIT = 5;

function EducationForm({
  initial,
  onSave,
  storageKey,
}: {
  initial: Draft;
  onSave: (b: Draft) => Promise<boolean>;
  storageKey?: string;
}) {
  const employment = (initial?.employment ?? {}) as Draft;
  const business = (initial?.business ?? {}) as Draft;
  // Only an edited draft is written (EZ1-I236); see createDraftGuard.
  const [guard] = useState(createDraftGuard);
  const stored0 = loadDraft(storageKey);
  const [status, seedStatus] = useState<OccupationStatus>(
    stored0
      ? (stored0.status as OccupationStatus)
      : ((initial?.occupationStatus as OccupationStatus) ?? 'employed'),
  );
  const [values, seedValues] = useState<Draft>(stored0 ? ((stored0.values as Draft) ?? {}) : {});

  useEffect(() => {
    const stored = loadDraft(storageKey);
    guard.seeded(Boolean(stored));
    if (stored) {
      seedStatus(stored.status as OccupationStatus);
      const draft = (stored.values as Draft) ?? {};
      // A draft saved before businesses became a list holds one business's
      // fields at the top level; they become its first entry.
      seedValues({
        ...draft,
        businessEntries: Array.isArray(draft.businessEntries)
          ? draft.businessEntries
          : [
              {
                id: crypto.randomUUID(),
                businessName: draft.businessName ?? '',
                businessType: draft.businessType ?? '',
                businessLocation: draft.businessLocation ?? '',
                businessIncome: draft.businessIncome ?? '',
              },
            ],
      });
      return;
    }
    seedStatus((initial?.occupationStatus as OccupationStatus) ?? 'employed');
    const entries = readBusinessEntries(business);
    seedValues({
      highestQualification: initial?.highestQualification ?? '',
      course: initial?.course ?? '',
      institution: initial?.institution ?? '',
      collegePlace: initial?.collegePlace ?? '',
      company: employment.company ?? '',
      designation: employment.designation ?? '',
      workLocation: employment.workLocation ?? '',
      salary: employment.salary ?? '',
      businessEntries: (entries.length ? entries : [{}]).map((entry) => ({
        ...entry,
        id: entry.id ?? crypto.randomUUID(),
      })),
      otherIncome: Array.isArray(initial?.otherIncome) ? initial.otherIncome : [],
      incomeVisible: initial?.incomeVisible ?? false,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initial), storageKey]);

  useEffect(() => {
    guard.persist(storageKey, { status, values });
  }, [guard, storageKey, status, values]);

  const setStatus = guard.edit(seedStatus);
  const setValues = guard.edit(seedValues);

  const set = (k: string) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));
  const put = (k: string) => (value: string) => setValues((v) => ({ ...v, [k]: value }));

  const otherIncome = (Array.isArray(values.otherIncome) ? values.otherIncome : []) as OtherIncome[];
  const setOtherIncome = (fn: (rows: OtherIncome[]) => OtherIncome[]) =>
    setValues((v) => ({
      ...v,
      otherIncome: fn((Array.isArray(v.otherIncome) ? v.otherIncome : []) as OtherIncome[]),
    }));
  const editIncome = (i: number, patch: Partial<OtherIncome>) =>
    setOtherIncome((rows) => rows.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const businessEntries = (values.businessEntries as BusinessEntry[] | undefined) ?? [];
        // The fields say so already; there is nothing to send without one.
        if (status === 'self_employed' && !businessEntries.length) return;
        const body: Draft = {
          highestQualification: values.highestQualification,
          course: values.course,
          // null clears; undefined would leave the stored value in place.
          institution: values.institution || null,
          collegePlace: values.collegePlace || null,
          occupationStatus: status,
          // Rows left without a source are ones somebody added and abandoned.
          otherIncome: otherIncome
            .filter((row) => row.source)
            .map((row) => ({
              source: row.source,
              details: row.details?.trim() || undefined,
              annualIncome: row.annualIncome || undefined,
            })),
          incomeVisible: Boolean(values.incomeVisible),
        };
        if (status === 'employed') {
          body.employment = {
            company: values.company,
            designation: values.designation,
            workLocation: values.workLocation || undefined,
            salary: values.salary || undefined,
          };
        }
        if (status === 'self_employed') {
          body.business = {
            entries: businessEntries.map((entry) => ({
              id: entry.id,
              businessName: String(entry.businessName ?? '').trim(),
              businessType: String(entry.businessType ?? '').trim() || undefined,
              businessLocation: String(entry.businessLocation ?? '').trim() || undefined,
              businessIncome:
                entry.businessIncome === '' || entry.businessIncome == null
                  ? undefined
                  : String(entry.businessIncome),
            })),
          };
        }
        void submitDraft(onSave(body), () => guard.clear(storageKey));
      }}
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Highest qualification" required>
          <ChoiceField
            label=""
            value={String(values.highestQualification ?? '')}
            onChange={put('highestQualification')}
            options={QUALIFICATIONS}
            required
          />
        </Field>
        <Field label="Course" required>
          <input className="input mt-1" value={String(values.course ?? '')} onChange={set('course')} required />
        </Field>
        <Field label="Institution">
          <input className="input mt-1" value={String(values.institution ?? '')} onChange={set('institution')} />
        </Field>
        <Field label="College place">
          <input className="input mt-1" value={String(values.collegePlace ?? '')} onChange={set('collegePlace')} />
        </Field>
      </div>

      <Field label="Occupation">
        <select
          className="input mt-1"
          value={status}
          onChange={(e) => setStatus(e.target.value as OccupationStatus)}
        >
          {Object.entries(OCCUPATION_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>

      {status === 'employed' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Company" required>
            <input className="input mt-1" value={String(values.company ?? '')} onChange={set('company')} required />
          </Field>
          <Field label="Designation" required>
            <input className="input mt-1" value={String(values.designation ?? '')} onChange={set('designation')} required />
          </Field>
          <Field label="Work location">
            {/*
              A dropdown, not free text — the same shape Partner Preferences
              already uses for Preferred location, so the two are typed once and
              spelled the same way. "Other" keeps any city the list omits.
            */}
            <ChoiceField
              label=""
              value={String(values.workLocation ?? '')}
              onChange={put('workLocation')}
              options={CITIES}
            />
          </Field>
          <Field label="Salary" hint="Numbers only, annual in rupees. Hidden unless you tick the box below">
            {/*
              Digits only — a salary is a number, and the field used to take
              letters and symbols and store them as-is (EZ1-I59). Non-numeric
              input is dropped as it is typed rather than saved and shown back.
            */}
            <input
              className="input mt-1"
              inputMode="numeric"
              placeholder="e.g. 1200000"
              value={String(values.salary ?? '')}
              onChange={(e) =>
                setValues((v) => ({ ...v, salary: e.target.value.replace(/\D/g, '') }))
              }
            />
          </Field>
        </div>
      )}

      {status === 'self_employed' && (
        <BusinessEntriesFields
          entries={(values.businessEntries as BusinessEntry[]) ?? []}
          onChange={(businessEntries) => setValues((v) => ({ ...v, businessEntries }))}
        />
      )}

      {/*
        Optional, whatever the occupation: plenty of people have a job and a
        business on the side, or rent from a property, and the occupation has
        room for only one answer.
      */}
      <fieldset className="space-y-3 border-t pt-3">
        <legend className="text-sm text-gray-700">
          Other sources of income <span className="text-gray-500">(optional)</span>
        </legend>
        {otherIncome.map((row, i) => (
          <div key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_2fr_1fr_auto]">
            <Field label="Source" required>
              <select
                className="input mt-1"
                value={row.source}
                onChange={(e) => editIncome(i, { source: e.target.value })}
                required
              >
                <option value="">Select…</option>
                {Object.entries(OTHER_INCOME_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Details">
              <input
                className="input mt-1"
                maxLength={160}
                placeholder="e.g. Family textile shop"
                value={row.details ?? ''}
                onChange={(e) => editIncome(i, { details: e.target.value })}
              />
            </Field>
            <Field label="Annual income">
              {/* Digits only, same as Salary (EZ1-I59). */}
              <input
                className="input mt-1"
                inputMode="numeric"
                placeholder="e.g. 600000"
                value={row.annualIncome ?? ''}
                onChange={(e) => editIncome(i, { annualIncome: e.target.value.replace(/\D/g, '') })}
              />
            </Field>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setOtherIncome((rows) => rows.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
        ))}
        {otherIncome.length < OTHER_INCOME_LIMIT && (
          <button
            type="button"
            className="btn-outline btn-sm"
            onClick={() => setOtherIncome((rows) => [...rows, { source: '' }])}
          >
            + Add {otherIncome.length ? 'another' : 'a'} source of income
          </button>
        )}
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(values.incomeVisible)}
          onChange={(e) => setValues((v) => ({ ...v, incomeVisible: e.target.checked }))}
        />
        <span>Show income on the biodata</span>
      </label>

      <button className="btn">Save education and occupation</button>
    </form>
  );
}

/**
 * Partner preferences, with your own chart on the same screen.
 *
 * What a family expects of a horoscope and what their own says are asked in
 * the same breath in person, and were two separate sections here — so the
 * preferences screen offered an "attach horoscope" button and nothing to say
 * what the chart contained. The structured fields sit alongside the
 * expectations now.
 *
 * They still save to the horoscope section, not into preferences: rashi and
 * gothram are facts about this person, and duplicating them under partner
 * preferences would be two copies of one truth waiting to disagree.
 */
function PreferencesForm({
  initial,
  onSave,
  storageKey,
}: {
  initial: Draft;
  onSave: (b: Draft) => Promise<boolean>;
  storageKey?: string;
}) {
  const prefs = (initial?.partnerPreferences ?? {}) as Draft;
  // Only an edited draft is written (EZ1-I236); see createDraftGuard.
  const [guard] = useState(createDraftGuard);
  const [values, seedValues] = useState<Draft>(() => (loadDraft(storageKey) as Draft) ?? {});

  useEffect(() => {
    const stored = loadDraft(storageKey);
    guard.seeded(Boolean(stored));
    if (stored) {
      seedValues(stored);
      return;
    }
    seedValues({
      preferredPackageMin: initial?.preferredPackageMin ?? '',
      preferredPackageMax: initial?.preferredPackageMax ?? '',
      preferredAgeMin: initial?.preferredAgeMin ?? 24,
      preferredAgeMax: initial?.preferredAgeMax ?? 34,
      preferredHeightMinCm: initial?.preferredHeightMinCm ?? 150,
      preferredHeightMaxCm: initial?.preferredHeightMaxCm ?? 189,
      religion: prefs.religion ?? '',
      caste: prefs.caste ?? '',
      education: prefs.education ?? '',
      profession: prefs.profession ?? '',
      locations: prefs.locations ?? '',
      other: prefs.other ?? '',
      horoscopeExpectation: prefs.horoscopeExpectation ?? '',
      kujaDosham: prefs.kujaDosham ?? '',
      preferredStars: prefs.preferredStars ?? '',
      preferredRashi: prefs.preferredRashi ?? '',
      preferredPadam: prefs.preferredPadam ?? '',
      preferredGothram: prefs.preferredGothram ?? '',
      nriPreference: prefs.nriPreference ?? '',
      preferredNriCountry: prefs.preferredNriCountry ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initial), storageKey]);

  useEffect(() => {
    guard.persist(storageKey, values);
  }, [guard, storageKey, values]);

  const setValues = guard.edit(seedValues);

  const set = (k: string) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));
  const put = (k: string) => (value: string) => setValues((v) => ({ ...v, [k]: value }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        // A blank bound is sent as null, which clears it.
        const bound = (value: unknown) => (value === '' || value == null ? null : Number(value));
        const sent = onSave({
          preferredPackageMin: bound(values.preferredPackageMin),
          preferredPackageMax: bound(values.preferredPackageMax),
          preferredAgeMin: Number(values.preferredAgeMin),
          preferredAgeMax: Number(values.preferredAgeMax),
          preferredHeightMinCm: Number(values.preferredHeightMinCm),
          preferredHeightMaxCm: Number(values.preferredHeightMaxCm),
          preferences: {
            religion: values.religion || undefined,
            caste: values.caste || undefined,
            education: values.education || undefined,
            profession: values.profession || undefined,
            locations: values.locations || undefined,
            other: values.other || undefined,
          },
          horoscopeExpectation: values.horoscopeExpectation || undefined,
          kujaDosham: values.kujaDosham || undefined,
          preferredStars: values.preferredStars || undefined,
          preferredRashi: values.preferredRashi || undefined,
          preferredPadam: values.preferredPadam || undefined,
          preferredGothram: values.preferredGothram || undefined,
          nriPreference: values.nriPreference || undefined,
          // Only ever sent alongside a yes. The server clears it otherwise, and
          // sending it anyway would be asking for a country to be kept against
          // a preference that no longer wants one.
          preferredNriCountry:
            values.nriPreference === 'yes' ? values.preferredNriCountry || undefined : undefined,
        });
        void submitDraft(sent, () => guard.clear(storageKey));
      }}
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Age from" required>
          <input className="input mt-1" type="number" min={18} max={100} value={String(values.preferredAgeMin ?? '')} onChange={set('preferredAgeMin')} required />
        </Field>
        <Field label="Age to" required>
          <input className="input mt-1" type="number" min={18} max={100} value={String(values.preferredAgeMax ?? '')} onChange={set('preferredAgeMax')} required />
        </Field>
        <Field label="Height from" required>
          <HeightInput
            value={values.preferredHeightMinCm}
            onChange={(value) => set('preferredHeightMinCm')({ target: { value } })}
            required
          />
        </Field>
        <Field label="Height to" required>
          <HeightInput
            value={values.preferredHeightMaxCm}
            onChange={(value) => set('preferredHeightMaxCm')({ target: { value } })}
            required
          />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {/*
          The same vocabulary the profile uses.

          A preference typed as "s/w engineer" against a profile that says
          "IT / Software Professional" is a preference that can never match.
          Blank stays a real answer throughout — it means no preference, not an
          unanswered question.
        */}
        <ChoiceField
          label="Religion"
          value={String(values.religion ?? '')}
          onChange={put('religion')}
          options={RELIGIONS}
          placeholder="No preference"
        />
        <ChoiceField
          label="Caste"
          value={String(values.caste ?? '')}
          onChange={put('caste')}
          options={CASTES_BY_RELIGION[String(values.religion ?? '')] ?? []}
          placeholder="No preference"
        />
        <ChoiceField
          label="Education"
          value={String(values.education ?? '')}
          onChange={put('education')}
          options={QUALIFICATIONS}
          placeholder="No preference"
        />
        <ChoiceField
          label="Profession"
          value={String(values.profession ?? '')}
          onChange={put('profession')}
          options={PROFESSIONS}
          placeholder="No preference"
        />
        <ChoiceField
          label="Preferred location"
          value={String(values.locations ?? '')}
          onChange={put('locations')}
          options={CITIES}
          placeholder="No preference"
        />
        {/*
          Whether the partner lives abroad (EZ1-I246, EZ1-I247).

          Three answers, and "does not matter" is a position rather than a
          blank. Asked about the partner rather than about a gender: the
          original wording was "Is he NRI?", which is wrong on half the
          profiles on this platform.
        */}
        <Field label="Is the partner an NRI?">
          <select
            className="input mt-1"
            value={String(values.nriPreference ?? '')}
            onChange={set('nriPreference')}
          >
            <option value="">No preference</option>
            <option value="no_preference">Doesn&apos;t matter</option>
            <option value="yes">Yes, prefer NRI</option>
            <option value="no">No, prefer non-NRI</option>
          </select>
        </Field>
        {/*
          Only when an NRI is what is wanted. A country against "no" or "does
          not matter" is a field nobody can answer meaningfully, and the server
          drops it anyway.
        */}
        {values.nriPreference === 'yes' && (
          <Field label="Preferred NRI country">
            <input
              className="input mt-1"
              list="nri-countries"
              placeholder="USA, UK, Canada, Australia…"
              maxLength={120}
              value={String(values.preferredNriCountry ?? '')}
              onChange={set('preferredNriCountry')}
            />
            {/* Suggestions, not a closed list: families say "the Gulf" and
                "Australia or New Zealand", and a dropdown would refuse both. */}
            <datalist id="nri-countries">
              {/* The countries the residence section already offers, less India
                  — which is not somewhere an NRI lives — and less the "Other"
                  escape, which is what typing into this box already is. */}
              {COUNTRIES.filter((country) => country !== 'India' && country !== OTHER).map(
                (country) => (
                  <option key={country} value={country} />
                ),
              )}
            </datalist>
          </Field>
        )}
      </div>

      <PackageRangeFields
        minimum={String(values.preferredPackageMin ?? '')}
        maximum={String(values.preferredPackageMax ?? '')}
        onMinimumChange={put('preferredPackageMin')}
        onMaximumChange={put('preferredPackageMax')}
      />

      {/*
        Horoscope expectations belong here rather than on the chart itself: the
        chart is a fact about you, this is what you are asking of somebody
        else. "No preference" is a real answer and is offered as one — a family
        that does not use horoscopes is not asking anybody to abandon theirs.
      */}
      <div className="grid gap-3 border-t pt-3 sm:grid-cols-3">
        <Field label="Horoscope">
          <select
            className="input mt-1"
            value={String(values.horoscopeExpectation ?? '')}
            onChange={set('horoscopeExpectation')}
          >
            <option value="">No preference</option>
            <option value="required">Required</option>
            <option value="preferred">Preferred</option>
            <option value="not_required">Not required</option>
          </select>
        </Field>
        <Field label="Kuja dosham">
          <select
            className="input mt-1"
            value={String(values.kujaDosham ?? '')}
            onChange={set('kujaDosham')}
          >
            <option value="">No preference</option>
            <option value="must_match">Must match</option>
            <option value="no_objection">No objection</option>
          </select>
        </Field>
        <Field label="Stars or rashis you are looking for">
          <input
            className="input mt-1"
            placeholder="Ashwini, Bharani…"
            value={String(values.preferredStars ?? '')}
            onChange={set('preferredStars')}
          />
        </Field>
      </div>

      {/*
        The rest of the horoscope preferences a family matches on (EZ1-I15/I48):
        preferred Rashi and Padam from the same lists the chart uses, and Gothram
        as free text since it runs to thousands.
      */}
      <div className="grid gap-3 sm:grid-cols-3">
        <ChoiceField
          label="Preferred Rashi"
          value={String(values.preferredRashi ?? '')}
          onChange={put('preferredRashi')}
          options={RASHIS}
          allowOther={false}
        />
        <ChoiceField
          label="Preferred Padam"
          value={String(values.preferredPadam ?? '')}
          onChange={put('preferredPadam')}
          options={PADAMS}
          allowOther={false}
        />
        <Field label="Preferred Gothram(s)">
          <input
            className="input mt-1"
            placeholder="Any, or list the ones you prefer"
            value={String(values.preferredGothram ?? '')}
            onChange={set('preferredGothram')}
          />
        </Field>
      </div>

      <Field label="Anything else">
        <textarea className="input mt-1" rows={2} value={String(values.other ?? '')} onChange={set('other')} />
      </Field>
      <button className="btn">Save preferences</button>
    </form>
  );
}

/**
 * Aadhaar verification.
 *
 * Worth telling people plainly what happens to the number, because the honest
 * answer is unusually reassuring: it is checked, turned into a fingerprint, and
 * thrown away.
 */
function AadhaarPanel({ profileId }: { profileId: string }) {
  const qc = useQueryClient();
  const [aadhaar, setAadhaar] = useState('');
  const [code, setCode] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [devCode, setDevCode] = useState('');
  const [error, setError] = useState('');

  const { data } = useQuery({
    queryKey: ['aadhaar', profileId],
    queryFn: async () => (await api.get(`/profiles/${profileId}/identity/aadhaar`)).data,
    retry: false,
    enabled: Boolean(profileId),
  });

  if (data?.verifiedAt) {
    // The document type the profile was actually verified with, not a hardcoded
    // "Aadhaar" — otherwise a passport-verified profile read as "Verified" here
    // and "Verified (Passport)" under Your Profile, the mismatch reported in
    // EZ1-I42. Both now read the same idVerifiedAt and name the same document.
    const idTypeLabel: Record<string, string> = {
      aadhaar: 'Aadhaar',
      passport: 'Passport',
      voter_id: 'Voter ID',
      driving_licence: 'Driving licence',
      pan: 'PAN',
    };
    const label = idTypeLabel[String(data.idType ?? '')] ?? 'Identity document';
    return (
      <div className="space-y-1">
        <p className="flex flex-wrap items-center gap-2 text-sm text-gray-800">
          <span className="rounded-sm bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800">
            Verified
          </span>
          {label} ending <strong>{data.last4}</strong>
          <span className="text-xs text-gray-500">on {formatDate(data.verifiedAt)}</span>
        </p>
        <p className="text-xs text-gray-500">
          The number itself was never stored. Only these four digits and a one-way fingerprint are
          kept.
        </p>
      </div>
    );
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const { data: res } = await api.post(`/profiles/${profileId}/identity/aadhaar/send-otp`, {
        aadhaarNumber: aadhaar,
      });
      setSessionId(res.sessionId);
      setDevCode(res.devCode ?? '');
      setAadhaar('');
    } catch (err) {
      setError(apiMessage(err, 'That number could not be verified.'));
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api.post(`/profiles/${profileId}/identity/aadhaar/verify-otp`, { sessionId, code });
      qc.invalidateQueries({ queryKey: ['aadhaar', profileId] });
      qc.invalidateQueries({ queryKey: ['biodata', profileId] });
    } catch (err) {
      setError(apiMessage(err, 'That code was not accepted.'));
    }
  }

  return (
    <div className="space-y-3">
      {/*
        The half-finished state used to look identical to never having started:
        somebody whose code expired saw a blank form and no idea whether their
        earlier attempt had counted for anything.
      */}
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span
          className={`rounded-sm px-2 py-1 text-xs font-medium ${
            data?.submittedAt ? 'bg-amber-50 text-amber-800' : 'bg-gray-100 text-gray-600'
          }`}
        >
          {data?.submittedAt ? 'Started, not verified' : 'Not verified'}
        </span>
        {data?.last4 && (
          <span className="text-gray-700">
            Aadhaar ending <strong>{data.last4}</strong> is on file
          </span>
        )}
      </p>

      <p className="text-sm text-gray-600">
        One document, one profile. This is what keeps duplicates off the platform. The number is
        checked, turned into a fingerprint and discarded; only the last four digits are kept.
      </p>
      {/*
        A document already on file is the one this profile is tied to. Verifying
        here has to use that same number — a different one is refused — and
        changing the document is a case, not a re-entry (EZ1-I42).
      */}
      {data?.last4 && !data?.verifiedAt && (
        <p className="text-xs text-gray-500">
          A document is already on file for this profile. Verifying must use that same number; to
          change it, raise a case.
        </p>
      )}
      {error && <p className="alert-critical">{error}</p>}

      {!sessionId ? (
        <form onSubmit={send} className="flex flex-wrap items-end gap-2">
          <Field label="Aadhaar number" required>
            <input
              className="input mt-1"
              inputMode="numeric"
              placeholder="2345 6789 0124"
              value={aadhaar}
              onChange={(e) => setAadhaar(e.target.value)}
              required
            />
          </Field>
          <button className="btn">Send OTP</button>
        </form>
      ) : (
        <form onSubmit={verify} className="flex flex-wrap items-end gap-2">
          <Field
            label="Six-digit code"
            hint={devCode ? `Development mode, the code is ${devCode}` : 'Sent to the registered mobile'}
            required
          >
            <input
              className="input mt-1 w-40"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </Field>
          <button className="btn">Verify</button>
          <button type="button" className="btn-outline" onClick={() => setSessionId('')}>
            Start again
          </button>
        </form>
      )}
    </div>
  );
}
