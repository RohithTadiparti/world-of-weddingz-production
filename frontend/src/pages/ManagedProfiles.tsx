import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import BiodataImport from '../components/BiodataImport';
import HeightInput from '../components/HeightInput';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiMessage } from '../lib/api';
import { adultDobMax } from '../lib/dates';
import { useAuth, usePermissions } from '../store/auth';
import {
  CLAIM_STATUS_LABEL,
  LIFECYCLE_LABEL,
  MOBILE_10_PATTERN,
  Permission,
  ProfileClaimStatus,
  ProfileLifecycle,
  can,
} from '../lib/permissions';

/** A 10-digit Indian mobile, tolerating spaces, hyphens and a +91 prefix. */
function isValidMobile(value: string): boolean {
  return MOBILE_10_PATTERN.test(value.replace(/[\s-]/g, '').replace(/^\+91/, ''));
}
import ConsentFields, { ConsentDraft, consentPayload, emptyConsent } from '../components/ConsentFields';
import ShareProfileDialog from '../components/ShareProfileDialog';
import PhotoUploader from '../components/PhotoUploader';
import { Loading } from '../components/ui/Feedback';
import { ProfileSilhouette } from '../components/ProfileSilhouette';

interface ManagedProfile {
  id: string;
  displayName: string;
  stewardRelation?: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  networkVisibility: 'private' | 'pool';
  visibility: 'private' | 'matches_only' | 'public';
  gender: string | null;
  dateOfBirth: string | null;
  city: string | null;
  bio: string | null;
  photos: string[];
  claimStatus: ProfileClaimStatus;
  profileCompleted: boolean;
  createdAt: string;
  lifecycle?: ProfileLifecycle;
  lifecycleReason?: string | null;
  /**
   * Whether this profile may actually be circulated, and why not when it may
   * not. Decided at intake by a checkbox on the creation form, and changeable
   * afterwards — families change their minds, and a decision taken at the desk
   * on day one should not be permanent.
   */
  circulation?: {
    intake: boolean;
    circulation: boolean;
    mayCirculate: boolean;
    needsReconfirmation: boolean;
    reason: string | null;
  } | null;
  /**
   * What the agency may still do to this row, decided by the server. Rendering
   * from this rather than re-deriving it here keeps the buttons and the rules
   * from drifting apart.
   */
  actions?: {
    canEdit: boolean;
    canManagePhotos: boolean;
    canCirculate: boolean;
    canInvite: boolean;
    canPause: boolean;
    canClose: boolean;
    canDelete: boolean;
  };
}

interface AgencyStatus {
  registered: boolean;
  approved: boolean;
  rejectionReason: string | null;
  agencyName: string | null;
  /** Whether a shareable client sign-up link is currently live (EZ1-I166). */
  shareLinkActive?: boolean;
}

/** The categories, in the order a family would think of them. */
const STEWARD_RELATIONS = ['Parent / Guardian', 'Sibling', 'Relative', 'Friend', 'Other'];

const emptyDraft = {
  firstName: '',
  lastName: '',
  nativePlace: '',
  stewardRelation: '',
  contactPhone: '',
  contactEmail: '',
  gender: '',
  dateOfBirth: '',
  city: '',
  bio: '',
};

const IMPORT_REVIEW_SECTIONS = [
  {
    title: 'Personal and birth details',
    fields: [
      ['heightCm', 'Height'], ['complexion', 'Complexion'],
      ['placeOfBirth', 'Place of birth'], ['timeOfBirth', 'Birth time'],
      ['communicationAddress', 'Address'], ['alternateMobile', 'Alternate mobile'],
      ['maritalStatus', 'Marital status'],
    ],
  },
  {
    title: 'Religion and horoscope',
    fields: [
      ['religion', 'Religion'], ['caste', 'Caste'], ['subCaste', 'Sub-caste'],
      ['motherTongue', 'Mother tongue'], ['denomination', 'Denomination'], ['gothram', 'Gothram'], ['rashi', 'Rasi / Rashi'],
      ['star', 'Nakshatram / Star'], ['padam', 'Padam'], ['kujaDosham', 'Kuja dosham'],
    ],
  },
  {
    title: 'Education and occupation',
    fields: [
      ['highestQualification', 'Qualification'], ['course', 'Course'], ['institution', 'Institution'],
      ['collegePlace', 'College place'], ['profession', 'Occupation / Profession'],
      ['occupationStatus', 'Occupation status'], ['designation', 'Designation'],
      ['company', 'Employer / Company'], ['workLocation', 'Work location'],
      ['annualIncome', 'Annual income'], ['salary', 'Salary'],
    ],
  },
  {
    title: 'Family details',
    fields: [
      ['fatherName', "Father's name"], ['fatherProfession', "Father's occupation"],
      ['motherName', "Mother's name"], ['motherProfession', "Mother's occupation"],
      ['brothers', 'Brothers'], ['sisters', 'Sisters'], ['familyType', 'Family type'],
      ['familyStatus', 'Family status'], ['nativeState', 'Native state'],
      ['nativeDistrict', 'Native district'], ['nativeCountry', 'Native country'],
    ],
  },
] as const;

/*
 * The biodata sections an intake may fill. The profile's own fields (display
 * name, mobile, email, date of birth, gender, city) are deliberately absent:
 * they are sent once, at the top level, from the form the agent reviewed.
 */
const ALLOWED_BIODATA_KEYS = new Set([
  'firstName', 'lastName', 'surname', 'heightCm', 'complexion',
  'nativePlace', 'nativeState', 'nativeCountry', 'nativeDistrict', 'placeOfBirth',
  'communicationAddress', 'address', 'alternateMobile',
  'religion', 'caste', 'subCaste', 'motherTongue',
  'denomination', 'gothram', 'rashi', 'star', 'padam', 'kujaDosham', 'timeOfBirth',
  'horoscopeAvailable', 'maritalStatus', 'fatherName', 'fatherProfession', 'motherName',
  'motherProfession', 'familyType', 'familyStatus', 'brothers', 'sisters',
  'highestQualification', 'course', 'institution', 'collegePlace', 'occupationStatus',
  'profession', 'designation', 'company', 'workLocation', 'annualIncome', 'salary',
  'bio',
]);

