import { View } from 'react-native';
import { useCategoryNames } from '@/components/business/category-picker';

import type { VendorListing } from '@/lib/vendor-listing';
import { DetailGrid, DetailRow, Divider } from '@/components/chrome';
import { RequestChange } from '@/components/business/request-change';
import { MediaStrip } from '@/components/uploader';
import { SocialLinksList, ViewInstagramButton } from '@/components/social-links';
import {
  Alert,
  Body,
  Button,
  Caption,
  Card,
  PageSubtitle,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { space } from '@/theme';

/**
 * A verified listing's saved details, before any editing (EZ1-I207).
 *
 * Business Details opened straight into its form for a verified listing and
 * stayed on that form after saving, which read as if nothing had been kept.
 * This is what the screen shows first, as the web page does: what couples see,
 * the details that are locked, and "Edit details" for the parts that are not.
 * A successful save comes back here, with the saved values and the notice.
 */
export function VerifiedDetails({
  listing,
  notice,
  onEdit,
}: {
  listing: VendorListing;
  notice: string;
  onEdit: () => void;
}) {
  const categoryNames = useCategoryNames();
  return (
    <Screen>
      <View style={{ gap: space(1) }}>
        <PageSubtitle>
          Your listing is verified. About, contact number and photos are yours to change; the
          verified details are locked.
        </PageSubtitle>
      </View>

      {notice ? <Alert tone="positive">{notice}</Alert> : null}

      <Card>
        <SectionTitle>About</SectionTitle>
        {listing.description ? (
          <Body>{listing.description}</Body>
        ) : (
          <Body tone="muted">No description yet.</Body>
        )}
        <Divider />
        <DetailGrid>
          <DetailRow label="Contact number">{listing.contactPhone ?? 'Not provided'}</DetailRow>
        </DetailGrid>
        <SocialLinksList links={listing} />
        {/* The button couples get on the listing, to check it lands on the profile. */}
        <ViewInstagramButton listing={listing} />
      </Card>

      <Card>
        <SectionTitle>Portfolio</SectionTitle>
        {(listing.portfolio?.length ?? 0) > 0 ? (
          <MediaStrip urls={listing.portfolio} />
        ) : (
          <Body tone="muted">No photos yet.</Body>
        )}
      </Card>

      <Card>
        <SectionTitle>Verified details</SectionTitle>
        <Caption tone="faint">Locked while the listing is verified.</Caption>
        <Divider />
        <DetailGrid>
          <DetailRow label="Business name">{listing.name}</DetailRow>
          <DetailRow label="Categories">
            {categoryNames(listing.categories).join(', ') || 'Not chosen yet'}
          </DetailRow>
          <DetailRow label="City">{listing.city || 'Not provided'}</DetailRow>
          <DetailRow label="GST number">{listing.gstNumber ?? 'Not provided'}</DetailRow>
          <DetailRow label="PAN">{listing.panNumber ?? 'Not provided'}</DetailRow>
          <DetailRow label="Registration number">
            {listing.registrationNumber ?? 'Not provided'}
          </DetailRow>
          <DetailRow label="Registered address">
            {listing.registeredAddress ?? 'Not provided'}
          </DetailRow>
        </DetailGrid>
      </Card>

      <Button label="Edit details" onPress={onEdit} />
      <RequestChange vendorId={listing.id} />
    </Screen>
  );
}
