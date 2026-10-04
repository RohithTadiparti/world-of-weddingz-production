import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { api, apiMessage } from '@/lib/api';
import { todayIso } from '@/components/calendar';
import { useActiveListing } from '@/lib/vendor-listing';
import { isPlannerAccount } from '@/lib/planner-listing';
import { PlannerListingForm } from '@/components/business/planner-listing';
import { selectPermissions, useAuth } from '@/store/auth';
import { GSTIN_PATTERN, PAN_PATTERN } from '@/shared/permissions';
import { Divider, InfoNote } from '@/components/chrome';
import { Textarea } from '@/components/form';
import { WowCalendar } from '@/components/common/WowCalendar';
import { useCompletion, useRefreshBusiness } from '@/components/business/completion';
import { BusinessWizard, WizardNavigation } from '@/components/business/wizard';
import { VerifiedDetails } from '@/components/business/verified-details';
import { CategoryPicker } from '@/components/business/category-picker';
import { DocumentList, MediaStrip, PhotoPicker } from '@/components/uploader';
import { SocialLinksEditor } from '@/components/social-links';
import {
  listingSocialLinks,
  normaliseSocialLinks,
  socialLinkErrors,
  type SocialLink,
} from '@/shared/social-links';
import {
  Alert,
  Body,
  Button,
  Caption,
  Card,
  Field,
  Loading,
  PageSubtitle,
  Screen,
  RequiredMark,
  SectionTitle,
} from '@/components/ui';
import { useBusinesses } from '@/store/business';
import { space } from '@/theme';

/**
 * Business Details — step one of My Business.
 *
 * The web client's VendorListingForm, field for field and message for message.
 * Two things about it are worth keeping in mind while reading:
 *
 * The validation is deliberately duplicated from that file rather than shared,
 * because the API validates the same things again and this exists only to say
 * *which* field is wrong before a round trip. The wording matters more than the
 * logic — "A PAN is required — it is what payouts are made against" tells a
 * vendor why, and "invalid" does not.
 *
 * And whether the form may be submitted at all is the server's answer, not this
 * screen's: `completion().rules` decides whether the identity fields are open,
 * whether only the presentational ones are, or whether the whole thing is
 * locked because an officer has already been sent to check it.
 */

const EMPTY = {
  name: '',
  city: '',
  description: '',
  gstNumber: '',
  panNumber: '',
  registrationNumber: '',
  tradingSince: '',
  registeredAddress: '',
  contactPhone: '',
};

type Form = typeof EMPTY;
type Errors = Partial<
  Record<keyof Form | 'categories' | 'portfolio' | 'complianceDocuments' | 'socialLinks', string>
>;

const MOBILE = /^(\+91)?[6-9]\d{9}$/;

function validateBusinessDescription(description: string): string | undefined {
  if (!description.trim()) return 'Description is required.';
  if (description.length > 1000) return 'Description cannot exceed 1,000 characters.';
  if (description.trim().length < 50) return 'Description must contain at least 50 characters.';
  return undefined;
}

/**
 * The route, for either kind of provider.
 *
 * A planner's listing is one form rather than the vendor's guided set-up, and
 * is reached from More. It writes `/wedding-planners/me`; the vendor form below
 * writes `/vendors`, which a planner cannot hold, and was all this route did.
 */
export default function BusinessDetailsRoute() {
  const permissions = useAuth(selectPermissions);
  return isPlannerAccount(permissions) ? <PlannerListingForm /> : <BusinessDetails />;
}