type IntakeMode = 'manual' | 'upload';

function applyImportedFields(
  current: typeof emptyDraft,
  fields: Record<string, string>,
): typeof emptyDraft {
  const next = { ...current };
  for (const key of Object.keys(emptyDraft) as Array<keyof typeof emptyDraft>) {
    if (fields[key]) next[key] = fields[key];
  }
  return next;
}

/*
 * The review fields the API only accepts from a fixed list. They are selects
 * rather than free text, so what the agent confirms is what gets saved; the
 * API refuses anything else with a 400 naming the field.
 */
const REVIEW_CHOICES: Record<string, ReadonlyArray<readonly [string, string]>> = {
  maritalStatus: [
    ['never_married', 'Never married'], ['divorced', 'Divorced'], ['widowed', 'Widowed'],
    ['separated', 'Separated'], ['annulled', 'Annulled'],
  ],
  occupationStatus: [
    ['employed', 'Employed'], ['self_employed', 'Self-employed / business'],
    ['not_employed', 'Not employed'], ['student', 'Student'], ['homemaker', 'Homemaker'],
    ['retired', 'Retired'],
  ],
  familyType: [
    ['joint', 'Joint'], ['nuclear', 'Nuclear'], ['extended', 'Extended'],
    ['single_parent', 'Single parent'],
  ],
};

const CHOICE_SYNONYMS: Record<string, string> = {
  unmarried: 'never_married', single: 'never_married', divorce: 'divorced', widow: 'widowed',
  widower: 'widowed', business: 'self_employed', unemployed: 'not_employed',
  housewife: 'homemaker',
};

/** An extracted value as one of the choices, or '' when it matches none. */
function normaliseChoice(key: string, raw: string): string {
  const choices = REVIEW_CHOICES[key];
  if (!choices) return raw;
  const folded = raw.trim().toLowerCase().replace(/[\s/-]+/g, '_').replace(/_family$/, '');
  const value = CHOICE_SYNONYMS[folded] ?? folded;
  const hit = choices.find(
    ([v, label]) => v === value || label.toLowerCase().replace(/[\s/-]+/g, '_') === folded,
  );
  return hit ? hit[0] : '';
}

/**
 * Where an agent (or a family member looking after a relative) builds a full
 * profile for somebody who has not signed up.
 *
 * The profile is matchable straight away. An invitation is a separate,
 * deliberate step: it emails the subject a link where THEY choose a password,
 * which is why the steward never sets one here.
 */
interface ManagedProfilesProps {
  embedded?: boolean;
  /** Lets a host page place the create action in its own header. */
  creating?: boolean;
  onCreatingChange?: (creating: boolean) => void;
  hideCreateAction?: boolean;
  /** Optional slot for putting the create form before a host page's list. */
  createFormContainer?: Element | null;
  /** Optional slot for putting the client sign-up link before a host page's list. */
  signupLinkContainer?: Element | null;
}

