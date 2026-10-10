import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { dateTime, humanise, shortDate } from '@/lib/format';
import { CORRECTION_FIELD_LABELS } from '@/shared/permissions';
import { DetailGrid, DetailRow, Divider } from '@/components/chrome';
import { DocumentList } from '@/components/uploader';
import {
  CatalogSummaryList,
  PortfolioGallery,
  SubmittedSocialLinks,
} from '@/components/business/catalog-summary';
import type { SummaryService } from '@/shared/catalog-rules';
import type { SocialLinks } from '@/components/social-links';
import { useCategoryNames } from '@/components/business/category-picker';
import { Body, Caption, Card, Loading, SectionTitle } from '@/components/ui';
import { radius, rgb, space, useTheme } from '@/theme';

/**
 * What is actually being verified.
 *
 * The queue used to show a request id and an applicant type, which tells an
 * officer nothing about where to go or what to check. This is the record the
 * decision is about — the business or agency as the applicant filled it in —
 * plus every hand the request has passed through, so an approval can be read
 * back later and understood.
 *
 * On a phone this is the reason the request has its own screen rather than an
 * expanding card: an officer standing outside an address needs the address, the
 * contact number, the compliance documents and the correction history at once,
 * and none of that fits under a row in a queue.
 */
export function SubjectDetails({
  requestId,
  applicantType,
}: {
  requestId: string;
  applicantType?: string;
}) {
  const theme = useTheme();
  const categoryNames = useCategoryNames();

  const { data, isPending } = useQuery({
    queryKey: ['verification-request', requestId],
    queryFn: async () => (await api.get(`/verification/requests/${requestId}`)).data,
    retry: false,
  });

  if (isPending) {
    return (
      <Card>
        <Loading rows={3} />
      </Card>
    );
  }

  const subject = data?.subject as Record<string, unknown> | null;
  const applicant = data?.applicant as Record<string, unknown> | null;
  // The stored history entries are { at, byUserId, status, remarks }. Reading
  // them as { action, note } is what made this panel throw on any request that
  // had history at all, so the shape is written out here.
  const history = (data?.history ?? []) as {
    at: string;
    status?: string;
    byUserId?: string;
    remarks?: string;
  }[];

  const text = (value: unknown) =>
    value === null || value === undefined || value === '' ? '—' : String(value);

  const portfolio = Array.isArray(subject?.portfolio) ? (subject!.portfolio as string[]) : [];
  const documents = Array.isArray(subject?.complianceDocuments)
    ? (subject!.complianceDocuments as string[])
    : [];
  const services = Array.isArray(data?.services) ? (data!.services as SummaryService[]) : [];
  const correctionFields = Array.isArray(subject?.correctionFields)
    ? (subject!.correctionFields as string[])
    : [];

  return (
    <Card>
      <SectionTitle>The record being verified</SectionTitle>

      {subject && (
        <>
          <Divider />
          <DetailGrid>
            <DetailRow label="Name">{text(subject.name ?? subject.agencyName)}</DetailRow>
            {/*
              A planner has no category, and a fallback of "Marriage agency"
              labelled every planner under review as something it is not. The
              applicant type is what the queue already knows.
            */}
            <DetailRow label="Category">
              {Array.isArray(subject.categories) && subject.categories.length > 0
                ? categoryNames(subject.categories as string[]).join(', ')
                : subject.category
                  ? categoryNames([String(subject.category)]).join(', ')
                  : text(
                      subject.otherCategory ??
                        (applicantType === 'planner'
                          ? 'Wedding planner'
                          : applicantType === 'agent'
                            ? 'Marriage agency'
                            : null),
                    )}
            </DetailRow>
            <DetailRow label="City">{text(subject.city)}</DetailRow>
            <DetailRow label="Registered address">
              {text(subject.registeredAddress ?? subject.address)}
            </DetailRow>
            <DetailRow label="Contact number">{text(subject.contactPhone)}</DetailRow>
            <DetailRow label="GST number">{text(subject.gstNumber)}</DetailRow>
            <DetailRow label="PAN">{text(subject.panNumber)}</DetailRow>
            <DetailRow label="Registration number">{text(subject.registrationNumber)}</DetailRow>
            <DetailRow label="Trading since">
              {text(subject.tradingSince ?? subject.startDate)}
            </DetailRow>
            <DetailRow label="Currently approved">{subject.isApproved ? 'Yes' : 'No'}</DetailRow>
          </DetailGrid>
        </>
      )}

      {subject?.description ? (
        <>
          <Divider />
          <Body tone="muted">{String(subject.description)}</Body>
        </>
      ) : null}

      {/*
        Social media links the business submitted. They were always in the
        response and never drawn. Each platform and address once.
      */}
      {subject && applicantType !== 'agent' ? (
        <>
          <Divider />
          <Caption tone="faint">Social media links</Caption>
          <SubmittedSocialLinks listing={subject as SocialLinks} />
        </>
      ) : null}

      {/* Portfolio images the business submitted, each opening full screen. */}
      {portfolio.length > 0 && (
        <>
          <Divider />
          <Caption tone="faint">Portfolio ({portfolio.length})</Caption>
          <PortfolioGallery urls={portfolio} />
        </>
      )}

      {/* Compliance documents — an officer checks these before the visit. */}
      {documents.length > 0 && (
        <>
          <Divider />
          <Caption tone="faint">Compliance documents ({documents.length})</Caption>
          <DocumentList urls={documents} />
        </>
      )}

      {/*
        Catalog & services in full: category name, service name, and for every
        price its name, details and description.
      */}
      {services.length > 0 && (
        <>
          <Divider />
          <Caption tone="faint">Catalog & services ({services.length})</Caption>
          <CatalogSummaryList services={services} />
        </>
      )}

      {/*
        When the listing was sent back for a targeted correction, the fields the
        vendor was allowed to change — previous against updated — so the officer
        checks the change rather than taking the resubmission on trust.
        `correctionSnapshot` is what each field held when the correction was
        raised; the value on `subject` is what it holds now.
      */}
      {correctionFields.length > 0 && (
        <>
          <Divider />
          <Caption style={{ color: rgb(theme.cautionFg), fontWeight: '600' }}>
            Correction requested — previous vs updated
          </Caption>
          {correctionFields.map((field) => {
            const snapshot =
              (subject!.correctionSnapshot as Record<string, unknown> | null | undefined) ?? {};
            const before = snapshot[field];
            const after = subject![field];
            const changed = JSON.stringify(before ?? null) !== JSON.stringify(after ?? null);
            return (
              <View
                key={field}
                style={{
                  backgroundColor: rgb(theme.cautionBg),
                  borderRadius: radius.sm,
                  padding: space(2.5),
                  gap: space(1),
                }}
              >
                <Caption style={{ color: rgb(theme.cautionFg), fontWeight: '600' }}>
                  {CORRECTION_FIELD_LABELS[field] ?? field}
                </Caption>
                <Caption
                  style={{ color: rgb(theme.cautionFg), textDecorationLine: 'line-through' }}
                >
                  {correctionValue(before)}
                </Caption>
                <Caption style={{ color: rgb(theme.cautionFg), fontWeight: changed ? '600' : '400' }}>
                  {correctionValue(after)}
                  {changed ? '' : ' (unchanged)'}
                </Caption>
              </View>
            );
          })}
        </>
      )}

      {applicant && (
        <>
          <Divider />
          <Caption tone="faint">
            Applicant: {text(applicant.email)}
            {applicant.phone ? ` · ${String(applicant.phone)}` : ''}
            {applicant.createdAt ? ` · joined ${shortDate(String(applicant.createdAt))}` : ''}
          </Caption>
        </>
      )}

      {history.length > 0 && (
        <>
          <Divider />
          <Caption tone="faint">History</Caption>
          {history.map((entry, i) => (
            <Caption key={i}>
              <Caption tone="faint">{dateTime(entry.at)} · </Caption>
              {humanise(entry.status ?? 'updated')}
              {entry.remarks ? `: ${entry.remarks}` : ''}
            </Caption>
          ))}
        </>
      )}
    </Card>
  );
}

/** A correction field's value as a short string, for the previous-vs-updated diff. */
function correctionValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length === 0 ? '—' : `${value.length} item${value.length === 1 ? '' : 's'}`;
  }
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}