function BusinessDetails() {
  const router = useRouter();
  const qc = useQueryClient();
  const refresh = useRefreshBusiness();
  const { activeId } = useBusinesses();
  const { listing, isPending } = useActiveListing(activeId);
  const { data: completion, isPending: completionPending } = useCompletion(activeId);

  const [form, setForm] = useState<Form>(EMPTY);
  // One to five catalogue categories, first one first (EZ1-I263).
  const [categories, setCategories] = useState<string[]>([]);
  const [portfolio, setPortfolio] = useState<string[]>([]);
  const [documents, setDocuments] = useState<string[]>([]);
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  // After a save attempt every link row shows its problem.
  const [showLinkErrors, setShowLinkErrors] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Behind "Edit details" on a verified listing's saved details.
  const [editing, setEditing] = useState(false);

  /*
   * Whether this listing may still be edited, asked of the server.
   *
   * The API already refuses an edit once a listing is submitted — a vendor who
   * changes their GST number after an officer has been sent to check it has
   * verified nothing — and reading the answer rather than re-deriving it is
   * what keeps the form from offering a save the API will refuse.
   */
  const locked = completion ? !completion.rules.editIdentity : false;
  const presentationalOnly = locked && (completion?.rules.editPresentational ?? false);
  const readOnly = locked && !presentationalOnly;

  useEffect(() => {
    if (!listing) return;
    setForm({
      name: listing.name ?? '',
      city: listing.city ?? '',
      description: listing.description ?? '',
      gstNumber: listing.gstNumber ?? '',
      panNumber: listing.panNumber ?? '',
      registrationNumber: listing.registrationNumber ?? '',
      tradingSince: listing.tradingSince ? listing.tradingSince.slice(0, 10) : '',
      registeredAddress: listing.registeredAddress ?? '',
      contactPhone: listing.contactPhone ?? '',
    });
    setCategories(listing.categories ?? []);
    setPortfolio(listing.portfolio ?? []);
    setDocuments(listing.complianceDocuments ?? []);
    // The stored list as it is, so a link the rules now refuse is shown to be
    // fixed; the three single fields only from a server with no list.
    setSocialLinks(
      Array.isArray(listing.socialLinks) ? listing.socialLinks : listingSocialLinks(listing),
    );
    setShowLinkErrors(false);
  }, [listing, editing]);

  /** The link rows' problems, under one key; each row shows its own. */
  function linkErrors(): Errors {
    const check = socialLinkErrors(socialLinks);
    return check.any ? { socialLinks: check.list ?? 'Fix the highlighted links.' } : {};
  }

  const set = (key: keyof Form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Into and out of the form behind a verified listing's saved details; the
  // effect above resets the form to the saved listing either way.
  const startEdit = () => { setNotice(''); setEditing(true); };
  const cancelEdit = () => { setErrors({}); setError(''); setEditing(false); };

  /** Field-level, and specific about what is wrong rather than "invalid". */
  function validate(): Errors {
    const found: Errors = {};
    const descriptionError = validateBusinessDescription(form.description);
    if (descriptionError) found.description = descriptionError;
    const businessName = form.name.trim();
    if (!businessName) found.name = 'Business name is required.';
    else if (businessName.length < 2 || businessName.length > 100) {
      found.name = 'Business name must be between 2 and 100 characters.';
    } else if (!/^(?=.*[\p{L}\p{N}])[\p{L}\p{N} .&'-]+$/u.test(businessName)) {
      found.name = 'Please enter a valid business name.';
    }
    // Category, city, registered address, a portfolio image and a compliance
    // document are all mandatory to submit a listing for verification — an
    // officer cannot verify a business that has named none of them.
    if (categories.length === 0) found.categories = 'Choose at least one category';
    if (!form.city.trim()) found.city = 'A city is required';
    if (!form.registeredAddress.trim()) {
      found.registeredAddress = 'A registered address is required — it is where the officer visits';
    }
    if (portfolio.length === 0) found.portfolio = 'Add at least one portfolio photo';
    if (documents.length === 0) {
      found.complianceDocuments = 'Upload at least one compliance document';
    }
    if (form.gstNumber && !GSTIN_PATTERN.test(form.gstNumber.toUpperCase())) {
      found.gstNumber = 'A GSTIN is 15 characters, like 29ABCDE1234F1Z5';
    }
    /*
     * PAN is required; GST and the registration number are not.
     *
     * The platform invoices against the PAN and cannot pay anybody out without
     * one, so a listing that reaches verification without it is a listing that
     * cannot be paid. Plenty of legitimate small businesses have no GST
     * registration and no company number, and refusing those would turn away
     * exactly the vendors this marketplace is for.
     */
    if (!form.panNumber.trim()) {
      found.panNumber = 'A PAN is required — it is what payouts are made against';
    } else if (!PAN_PATTERN.test(form.panNumber.toUpperCase())) {
      found.panNumber = 'A PAN is 10 characters, like ABCDE1234F';
    }
    if (!form.contactPhone.trim()) {
      found.contactPhone = 'A contact mobile number is required';
    } else if (!MOBILE.test(form.contactPhone.replace(/\s|-/g, ''))) {
      found.contactPhone = 'Enter a 10-digit Indian mobile number';
    }
    return { ...found, ...linkErrors() };
  }

  /** The lighter check for a verified/live listing: only what is on screen. */
  function validatePresentational(): Errors {
    const found: Errors = {};
    const descriptionError = validateBusinessDescription(form.description);
    if (descriptionError) found.description = descriptionError;
    if (portfolio.length === 0) found.portfolio = 'Add at least one portfolio photo';
    if (!form.contactPhone.trim()) {
      found.contactPhone = 'A contact mobile number is required';
    } else if (!MOBILE.test(form.contactPhone.replace(/\s|-/g, ''))) {
      found.contactPhone = 'Enter a 10-digit Indian mobile number';
    }
    return { ...found, ...linkErrors() };
  }

  async function save(continueToCatalog = false) {
    setError('');
    setNotice('');
    const found = presentationalOnly ? validatePresentational() : validate();
    setErrors(found);
    setShowLinkErrors(true);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      // A verified/live listing may only change the presentational fields, so
      // the payload carries just those — the legal fields are not sent, not
      // merely disabled.
      const payload: Record<string, unknown> = presentationalOnly
        ? {
            description: form.description.trim(),
            contactPhone: form.contactPhone.trim(),
            portfolio,
          }
        : {
            name: form.name.trim(),
            categories,
            // Portfolio is deliberately always sent, including empty: clearing
            // the last photo has to be able to reach the server.
            portfolio,
            complianceDocuments: documents,
          };
      if (!presentationalOnly) {
        for (const key of [
          'city',
          'description',
          'gstNumber',
          'panNumber',
          'registrationNumber',
          'tradingSince',
          'registeredAddress',
          'contactPhone',
        ] as const) {
          // An empty string is not "not provided" — sending one fails the
          // format checks on GST and PAN, so we send null to clear it instead of dropping it.
          payload[key] = form[key] ? form[key] : null;
        }
      }
      // Always sent, including empty: removing the last link has to reach the server.
      payload.socialLinks = normaliseSocialLinks(socialLinks);

      const created = !listing;
      if (listing) await api.put(`/vendors/${listing.id}`, payload);
      else await api.post('/vendors', payload);

      refresh();
      if (listing) void qc.invalidateQueries({ queryKey: ['vendor', listing.id] });
      // Wait for the saved listing, so the details shown next are the saved ones.
      await qc.refetchQueries({ queryKey: ['my-listing'] });

      if (created) {
        // A brand-new listing has nothing to sell yet, so the next step is the
        // catalog — the same place the web wizard's "Save & Continue" lands.
        router.replace('/business-services');
        return;
      }
      setNotice(
        presentationalOnly
          ? 'Saved. Your listing stays live and the change is visible to couples now.'
          : 'Saved. A verification officer visits the registered address before the listing goes live.',
      );
      if (presentationalOnly) setEditing(false);
      else if (continueToCatalog) router.push('/business-services');
    } catch (err) {
      setError(apiMessage(err, 'Could not save the listing.'));
    } finally {
      setBusy(false);
    }
  }

  // Until the rules arrive a verified listing would open as the full form.
  if (isPending || (listing && completionPending)) {
    return (
      <Screen>
        <Loading rows={4} />
      </Screen>
    );
  }

  // A verified listing opens on its saved details, and a save returns to them.
  if (presentationalOnly && listing && !editing) {
    return <VerifiedDetails listing={listing} notice={notice} onEdit={startEdit} />;
  }

  if (readOnly) {
    return (
      <Screen>
        <View style={{ gap: space(1) }}>
          <PageSubtitle>{completion?.rules.note}</PageSubtitle>
        </View>
        <Card>
          <SectionTitle>Locked while it is verified</SectionTitle>
          <Body tone="muted">
            An officer has been sent to check these details, so they cannot change until the visit
            is decided. If it is sent back for changes, this form opens again.
          </Body>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      {!presentationalOnly ? <BusinessWizard step={0} completion={completion} /> : null}
      <View style={{ gap: space(1) }}>
        {/* No title: the native header carries it. Whether this is a first
            listing or an edit is said by the subtitle and by the save button. */}
        {presentationalOnly ? (
          <PageSubtitle>
            Your listing is verified. About, contact number, social links and photos are yours to change and go
            live straight away. The verified details — name, category, PAN, GST, registration and
            address — are locked; use “Request a change” for those.
          </PageSubtitle>
        ) : (
          <PageSubtitle>
            Who you are, where you trade, and the papers behind it. The registered address is where
            the verification officer visits.
          </PageSubtitle>
        )}
        <Caption tone="faint">
          Fields marked
          <RequiredMark /> are required.
        </Caption>
      </View>

      {notice ? <Alert tone="positive">{notice}</Alert> : null}
      {error ? <Alert tone="critical">{error}</Alert> : null}

      {!presentationalOnly && (
        <Card>
          <SectionTitle>The business</SectionTitle>
          <Field
            label="Business name"
            required
            value={form.name}
            onChangeText={set('name')}
            error={errors.name}
            maxLength={100}
            autoCapitalize="words"
          />
          <CategoryPicker
            required
            value={categories}
            onChange={setCategories}
            error={errors.categories}
          />
          <Field
            label="City"
            required
            value={form.city}
            onChangeText={set('city')}
            error={errors.city}
            autoCapitalize="words"
          />
        </Card>
      )}

      <Card>
        <SectionTitle>About</SectionTitle>
        <Textarea
          label="Description"
          required
          value={form.description}
          onChange={set('description')}
          rows={4}
          maxLength={1000}
          error={errors.description}
        />
        <Caption tone="faint">{form.description.length}/1,000</Caption>
        {presentationalOnly && (
          <Field
            label="Contact number"
            required
            value={form.contactPhone}
            onChangeText={set('contactPhone')}
            error={errors.contactPhone}
            keyboardType="phone-pad"
          />
        )}
      </Card>

      {/*
        From the device, not from a URL.

        The web form asked for a link, which a vendor photographing their own
        venue on a phone does not have — and the ones that were pasted showed
        as broken images. Here the camera is one press away, which is the whole
        argument for this app existing.
      */}
      <Card>
        <SectionTitle>
          Portfolio
          <RequiredMark />
        </SectionTitle>
        <Body tone="muted">
          At least one photo is required. Clients rarely book from a listing with none.
        </Body>
        {errors.portfolio ? <Alert tone="critical">{errors.portfolio}</Alert> : null}
        <MediaStrip urls={portfolio} onRemove={(url) => setPortfolio((p) => p.filter((u) => u !== url))} />
        <PhotoPicker
          label="Add photos"
          onUploaded={(url) => setPortfolio((p) => [...p, url])}
        />
      </Card>

      <SocialLinksEditor
        value={socialLinks}
        onChange={setSocialLinks}
        showErrors={showLinkErrors}
        error={errors.socialLinks}
        saved={listing}
      />

      {!presentationalOnly && (
        <>
          {/* The papers the officer asks to see. */}
          <Card>
            <SectionTitle>
              Compliance documents
              <RequiredMark />
            </SectionTitle>
            <Body tone="muted">
              At least one is required. Your PAN document is what the officer checks first. GST and
              any trade licence are useful if you have them.
            </Body>
            {errors.complianceDocuments ? (
              <Alert tone="critical">{errors.complianceDocuments}</Alert>
            ) : null}
            <DocumentList
              urls={documents}
              onRemove={(url) => setDocuments((d) => d.filter((u) => u !== url))}
            />
            <PhotoPicker
              label="Add a document"
              kind="attachment"
              onUploaded={(url) => setDocuments((d) => [...d, url])}
            />
          </Card>

          <Card>
            <SectionTitle>Registration</SectionTitle>
            <Body tone="muted">
              You invoice real money against real events, so we hold the details that answer for
              that. The registered address is where the verification officer visits.
            </Body>
            <Divider />
            <Field
              label="GST number"
              placeholder="29ABCDE1234F1Z5"
              maxLength={15}
              autoCapitalize="characters"
              value={form.gstNumber}
              onChangeText={(v) => set('gstNumber')(v.toUpperCase())}
              error={errors.gstNumber}
            />
            <Field
              label="PAN"
              required
              placeholder="ABCDE1234F"
              maxLength={10}
              autoCapitalize="characters"
              value={form.panNumber}
              onChangeText={(v) => set('panNumber')(v.toUpperCase())}
              error={errors.panNumber}
            />
            <Field
              label="Registration number"
              value={form.registrationNumber}
              onChangeText={set('registrationNumber')}
              autoCapitalize="characters"
            />
            {/* A date, not a year — the same question the agency form answers,
                so families can see how long the business has run. Today or
                earlier only; a future trading-since date is not a real one, and
                the API enforces this too. */}
            <WowCalendar
              label="Trading since"
              value={form.tradingSince}
              onChange={set('tradingSince')}
              maximumDate={todayIso()}
              hint="Today or earlier."
            />
            <Textarea
              label="Registered address"
              required
              value={form.registeredAddress}
              onChange={set('registeredAddress')}
              rows={3}
              maxLength={500}
              error={errors.registeredAddress}
            />
            <Field
              label="Contact number"
              required
              value={form.contactPhone}
              onChangeText={set('contactPhone')}
              error={errors.contactPhone}
              keyboardType="phone-pad"
            />
          </Card>
        </>
      )}

      {!listing ? (
        <InfoNote>
          Saving creates the listing and takes you on to Catalog & Services, where you say what you
          sell and what it costs.
        </InfoNote>
      ) : null}

      <Button
        label={listing ? 'Save changes' : 'Save and continue'}
        busy={busy}
        onPress={() => void save()}
      />
      {!presentationalOnly && listing ? <WizardNavigation back={() => router.back()} next={() => void save(true)} nextLabel="Save & continue" disabled={busy} /> : null}
      {presentationalOnly && listing ? (
        <Button label="Cancel" variant="outline" disabled={busy} onPress={cancelEdit} />
      ) : null}
      {listing ? (
        <Caption tone="faint">
          Nothing entered is lost on a failure — only the fields that are wrong are marked.
        </Caption>
      ) : null}
    </Screen>
  );
}