export default function ManagedProfiles({
  embedded = false,
  creating: controlledCreating,
  onCreatingChange,
  hideCreateAction = false,
  createFormContainer,
  signupLinkContainer,
}: ManagedProfilesProps = {}) {
  const qc = useQueryClient();
  const permissions = usePermissions();
  // A family member holds the same stewardship capability an agency does, so
  // the permission cannot tell them apart — only the role can.
  const isFamily = useAuth((s) => s.user?.role) === 'family';
  const isAgent = can(permissions, Permission.AGENCY_MANAGE);

  /*
   * Whether the creation form is open (EZ1-I238). Closed by default: the page
   * exists to show the profiles, and it closes itself again on a successful
   * save so the agent lands back on the list with the new client in it.
   */
  const [uncontrolledCreating, setUncontrolledCreating] = useState(false);
  const creating = controlledCreating ?? uncontrolledCreating;
  const setCreating = (next: boolean) => {
    if (controlledCreating !== undefined) onCreatingChange?.(next);
    else setUncontrolledCreating(next);
  };
  const [draft, setDraft] = useState(emptyDraft);
  const [intakeMode, setIntakeMode] = useState<IntakeMode | null>(null);
  const [extractedBiodata, setExtractedBiodata] = useState<Record<string, string>>({});
  const [documentUrl, setDocumentUrl] = useState('');
  // Contact details can arrive later with a family member. A supplied mobile
  // must be valid, but neither it nor email blocks an agent from saving the
  // imported biodata. A contact channel is only needed to send an invitation.
  const readyToSave =
    (!draft.contactPhone || isValidMobile(draft.contactPhone)) &&
    Boolean(draft.firstName.trim() && draft.lastName.trim() && draft.gender) &&
    (!isFamily || Boolean(draft.stewardRelation.trim()) && draft.stewardRelation !== 'Other');
  const readyToInvite = readyToSave && Boolean(draft.contactPhone || draft.contactEmail);
  const [importing, setImporting] = useState(false);
  const [consent, setConsent] = useState<ConsentDraft>(emptyConsent());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);
  const [enabling, setEnabling] = useState<string | null>(null);
  const [reach, setReach] = useState<string | null>(null);

  const { data: agency } = useQuery({
    queryKey: ['agency-status'],
    queryFn: async () => (await api.get('/agents/agency/status')).data as AgencyStatus,
    retry: false,
    enabled: isAgent,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['managed-profiles'],
    queryFn: async () => (await api.get('/agents/profiles')).data,
  });

  const create = useMutation({
    mutationFn: async (inviteNow: boolean) => {
      const values = draft;
      const payload: Record<string, unknown> = {
        displayName: [values.firstName.trim(), values.lastName.trim()].filter(Boolean).join(' '),
        gender: values.gender,
        // An agency records how a stranger's family agreed to be represented.
        // A parent adding their own son or daughter is that agreement, so a
        // family member is not asked (and the server does not require it).
        ...(isFamily ? {} : { consent: consentPayload(consent) }),
        inviteNow,
      };
      const rawBiodata: Record<string, unknown> = {
        ...extractedBiodata,
        ...(values.firstName ? { firstName: values.firstName } : {}),
        ...(values.lastName ? { lastName: values.lastName } : {}),
        ...(values.nativePlace ? { nativePlace: values.nativePlace } : {}),
      };
      const biodata: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rawBiodata)) {
        if (ALLOWED_BIODATA_KEYS.has(k) && v !== undefined && v !== '') {
          biodata[k] = v;
        }
      }
      if (Object.keys(biodata).length) payload.biodata = biodata;
      if (documentUrl) payload.biodataDocumentUrl = documentUrl;
      // Either contact channel can be added at the desk or later. They remain
      // optional until the agent chooses to send a claim invitation.
      if (values.contactPhone) payload.contactPhone = values.contactPhone;
      if (values.contactEmail) payload.contactEmail = values.contactEmail;
      if (values.dateOfBirth) payload.dateOfBirth = values.dateOfBirth;
      if (values.city) payload.city = values.city;
      if (values.bio) payload.bio = values.bio;
      if (values.stewardRelation) payload.stewardRelation = values.stewardRelation;
      return (await api.post('/agents/profiles', payload)).data as ManagedProfile;
    },
    onSuccess: (profile, input) => {
      const inviteNow = input === true;
      setDraft(emptyDraft);
      setIntakeMode(null);
      setExtractedBiodata({});
      setDocumentUrl('');
      setConsent(emptyConsent());
      // Back to the list, with the profile just created in it (EZ1-I238).
      setCreating(false);
      setError('');
      setNotice(
        inviteNow
          ? profile.contactEmail
            ? `Profile created and an invitation sent to ${profile.contactEmail}.`
            : 'Profile created and an invitation sent by SMS to their mobile. They can claim it without an email.'
          : isFamily
            ? 'Profile saved. It is visible in matches now. Complete the biodata so families can see who they are.'
            : 'Profile saved. It stays private until the biodata is complete and you make it matchable.',
      );
      qc.invalidateQueries({ queryKey: ['managed-profiles'] });
      // My Clients includes these profiles as well as claimed accounts.
      qc.invalidateQueries({ queryKey: ['agent-clients'] });
      qc.invalidateQueries({ queryKey: ['actable-profiles'] });
    },
    onError: (err) => {
      setNotice('');
      setError(apiMessage(err, 'Could not create that profile.'));
    },
  });

  const invite = useMutation({
    mutationFn: async (id: string) =>
      (await api.post(`/agents/profiles/${id}/invite`)).data as { devUrl?: string },
    onSuccess: (res) => {
      setError('');
      setNotice(
        res.devUrl
          ? `Invitation sent. Development link: ${res.devUrl}`
          : 'Invitation emailed. They choose their own password when they accept.',
      );
      qc.invalidateQueries({ queryKey: ['managed-profiles'] });
    },
    onError: (err) => setError(apiMessage(err)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/agents/profiles/${id}`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['managed-profiles'] }),
    onError: (err) => setError(apiMessage(err)),
  });

  /**
   * Pausing and closing, as distinct from deleting.
   *
   * A client who steps back for a few months has not ended the engagement, and
   * a client who married elsewhere has — but neither should lose the consent
   * record or the circulation history, so nothing here removes a row.
   */
  const lifecycle = useMutation({
    mutationFn: async ({
      id,
      action,
      reason,
    }: {
      id: string;
      action: 'deactivate' | 'reactivate' | 'archive';
      reason?: string;
    }) => (await api.put(`/agents/profiles/${id}/${action}`, reason ? { reason } : {})).data,
    onSuccess: (_res, vars) => {
      setError('');
      setNotice(
        vars.action === 'deactivate'
          ? 'Paused. It will not be matched or circulated until you bring it back.'
          : vars.action === 'reactivate'
            ? 'Back in matchmaking.'
            : 'Closed. The record stays for the audit trail, and anything held in escrow is refunded.',
      );
      qc.invalidateQueries({ queryKey: ['managed-profiles'] });
    },
    onError: (err) => setError(apiMessage(err)),
  });

  const profiles: ManagedProfile[] = data?.data ?? [];
  const set = (k: keyof typeof emptyDraft) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));

  const setBiodata = (key: string) => (e: { target: { value: string } }) => {
    const value = e.target.value;
    setExtractedBiodata((current) => ({ ...current, [key]: value }));
    if (key in emptyDraft) {
      setDraft((current) => ({ ...current, [key]: value }));
    }
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    if (importing || !readyToSave) return;
    setError('');
    create.mutate(false);
  }

  // An agent has to be vetted before any of this works, so say so plainly
  // rather than letting every action fail with a 403.
  if (isAgent && agency && !agency.approved) {
    return (
      <div className="space-y-4">
        {!embedded && <h1 className="page-title">Client Profiles</h1>}
        <div className="card border-amber-200 bg-amber-50">
          <h2 className="font-semibold text-amber-900">
            {agency.registered ? 'Your agency is awaiting approval' : 'Register your agency first'}
          </h2>
          <p className="mt-2 text-sm text-amber-900">
            {agency.registered
              ? 'An administrator reviews every agency before it can build profiles or invite clients. You will be emailed when yours is reviewed.'
              : 'Before you can build client profiles, tell us who you are. An administrator reviews each agency.'}
          </p>
          {agency.rejectionReason && (
            <p className="mt-2 alert-critical">
              Not approved: {agency.rejectionReason}
            </p>
          )}
          <a href="/agency" className="btn mt-3">
            {agency.registered ? 'Review agency details' : 'Register agency'}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/*
        The page is the list; creating is an action on it (EZ1-I238).

        The creation form used to sit open above the profiles, so an agent
        opening Client Profiles to find a client scrolled a fourteen-field form
        first, every time, and the page mixed "what I have" with "make another".
      */}
      {/*
        Same page, a family's vocabulary. A father running his daughter's
        profile is doing what an agency does and holds the same permissions to
        do it, but "client" is not what she is to him (council round 2).
      */}
      {(!embedded || !hideCreateAction) && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {!embedded && (
              <>
                <h1 className="page-title">{isFamily ? 'Family Profiles' : 'Client Profiles'}</h1>
                <p className="page-subtitle">
                  {isFamily
                    ? 'The relatives whose profiles you look after. Build one for someone who has not joined yet and it can be matched immediately; when you invite them, they set their own password and take ownership.'
                    : 'The clients you look after. Build a profile for someone who has not joined yet and it can be matched immediately; when you invite them, they set their own password and take ownership.'}
                </p>
              </>
            )}
          </div>
          {!hideCreateAction && (
            <button className="btn shrink-0" onClick={() => setCreating(!creating)}>
              {creating ? 'Cancel' : isFamily ? 'Add a relative' : 'Create new client'}
            </button>
          )}
        </div>
      )}

      {notice && <p className="rounded-sm bg-brand-light p-3 text-sm text-brand-dark">{notice}</p>}
      {!creating && error && <p className="alert-critical">{error}</p>}

      {isAgent && agency?.approved && (
        signupLinkContainer
          ? createPortal(<ClientSignupLink active={Boolean(agency.shareLinkActive)} />, signupLinkContainer)
          : <ClientSignupLink active={Boolean(agency.shareLinkActive)} />
      )}

      {renderCreateForm()}
    </div>
  );

  function renderCreateForm() {
    const form = (
      <form onSubmit={submit} className="card space-y-4">
        <h2 className="section-title">{isFamily ? 'Add another profile' : 'New profile'}</h2>

        <div>
          <p className="label">How would you like to create this {isFamily ? 'profile' : 'client'}?</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={intakeMode === 'manual' ? 'btn' : 'btn-outline'}
              onClick={() => setIntakeMode('manual')}
            >
              Enter details manually
            </button>
            <button
              type="button"
              className={intakeMode === 'upload' ? 'btn' : 'btn-outline'}
              onClick={() => setIntakeMode('upload')}
            >
              Upload PDF, Word, Excel or image
            </button>
          </div>
        </div>

        {intakeMode === 'upload' && (
          <BiodataImport
            busy={importing || create.isPending}
            onBusy={setImporting}
            onImported={(fields, url) => {
              // The profile's own fields (name, mobile, gender, date of birth,
              // city) go to the form above; only the biodata sections travel
              // in `biodata`, so no stale extracted copy is sent alongside.
              const allowedFields: Record<string, string> = {};
              for (const [key, value] of Object.entries(fields)) {
                if (ALLOWED_BIODATA_KEYS.has(key)) {
                  allowedFields[key] = normaliseChoice(key, value);
                }
              }
              setDraft(applyImportedFields(emptyDraft, fields));
              setDocumentUrl(url);
              setExtractedBiodata(allowedFields);
            }}
          />
        )}
        {documentUrl && (
          <p className="text-xs text-emerald-700 bg-emerald-50 p-2 rounded border border-emerald-200">
            Biodata document attached. Review and edit the extracted fields below; no client has been created yet.
          </p>
        )}

        {intakeMode && <><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* Asked separately, as the biodata asks them. */}
          <div>
            <label className="label">First name</label>
            <input className="input" value={draft.firstName} onChange={set('firstName')} required />
          </div>
          <div>
            <label className="label">Last name</label>
            <input className="input" value={draft.lastName} onChange={set('lastName')} required />
          </div>
          <div>
            <label className="label">Native place</label>
            <input className="input" value={draft.nativePlace} onChange={set('nativePlace')} />
          </div>
          {/*
            Only asked of a family member. An agency's relationship to a client
            is commercial and is recorded on the agency; asking an agent how
            they are related to their client would be a strange question with
            no honest answer.
          */}
          {isFamily && (
            <div>
              <label className="label">Relationship to this person</label>
              {/*
                A list first, free text after.

                Free text alone was unmatchable and produced forty spellings of
                "father". A list alone loses "maternal uncle", which is a real
                distinction in this market and the first thing the other family
                asks. Both: pick the category, then say it exactly if it matters.
              */}
              <select
                className="input"
                required
                value={
                  STEWARD_RELATIONS.includes(draft.stewardRelation)
                    ? draft.stewardRelation
                    : draft.stewardRelation
                      ? 'Other'
                      : ''
                }
                onChange={(e) =>
                  setDraft((d) => ({ ...d, stewardRelation: e.target.value }))
                }
              >
                <option value="">Select…</option>
                {STEWARD_RELATIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              {draft.stewardRelation === 'Other' ||
              (draft.stewardRelation && !STEWARD_RELATIONS.includes(draft.stewardRelation)) ? (
                <input
                  className="input mt-2"
                  placeholder="Maternal uncle, elder brother…"
                  value={draft.stewardRelation === 'Other' ? '' : draft.stewardRelation}
                  onChange={set('stewardRelation')}
                />
              ) : null}
              <p className="mt-1 text-xs text-gray-500">
                Your relationship to the person whose matrimonial profile you are managing.
              </p>
            </div>
          )}
          <div>
            <label className="label">
              Mobile number <span className="font-normal text-gray-400">(optional)</span>
            </label>
            {/*
              Checked in the field before anything is sent — an invalid or
              incomplete number must not reach the invite, which is where the
              verification code goes (EZ1-I63). The server enforces the same rule.
            */}
            <input
              className={`input${
                draft.contactPhone && !isValidMobile(draft.contactPhone)
                  ? ' border-red-500 focus:border-red-500 focus:ring-red-500/20'
                  : ''
              }`}
              placeholder="+919876543210"
              value={draft.contactPhone}
              onChange={set('contactPhone')}
              aria-invalid={Boolean(draft.contactPhone) && !isValidMobile(draft.contactPhone)}
            />
            {draft.contactPhone && !isValidMobile(draft.contactPhone) ? (
              <p className="mt-1 text-xs text-red-600">Enter a 10-digit Indian mobile number.</p>
            ) : (
              <p className="mt-1 text-xs text-gray-500">
                Add a mobile, email, or both when available. Either one is enough to invite them
                to claim this profile later.
              </p>
            )}
          </div>
          <div>
            <label className="label">
              Email <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <input
              className="input"
              type="email"
              value={draft.contactEmail}
              onChange={set('contactEmail')}
            />
            <p className="mt-1 text-xs text-gray-500">
              Optional at intake. Email or mobile can be used when they later claim the account.
            </p>
          </div>
          <div>
            {/*
              "Managing profile for", not "gender".

              The field stores the same thing either way, but a steward
              filling this in is answering "is this a bride or a groom" — which
              is the question, and the one that was asked as "User Type" before.
            */}
            <label className="label">Managing profile for</label>
            <select className="input" value={draft.gender} onChange={set('gender')} required>
              <option value="">Choose gender</option>
              <option value="female">Bride</option>
              <option value="male">Groom</option>
            </select>
          </div>
          <div>
            <label className="label">Date of birth</label>
            <input
              className="input"
              type="date"
              max={adultDobMax(18)}
              value={draft.dateOfBirth}
              onChange={set('dateOfBirth')}
            />
            <p className="mt-1 text-xs text-gray-500">The client must be at least 18 years old.</p>
          </div>
          <div>
            <label className="label">City</label>
            <input className="input" value={draft.city} onChange={set('city')} />
          </div>
        </div>
        <div>
          <label className="label">About them</label>
          <textarea className="input" rows={3} maxLength={2000} value={draft.bio} onChange={set('bio')} />
        </div>

            {intakeMode === 'upload' && documentUrl && (
          <div className="space-y-4 rounded-lg border border-brand-light bg-brand-light/20 p-4">
            <div>
              <h3 className="font-semibold text-gray-900">Extracted biodata</h3>
              <p className="text-xs text-gray-600">Only values you confirm here will be saved to the new client.</p>
              <p className="mt-1 text-xs font-medium text-red-700">
                Fields outlined in red were not found or could not be recognised. Complete them before making this profile matchable.
              </p>
            </div>
            {IMPORT_REVIEW_SECTIONS.map((section) => (
              <fieldset key={section.title} className="space-y-2">
                <legend className="text-sm font-medium text-gray-800">{section.title}</legend>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {section.fields.map(([key, label]) => (
                    <label key={key} className="block">
                      <span className={`label${!(extractedBiodata[key] ?? '').trim() ? ' text-red-700' : ''}`}>{label}</span>
                      {key === 'heightCm' ? (
                        // Feet and inches, as the biodata form reads it; the
                        // value underneath stays whole centimetres.
                        <HeightInput
                          value={extractedBiodata.heightCm ?? ''}
                          onChange={(cm) => setBiodata('heightCm')({ target: { value: cm } })}
                        />
                      ) : REVIEW_CHOICES[key] ? (
                        <select
                          className={`input${!(extractedBiodata[key] ?? '').trim() ? ' border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-500/20' : ''}`}
                          value={extractedBiodata[key] ?? ''}
                          onChange={setBiodata(key)}
                        >
                          <option value="">Not stated</option>
                          {REVIEW_CHOICES[key].map(([value, text]) => (
                            <option key={value} value={value}>{text}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className={`input${!(extractedBiodata[key] ?? '').trim() ? ' border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-500/20' : ''}`}
                          value={extractedBiodata[key] ?? ''}
                          onChange={setBiodata(key)}
                        />
                      )}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        )}

        {!isFamily && <ConsentFields value={consent} onChange={setConsent} />}

        {error && <p className="alert-critical">{error}</p>}

        <div className="flex flex-wrap gap-2">
          <button className="btn" disabled={importing || create.isPending || !readyToSave}>
            {create.isPending ? 'Saving...' : 'Save profile'}
          </button>
          {/*
            A mobile number alone is enough to invite (EZ1-I170): the invitation
            goes out by SMS and the client supplies an email when they claim it.
            This button used to be disabled without an email — silently, so an
            agent with a phone-first walk-in family could not tell why — which
            contradicted the backend, where email is optional. Email is genuinely
            optional here, so the note beside it says as much rather than blocking.
          */}
          <button
            type="button"
            className="btn-outline"
            disabled={importing || create.isPending || !readyToInvite}
            onClick={() => {
              setError('');
              create.mutate(true);
            }}
          >
            Save and invite now
          </button>
          <p className="w-full text-xs text-gray-500">
            {!draft.contactEmail && !draft.contactPhone
              ? 'Save the profile now; add an email or mobile before inviting them to claim it.'
              : draft.contactEmail && draft.contactPhone
                ? 'The invitation goes to their email and mobile.'
                : draft.contactEmail
                  ? 'The invitation goes to their email address.'
                  : 'The invitation goes by SMS. They can claim it without an email.'}
          </p>
        </div>
        </>}
      </form>
    );

    return (
      <>
        {creating &&
          (createFormContainer ? createPortal(form, createFormContainer) : form)}

      <div className="card space-y-3">
        <h2 className="section-title">Profiles you manage</h2>
        {isLoading && <Loading rows={3} />}
        {!isLoading && profiles.length === 0 && (
          <p className="text-sm text-gray-400">You have not built any profiles yet.</p>
        )}

        <div className="divide-y">
          {profiles.map((p) => (
            <div key={p.id} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  {/* Who this profile is for, and what they are to you. */}
                  {isFamily && (
                    <p className="text-xs text-gray-500">
                      Managing profile for {p.displayName}
                      {p.stewardRelation ? ` · you are their ${p.stewardRelation}` : ''}
                    </p>
                  )}
                  <p className="font-medium">
                    {p.displayName}
                    <span
                      className={`ml-2 rounded-sm px-2 py-0.5 text-xs ${
                        p.claimStatus === 'claimed'
                          ? 'bg-green-50 text-green-700'
                          : p.claimStatus === 'invited'
                            ? 'bg-amber-50 text-amber-800'
                            : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {CLAIM_STATUS_LABEL[p.claimStatus]}
                    </span>
                  </p>
                  <p className="text-sm text-gray-500">
                    {p.contactPhone}
                    {p.contactEmail ? ` · ${p.contactEmail}` : ' · no email on file'}
                    {p.city ? ` · ${p.city}` : ''}
                    {` · ${p.photos?.length ?? 0} photo(s)`}
                    {p.networkVisibility === 'pool' ? ' · in network pool' : ''}
                  </p>
                  {p.lifecycle && p.lifecycle !== 'active' && (
                    <p className="mt-1 text-xs font-medium text-amber-700">
                      {LIFECYCLE_LABEL[p.lifecycle]}
                      {p.lifecycleReason ? `: ${p.lifecycleReason}` : ''}
                    </p>
                  )}
                  {p.claimStatus === 'claimed' && (
                    <p className="mt-1 text-xs text-gray-500">
                      Claimed by the client. You and the client can both update this biodata;
                      their contact details are theirs to change.
                    </p>
                  )}
                  <CompletionStatus
                    profileId={p.id}
                    visibility={p.visibility}
                    family={isFamily}
                    canPublish={Boolean(p.actions?.canEdit) && p.claimStatus !== 'claimed'}
                    onPublished={() => void qc.invalidateQueries({ queryKey: ['managed-profiles'] })}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {(() => {
                    const allow = p.actions;
                    return (
                    <>
                      <Link className="btn-outline" to={`/biodata?profileId=${p.id}`}>
                        Complete biodata
                      </Link>
                      {/*
                        The invite goes first, and it is the primary button
                        while it is the thing that matters.

                        A profile whose invitation is outstanding has exactly
                        one useful next action, and it was sitting fourth —
                        after Photos, Reach and Circulate — where an agent
                        working through a list has to look for it every time.
                        Once the client has claimed the profile there is nothing
                        to send and the button is gone, so nothing else moves.
                      */}
                      {can(permissions, Permission.MANAGED_PROFILE_INVITE) && allow?.canInvite && (
                        <div className="flex flex-col">
                          {/*
                            The invitation SMS is the client's verification code,
                            so it must never go to a malformed number (EZ1-I63).
                            The number is validated when the profile is created,
                            but a bad one that reached the record another way is
                            caught here before the code is ever requested.
                          */}
                          <button
                            className={p.claimStatus === 'invited' ? 'btn' : 'btn-outline'}
                            disabled={Boolean(p.contactPhone) && !isValidMobile(p.contactPhone!)}
                            onClick={() => invite.mutate(p.id)}
                          >
                            {p.claimStatus === 'invited' ? 'Resend invite' : 'Send invite'}
                          </button>
                          {Boolean(p.contactPhone) && !isValidMobile(p.contactPhone!) && (
                            <span className="mt-1 text-xs text-red-600">
                              The mobile number is not valid. Fix it before sending the code.
                            </span>
                          )}
                        </div>
                      )}
                      {allow?.canManagePhotos && (
                      <button
                        className="btn-outline"
                        onClick={() => setSelected(selected === p.id ? null : p.id)}
                      >
                        {selected === p.id ? 'Close' : 'Photos'}
                      </button>
                      )}
                      {allow?.canCirculate && (
                        <button
                          className="btn-outline"
                          onClick={() => setReach(reach === p.id ? null : p.id)}
                        >
                          {reach === p.id ? 'Hide reach' : 'Reach'}
                        </button>
                      )}
                      {/*
                        Circulation is off until somebody says otherwise, and
                        the button says which state it is in. A Circulate button
                        that opens a dialog only to refuse is how an agent loses
                        confidence in the whole screen.
                      */}
                      {can(permissions, Permission.PROFILE_CIRCULATE) &&
                        allow?.canCirculate &&
                        (p.circulation && !p.circulation.mayCirculate ? (
                          <button
                            className="btn-outline"
                            title={p.circulation.reason ?? undefined}
                            onClick={() => setEnabling(enabling === p.id ? null : p.id)}
                          >
                            {enabling === p.id
                              ? 'Cancel'
                              : p.circulation.needsReconfirmation
                                ? 'Re-confirm circulation'
                                : 'Enable circulation'}
                          </button>
                        ) : (
                          <button
                            className="btn"
                            onClick={() => setSharing(sharing === p.id ? null : p.id)}
                          >
                            {sharing === p.id ? 'Done' : 'Circulate'}
                          </button>
                        ))}
                      {allow?.canPause && p.lifecycle === 'deactivated' ? (
                        <button
                          className="btn-outline"
                          onClick={() => lifecycle.mutate({ id: p.id, action: 'reactivate' })}
                        >
                          Resume
                        </button>
                      ) : (
                        allow?.canPause && (
                          <button
                            className="btn-outline"
                            onClick={() =>
                              lifecycle.mutate({
                                id: p.id,
                                action: 'deactivate',
                                reason:
                                  window.prompt('Why are they pausing? (optional)') || undefined,
                              })
                            }
                          >
                            Pause
                          </button>
                        )
                      )}
                      {allow?.canClose && (
                        <button
                          className="btn-outline"
                          onClick={() => {
                            const reason = window.prompt(
                              'Closing the engagement. Why? (optional)',
                            );
                            if (reason !== null) {
                              lifecycle.mutate({
                                id: p.id,
                                action: 'archive',
                                reason: reason || undefined,
                              });
                            }
                          }}
                        >
                          Close
                        </button>
                      )}
                      {allow?.canDelete && (
                        <button
                          className="btn-outline"
                          onClick={() => {
                            // Deleting a client removed them the instant the
                            // button was pressed, with nothing in between —
                            // and it sits at the end of a row of six other
                            // buttons an agent clicks all day. The dialog names
                            // the person, because "are you sure?" is a question
                            // nobody reads.
                            if (
                              !window.confirm(
                                `Delete ${p.displayName}? This removes the profile and everything on it, and cannot be undone. Pause or Close keeps the record.`,
                              )
                            ) {
                              return;
                            }
                            remove.mutate(p.id);
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </>
                    );
                  })()}
                </div>
              </div>

              {selected === p.id && <PhotoEditor profile={p} onError={setError} />}
              {reach === p.id && <ReachPanel profileId={p.id} />}

              {sharing === p.id && (
                <ShareProfileDialog
                  profileId={p.id}
                  profileName={p.displayName}
                  pooled={p.networkVisibility === 'pool'}
                  onClose={() => setSharing(null)}
                />
              )}

              {enabling === p.id && (
                <EnableCirculation
                  profileId={p.id}
                  profileName={p.displayName}
                  needsReconfirmation={p.circulation?.needsReconfirmation ?? false}
                  onDone={() => {
                    setEnabling(null);
                    void qc.invalidateQueries({ queryKey: ['managed-profiles'] });
                    void qc.invalidateQueries({ queryKey: ['consent', p.id] });
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
      </>
    );
  }
}

interface Completion {
  complete: boolean;
  percent: number;
  missing: string[];
}

/**
 * The intake import may leave gaps. Keep that answer visible in the agent's
 * client list, using the same completion report the profile owner sees in
 * Biodata, so neither party has to guess what remains.
 */
function CompletionStatus({
  profileId,
  visibility,
  family = false,
  canPublish,
  onPublished,
}: {
  profileId: string;
  visibility: ManagedProfile['visibility'];
  /**
   * A family's relative is matchable without an agent's review step, so the
   * family can make a private one visible at any time, not only once complete.
   */
  family?: boolean;
  canPublish: boolean;
  onPublished: () => void;
}) {
  const { data } = useQuery({
    queryKey: ['profile-completion', profileId],
    queryFn: async () =>
      (await api.get(`/profiles/${profileId}/details`)).data.completion as Completion,
    staleTime: 30_000,
  });
  const publish = useMutation({
    mutationFn: async () => api.put(`/agents/profiles/${profileId}`, { visibility: 'matches_only' }),
    onSuccess: onPublished,
  });

  if (!data) return null;
  if (family) {
    const progress = data.complete
      ? 'Biodata complete.'
      : `${data.percent}% biodata complete. Still needed: ${data.missing.join(', ')}.`;
    if (visibility !== 'private') {
      return (
        <p className={`mt-1 text-xs ${data.complete ? 'font-medium text-emerald-700' : 'text-amber-800'}`}>
          Visible in matches. {progress}
        </p>
      );
    }
    return (
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-amber-800">Private: not shown in matches. {progress}</span>
        {canPublish && (
          <button
            type="button"
            className="text-brand underline underline-offset-2"
            disabled={publish.isPending}
            onClick={() => publish.mutate()}
          >
            {publish.isPending ? 'Making matchable…' : 'Make matchable'}
          </button>
        )}
      </div>
    );
  }
  if (data.complete) {
    if (visibility !== 'private') {
      return <p className="mt-1 text-xs font-medium text-emerald-700">Biodata complete</p>;
    }
    return (
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-emerald-700">Biodata complete, but private.</span>
        {canPublish && (
          <button
            type="button"
            className="text-brand underline underline-offset-2"
            disabled={publish.isPending}
            onClick={() => publish.mutate()}
          >
            {publish.isPending ? 'Making matchable…' : 'Make matchable'}
          </button>
        )}
      </div>
    );
  }
  return (
    <p className="mt-1 text-xs text-amber-800">
      {data.percent}% biodata complete. Private until complete. Still needed: {data.missing.join(', ')}.
    </p>
  );
}

/**
 * A standing sign-up link the agency hands out to bring on new clients
 * (EZ1-I166).
 *
 * Different from inviting: there is no profile to build first. Anybody the link
 * reaches creates their own account — choosing their own password, which the
 * agent never sees — and it lands in the agency's book. The token is shown once
 * here, because it is stored scrambled and cannot be shown again; re-minting
 * rotates it and withdrawing stops it working.
 */
function ClientSignupLink({ active }: { active: boolean }) {
  const qc = useQueryClient();
  const [token, setToken] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  /*
   * The address comes from the server, whole (EZ1-I178).
   *
   * It was assembled here from `window.location.origin`, which is the agent's
   * own address bar — `localhost:8080` on a dev machine, an internal hostname
   * behind a proxy — and then sent to a client who could not open it. The
   * server builds it from APP_BASE_URL, the runtime setting every other link
   * the platform hands out already uses.
   */
  const [link, setLink] = useState('');

  const mint = useMutation({
    mutationFn: async () =>
      (await api.post('/agents/agency/share-link', {})).data as { token: string; url: string },
    onSuccess: (d) => {
      setToken(d.token);
      setLink(d.url);
      setError('');
      qc.invalidateQueries({ queryKey: ['agency-status'] });
    },
    onError: (e) => setError(apiMessage(e, 'The link could not be created.')),
  });

  const revoke = useMutation({
    mutationFn: async () => api.delete('/agents/agency/share-link'),
    onSuccess: () => {
      setToken('');
      setLink('');
      setError('');
      qc.invalidateQueries({ queryKey: ['agency-status'] });
    },
    onError: (e) => setError(apiMessage(e, 'The link could not be withdrawn.')),
  });

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="section-title">Add clients by sharing a link</h2>
        <p className="text-sm text-gray-500">
          One link anybody can open to create their own account. It lands in your book, and they
          set their own password — you never see it.
        </p>
      </div>

      {error && <p className="alert-critical">{error}</p>}

      {!token ? (
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-outline" disabled={mint.isPending} onClick={() => mint.mutate()}>
            {mint.isPending ? 'Creating…' : active ? 'Replace the sign-up link' : 'Create a sign-up link'}
          </button>
          {active && (
            <>
              <button
                className="btn-outline text-red-700"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate()}
              >
                Withdraw it
              </button>
              <p className="text-xs text-gray-500">
                A link is already active. Replacing it makes a new one and stops the old one.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2 rounded-sm border border-gray-200 bg-gray-50 p-3">
          <p className="text-sm font-medium text-gray-800">Your client sign-up link</p>
          <div className="flex flex-wrap items-center gap-2">
            <input className="input min-w-0 flex-1 font-mono text-xs" readOnly value={link} />
            <button
              className="btn-outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                } catch {
                  setError('Copying was blocked. Select the link above instead.');
                }
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <a
              className="btn-outline"
              href={`https://wa.me/?text=${encodeURIComponent(
                `Create your WOW profile with us: ${link}`,
              )}`}
              target="_blank"
              rel="noreferrer"
            >
              WhatsApp
            </a>
          </div>
          <p className="text-xs text-gray-500">
            Save it somewhere — it is stored scrambled, so it cannot be shown again. Anybody with
            this link can sign up into your book.
          </p>
          <button
            className="btn-ghost text-red-700"
            disabled={revoke.isPending}
            onClick={() => revoke.mutate()}
          >
            Withdraw it
          </button>
        </div>
      )}
    </div>
  );
}

function PhotoEditor({
  profile,
  onError,
}: {
  profile: ManagedProfile;
  onError: (msg: string) => void;
}) {
  const qc = useQueryClient();
  const [url, setUrl] = useState('');

  async function add(e: FormEvent) {
    e.preventDefault();
    try {
      await api.post(`/agents/profiles/${profile.id}/photos`, { url });
      setUrl('');
      qc.invalidateQueries({ queryKey: ['managed-profiles'] });
    } catch (err) {
      onError(apiMessage(err, 'That photo could not be added.'));
    }
  }

  async function drop(photo: string) {
    try {
      await api.delete(`/agents/profiles/${profile.id}/photos`, { data: { url: photo } });
      qc.invalidateQueries({ queryKey: ['managed-profiles'] });
    } catch (err) {
      onError(apiMessage(err));
    }
  }

  return (
    <div className="mt-3 rounded-lg bg-gray-50 p-3">
      <div className="flex flex-wrap gap-3">
        {(profile.photos ?? []).map((photo) => (
          <div key={photo} className="relative">
            <img
              src={photo}
              alt=""
              className="h-24 w-24 rounded-sm object-cover"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.opacity = '0.3';
              }}
            />
            <button
              className="absolute right-1 top-1 rounded-sm bg-surface/90 px-1.5 text-xs"
              onClick={() => drop(photo)}
              aria-label="Remove photo"
            >
              &times;
            </button>
          </div>
        ))}
        {(profile.photos ?? []).length === 0 && (
          <div className="flex items-center gap-3">
            <ProfileSilhouette gender={profile.gender} className="h-24 w-24 rounded-sm" />
            <p className="text-sm text-gray-500">No photos yet.</p>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <PhotoUploader
          label="Upload a photo"
          purpose="profile_photo"
          onUploaded={async (uploaded) => {
            try {
              await api.post(`/agents/profiles/${profile.id}/photos`, { url: uploaded });
              qc.invalidateQueries({ queryKey: ['managed-profiles'] });
            } catch (err) {
              onError(apiMessage(err, 'That photo could not be added.'));
            }
          }}
        />
        <span className="text-sm text-gray-400">or</span>
        <form onSubmit={add} className="flex flex-1 flex-wrap items-end gap-2">
          <input
            className="input flex-1"
            placeholder="https://… paste an address"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
          <button className="btn-outline">Add</button>
        </form>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Up to 20 photos. Uploading is usually easier. The file goes straight from this device to
        storage without passing through us.
      </p>
    </div>
  );
}

/**
 * Did circulating this profile lead anywhere?
 *
 * An agency could already see who held a profile and whether a link had been
 * opened, but not whether any of it produced anything — which is the only
 * question they actually have. "Opened and then silence" is the number worth
 * acting on: it means the biodata is being read and passed over, which is a
 * different problem from nobody looking at it.
 */
function ReachPanel({ profileId }: { profileId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['reach', profileId],
    queryFn: async () => (await api.get(`/circulation/profiles/${profileId}/reach`)).data,
    retry: false,
  });

  if (isLoading) return <Loading rows={2} className="py-2" />;
  if (!data) return null;

  return (
    <div className="mt-2 rounded-sm bg-gray-50 p-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Shared with" value={data.live} note={`${data.revoked} withdrawn`} />
        <Metric label="Opened" value={data.opened} note={`${data.totalViews} views`} />
        <Metric label="Interests" value={data.interests} note={`${data.accepted} accepted`} />
        <Metric
          label="Read, then nothing"
          value={data.openedButSilent}
          note="Worth a follow-up call"
        />
      </div>
      {data.live === 0 && (
        <p className="mt-2 text-sm text-gray-600">
          This profile has not been circulated yet.
        </p>
      )}
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p
        className="text-xl font-semibold text-gray-900"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </p>
      <p className="text-xs text-gray-500">{note}</p>
    </div>
  );
}

/**
 * Turning circulation on after the fact.
 *
 * The checkbox on the intake form decides this on day one, and until now that
 * was the only chance anybody got: a family who said "not yet" at the desk and
 * changed their mind a month later had no way through. Consent is append-only,
 * so this records a fresh one rather than editing the old — which is also the
 * honest thing, because it *is* a fresh conversation with the family.
 *
 * The confirmation is not ceremony. Circulating a biodata puts somebody's
 * photograph and horoscope in front of strangers, and an agent should have to
 * say out loud who agreed to that.
 */
function EnableCirculation({
  profileId,
  profileName,
  needsReconfirmation,
  onDone,
}: {
  profileId: string;
  profileName: string;
  needsReconfirmation: boolean;
  onDone: () => void;
}) {
  const [consent, setConsent] = useState<ConsentDraft>(emptyConsent());
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.post(`/circulation/profiles/${profileId}/consent`, {
        scope: 'circulation',
        ...consentPayload(consent, false),
      });
      onDone();
    } catch (err) {
      setError(apiMessage(err, 'That consent could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-3 rounded-sm bg-amber-50/60 p-3">
      <div>
        <p className="text-sm font-medium text-gray-900">
          {needsReconfirmation ? 'Re-confirm circulation' : 'Enable circulation'} for {profileName}
        </p>
        <p className="text-sm text-gray-600">
          {needsReconfirmation
            ? 'The earlier consent has lapsed. Ring the family and record the new one.'
            : 'This profile was taken on without permission to share it. Record that permission here.'}
        </p>
      </div>

      {error && <p className="alert-critical">{error}</p>}

      <ConsentFields value={consent} onChange={setConsent} showCirculation={false} />

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <span className="text-gray-700">
          I have spoken to the family and they agree to this biodata being shared with other
          agencies and prospective families.
        </span>
      </label>

      <button className="btn" disabled={!confirmed || busy}>
        {busy ? 'Recording…' : 'Record consent'}
      </button>
    </form>
  );
}
