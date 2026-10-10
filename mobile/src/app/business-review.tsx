import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { CategoryNames } from '@/components/business/category-picker';
import { shortDate } from '@/lib/format';
import { useActiveListing } from '@/lib/vendor-listing';
import { DetailGrid, DetailRow, Divider } from '@/components/chrome';
import { BusinessChecklist } from '@/components/business/completion';
import { useCompletion } from '@/components/business/completion';
import { BusinessWizard, WizardNavigation } from '@/components/business/wizard';
import { DocumentList } from '@/components/uploader';
import {
  CatalogSummaryList,
  PortfolioGallery,
  SubmittedSocialLinks,
} from '@/components/business/catalog-summary';
import type { SummaryService } from '@/shared/catalog-rules';
import {
  Alert,
  Button,
  Caption,
  Card,
  EmptyState,
  Loading,
  PageSubtitle,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { useBusinesses } from '@/store/business';
import { rgb, useTheme } from '@/theme';

/**
 * Review & Submit — step three of My Business.
 *
 * The whole submission, read-only, and then the gate. Both halves matter: the
 * review is the vendor reading their own listing while they can still change
 * it, and the submission is the moment it locks and an officer is sent. The web
 * client keeps them as separate presses for that reason, and so does this.
 *
 * What is shown is the submission itself rather than a count of it — the actual
 * photographs, each document by name, every service with its prices. A vendor
 * about to lock their listing for a field visit is entitled to see what the
 * officer will see, not "2 Services / 3 Documents".
 */
export default function BusinessReview() {
  const theme = useTheme();
  const router = useRouter();
  const { activeId } = useBusinesses();
  const { listing, isPending } = useActiveListing(activeId);
  const { data: completion } = useCompletion(activeId);

  const { data: services = [] } = useQuery<SummaryService[]>({
    queryKey: ['vendor-services', activeId],
    queryFn: async () => (await api.get(`/vendors/${activeId}/services`)).data,
    enabled: Boolean(activeId),
    retry: false,
  });

  if (isPending) {
    return (
      <Screen>
        <Loading rows={4} />
      </Screen>
    );
  }

  if (!listing) {
    return (
      <Screen>
        <EmptyState title="There is nothing to review yet">
          Create your listing first, then come back here to read it over.
        </EmptyState>
      </Screen>
    );
  }

  const documents = listing.complianceDocuments ?? [];
  // Read from the checklist the Submit button writes into, so this changes the
  // moment the submission is accepted, with no pull-to-refresh.
  const status = completion?.status ?? listing.status;
  const submitted = status === 'pending_verification' || status === 'verification_in_progress';

  return (
    <Screen>
      <BusinessWizard step={2} completion={completion} />
      {submitted ? (
        <Alert tone="positive">
          Submitted for verification.{' '}
          {status === 'verification_in_progress'
            ? 'An officer is verifying it now.'
            : 'An officer will be assigned and will visit the registered address.'}{' '}
          This is what was submitted.
        </Alert>
      ) : null}
      <PageSubtitle>
        {submitted
          ? 'Everything you submitted, read-only while it is being verified.'
          : 'Everything you have entered, read-only. Go back to change anything, then submit for verification below.'}
      </PageSubtitle>

      <Card>
        <SectionTitle>The business</SectionTitle>
        <Divider />
        <DetailGrid>
          <DetailRow label="Business name">{listing.name}</DetailRow>
          <DetailRow label="Category">
            <CategoryNames slugs={listing.categories} fallback="Not chosen yet" />
          </DetailRow>
          <DetailRow label="City">{listing.city || 'Not provided'}</DetailRow>
          <DetailRow label="PAN">{listing.panNumber ?? 'Not provided'}</DetailRow>
          <DetailRow label="GST number">{listing.gstNumber ?? 'Not provided'}</DetailRow>
          <DetailRow label="Registration number">
            {listing.registrationNumber ?? 'Not provided'}
          </DetailRow>
          <DetailRow label="Trading since">
            {listing.tradingSince ? shortDate(listing.tradingSince) : 'Not provided'}
          </DetailRow>
          <DetailRow label="Registered address">
            {listing.registeredAddress ?? 'Not provided'}
          </DetailRow>
          <DetailRow label="Contact number">{listing.contactPhone ?? 'Not provided'}</DetailRow>
        </DetailGrid>

        {listing.description ? (
          <>
            <Divider />
            <DetailRow label="Description">{listing.description}</DetailRow>
          </>
        ) : null}
      </Card>

      {/* Each social link once; this screen did not show them at all. */}
      <Card>
        <SectionTitle>Social media</SectionTitle>
        <SubmittedSocialLinks listing={listing} />
      </Card>

      {/* The actual portfolio images, each opening full screen. */}
      <Card>
        <SectionTitle>Portfolio ({(listing.portfolio ?? []).length})</SectionTitle>
        <PortfolioGallery urls={listing.portfolio ?? []} />
      </Card>

      {/* Each compliance document by name. */}
      <Card>
        <SectionTitle>Compliance documents ({documents.length})</SectionTitle>
        {documents.length > 0 ? (
          <DocumentList urls={documents} />
        ) : (
          <Caption style={{ color: rgb(theme.cautionFg) }}>No documents uploaded yet.</Caption>
        )}
      </Card>

      {/*
        Catalog & services in full: category, service, pricing name, pricing
        details and description for every price.
      */}
      <Card>
        <SectionTitle>Catalog & services ({services.length})</SectionTitle>
        <CatalogSummaryList services={services} />
      </Card>

      {/*
        The checklist and the two-step Submit for Verification are the server's,
        reused verbatim: it decides what is still missing and locks the listing
        on submit.
      */}
      {activeId ? <BusinessChecklist businessId={activeId} /> : null}

      <Button
        label="Edit business details"
        variant="outline"
        onPress={() => router.push('/business-details')}
      />
      <WizardNavigation back={() => router.back()} />
    </Screen>
  );
}
