import { useRef, useState, type ComponentType } from 'react';
import { Linking, Pressable, ScrollView, Share, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { WowHeaderLogo } from '@/components/common/wow-header';
import {
  ArrowLeft,
  Briefcase,
  Cake,
  DotsThreeVertical,
  FileText,
  GenderIntersex,
  GraduationCap,
  HandsPraying,
  Heart,
  House,
  MapPin,
  Ruler,
  SealCheck,
  Translate,
  UsersThree,
  type IconProps,
} from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { ageFrom, GENDER_LABEL, labelFor, stewardshipLine, type Stewardship } from '@/lib/labels';
import { isChartImage } from '@/shared/horoscope';
import { formatDate } from '@/shared/dates';
import { formatHeight } from '@/shared/height';
import { FAMILY_TYPE_LABEL, MARITAL_LABEL, OCCUPATION_LABEL, OTHER_INCOME_LABEL } from '@/shared/permissions';
import { NRI_LABEL } from '@/components/biodata/constants';
import { DetailGrid, DetailRow } from '@/components/chrome';
import { Sheet } from '@/components/sheet';
import { Alert, Body, Button, Caption, Card, EmptyState, Loading, Screen, SectionTitle } from '@/components/ui';
import { radius, rgb, space, useTheme } from '@/theme';
import { ProfileSilhouette } from '@/components/profile-silhouette';

/**
 * One profile, as somebody browsing may see it (EZ1-I261, EZ1-I231).
 *
 * What is shown is the server's decision and not this screen's: before a mutual
 * accept it answers with the basic card and the horoscope headline, and the
 * family, the contact details and the rest of the gallery arrive only once both
 * sides have agreed. This renders whichever of the two came back.
 */
interface ProfileView {
  limited: boolean;
  profile: {
    id: string;
    displayName: string;
    profileCode: string | null;
    city: string | null;
    gender: string | null;
    /** Exact age on every view; the full view also carries the date of birth. */
    age?: number | null;
    /** The older band, read only when an older server sends no age. */
    ageRange?: string | null;
    dateOfBirth?: string | null;
    /** Only once both sides have accepted. */
    bio?: string | null;
    /** Who answers for this person. Null when they manage it themselves. */
    stewardship?: Stewardship | null;
    photos: string[];
    identityVerified: boolean;
  };
  details: Record<string, unknown> | null;
  siblings: { name?: string | null; relation?: string | null }[];
  contact: { phone?: string | null; email?: string | null } | null;
}

interface BoardRow {
  direction: 'incoming' | 'outgoing';
  counterpart?: { id: string } | null;
}

interface Conversation {
  withUserId: string;
  displayName: string;
  photoUrl: string | null;
  profileId?: string | null;
  online: boolean;
}

const INTEREST_LABEL: Record<string, string> = {
  interest_sent: 'Interest Sent',
  interest_received: 'Respond',
  accepted: 'Matched',
  declined_by_you: 'Declined',
  declined_by_them: 'Declined',
};

export default function MatchProfile() {
  const params = useLocalSearchParams<{
    id: string;
    score?: string;
    shortlisted?: string;
    interaction?: string;
    actingProfileId?: string;
  }>();
  const { id } = params;
  const router = useRouter();
  const theme = useTheme();
  const qc = useQueryClient();
  const [savedHere, setSaved] = useState<boolean | null>(
    params.shortlisted ? params.shortlisted === 'true' : null,
  );
  const [interaction, setInteraction] = useState(params.interaction || 'none');
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState('');
  const clientParam = params.actingProfileId ? { profileId: params.actingProfileId } : {};

  const { data, isPending, error: loadError } = useQuery({
    queryKey: ['profile-view', id],
    queryFn: async () => (await api.get(`/profiles/${id}/view`)).data as ProfileView,
    enabled: Boolean(id),
    retry: false,
  });

  const conversations = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => (await api.get('/chat/conversations')).data as Conversation[],
    retry: false,
  });
  const conversation = conversations.data?.find((row) => row.profileId === id);

  // Opened from Interests, Chat or a notification there is no interaction in the
  // route, so the board says where this pair stands.
  const board = useQuery({
    queryKey: ['interest-board', params.actingProfileId || null],
    queryFn: async () =>
      (await api.get('/matches/interests', { params: clientParam })).data as Partial<
        Record<'pending' | 'accepted' | 'declined', BoardRow[]>
      >,
    retry: false,
  });
  const boardInteraction = (() => {
    const find = (rows?: BoardRow[]) => rows?.find((row) => row.counterpart?.id === id);
    if (find(board.data?.accepted)) return 'accepted';
    const pending = find(board.data?.pending);
    if (pending) return pending.direction === 'outgoing' ? 'interest_sent' : 'interest_received';
    const declined = find(board.data?.declined);
    if (declined) return declined.direction === 'outgoing' ? 'declined_by_them' : 'declined_by_you';
    return undefined;
  })();
  const shownInteraction = boardInteraction ?? interaction;

  const shortlistRows = useQuery({
    queryKey: ['shortlist', params.actingProfileId || null],
    queryFn: async () =>
      (await api.get('/matches/shortlist', { params: clientParam })).data as { profile: { id: string } }[],
    enabled: savedHere === null,
    retry: false,
  });
  const saved = savedHere ?? Boolean(shortlistRows.data?.some((row) => row.profile.id === id));

  const shortlist = useMutation({
    mutationFn: () =>
      saved
        ? api.delete(`/matches/shortlist/${id}`, { params: clientParam })
        : api.put(`/matches/shortlist/${id}`, {}, { params: clientParam }),
    onSuccess: () => {
      setSaved(!saved);
      setError('');
      void qc.invalidateQueries({ queryKey: ['suggestions'] });
      void qc.invalidateQueries({ queryKey: ['shortlist'] });
    },
    onError: (e) => setError(apiMessage(e, 'That shortlist could not be updated.')),
  });

  const interest = useMutation({
    mutationFn: () => api.post('/matches/interest', { toProfileId: id, ...clientParam }),
    onSuccess: () => {
      setInteraction('interest_sent');
      setError('');
      void qc.invalidateQueries({ queryKey: ['suggestions'] });
      void qc.invalidateQueries({ queryKey: ['interest-board'] });
    },
    onError: (e) => setError(apiMessage(e, 'That interest could not be sent.')),
  });

  const header = (
    <ProfileHeader
      title={data?.profile.displayName ?? 'Profile'}
      onBack={() => router.back()}
      onMore={data ? () => setMenu(true) : undefined}
    />
  );

  if (isPending || loadError || !data) {
    return (
      <View style={{ flex: 1, backgroundColor: rgb(theme.canvas) }}>
        {header}
        <Screen>
          {isPending ? (
            <Loading rows={4} />
          ) : (
            <EmptyState title="This profile is not available">
              {apiMessage(loadError, 'It may have been withdrawn, or it may not be yours to open.')}
            </EmptyState>
          )}
        </Screen>
      </View>
    );
  }

  const { profile } = data;
  const age =
    ageFrom(profile.dateOfBirth) ??
    (profile.age ? `${profile.age} years` : null) ??
    profile.ageRange ??
    null;
  const steward = stewardshipLine(profile.stewardship);
  const score = params.score ? Number(params.score) : null;
  const d = (data.details ?? {}) as Record<string, unknown>;
  const text = (key: string, from: Record<string, unknown> = d): string | null => {
    const value = from[key];
    return typeof value === 'string' && value.trim() ? value : null;
  };
  const bag = (key: string): Record<string, unknown> =>
    (d[key] as Record<string, unknown> | undefined) ?? {};
  const employment = bag('employment');
  const business = bag('business');
  const prefs = bag('partnerPreferences');
  const range = (min: unknown, max: unknown, unit: string) =>
    typeof min === 'number' && typeof max === 'number' ? `${min}–${max} ${unit}` : null;
  const hometown = [text('nativePlace'), text('nativeDistrict'), text('nativeState')].filter(Boolean).join(', ');

  // Before the accept the chart facts are flattened onto the view; after it
  // they sit inside the horoscope block. Both are read, so one screen serves
  // the two shapes the server sends.
  const chart = { ...bag('horoscope'), ...d };
  const chartUrl = typeof d.horoscopeDocumentUrl === 'string' ? d.horoscopeDocumentUrl : null;

  const interestLabel = INTEREST_LABEL[shownInteraction] ?? 'Send Interest';

  return (
    <View style={{ flex: 1, backgroundColor: rgb(theme.canvas) }}>
      {header}
      <Screen>
        <Gallery photos={profile.photos} gender={profile.gender} />

        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(2) }}>
            <View style={{ flex: 1, gap: space(1) }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5) }}>
                <SectionTitle style={{ fontSize: 20, flexShrink: 1 }} numberOfLines={1}>
                  {profile.displayName}
                </SectionTitle>
                {profile.identityVerified ? (
                  <SealCheck size={20} weight="fill" color={rgb(theme.positiveFg)} />
                ) : null}
              </View>
              <Caption tone="muted">
                {[age, profile.city, profile.profileCode].filter(Boolean).join(' · ')}
              </Caption>
              {steward ? <Caption tone="muted">{steward}</Caption> : null}
            </View>
            {score !== null && Number.isFinite(score) ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                  paddingHorizontal: space(2),
                  paddingVertical: space(1),
                  backgroundColor: rgb(theme.brandSoft),
                }}
              >
                <Heart size={14} weight="fill" color={rgb(theme.brand)} />
                <Caption tone="brand" style={{ fontWeight: '700' }}>{`${score}% Match`}</Caption>
              </View>
            ) : null}
          </View>

          <View style={{ flexDirection: 'row', gap: space(2) }}>
            <Button
              style={{ flex: 1 }}
              small
              variant="outline"
              label={saved ? 'Shortlisted' : 'Shortlist'}
              busy={shortlist.isPending}
              onPress={() => shortlist.mutate()}
            />
            <Button
              style={{ flex: 1.3 }}
              small
              label={interestLabel}
              busy={interest.isPending}
              disabled={board.isPending || (shownInteraction !== 'none' && shownInteraction !== 'interest_received')}
              onPress={() =>
                shownInteraction === 'interest_received'
                  ? router.push('/(tabs)/interests')
                  : interest.mutate()
              }
            />
            <Button
              style={{ flex: 1 }}
              small
              variant="outline"
              label="Message"
              disabled={!conversation}
              onPress={() =>
                conversation &&
                router.push({
                  pathname: '/chat/[id]',
                  params: {
                    id: conversation.withUserId,
                    name: conversation.displayName,
                    photo: conversation.photoUrl ?? '',
                    online: String(conversation.online),
                  },
                })
              }
            />
          </View>
          {!conversation && !conversations.isPending ? (
            <Caption tone="faint">Messaging opens once you both accept interest.</Caption>
          ) : null}
          {error ? <Alert tone="critical">{error}</Alert> : null}
        </Card>

        {profile.bio?.trim() ? (
          <Card>
            <SectionTitle>About Me</SectionTitle>
            <Body tone="muted">{profile.bio}</Body>
          </Card>
        ) : null}

        <Card>
          <SectionTitle>Basic Details</SectionTitle>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space(3) }}>
            <Fact icon={Cake} label="Age" value={age} />
            <Fact icon={GenderIntersex} label="Gender" value={labelFor(GENDER_LABEL, profile.gender?.toLowerCase())} />
            <Fact icon={Heart} label="Marital Status" value={labelFor(MARITAL_LABEL, d.maritalStatus)} />
            <Fact icon={Ruler} label="Height" value={d.heightCm != null ? formatHeight(d.heightCm) : null} />
            <Fact icon={MapPin} label="Location" value={profile.city} />
            <Fact icon={House} label="Hometown" value={hometown || null} />
            <Fact icon={HandsPraying} label="Religion" value={text('religion')} />
            <Fact icon={UsersThree} label="Caste" value={text('caste')} />
            <Fact icon={Translate} label="Mother Tongue" value={text('motherTongue')} />
          </View>
        </Card>

        <Card>
          <SectionTitle>Education & Career</SectionTitle>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: space(3) }}>
            <Fact icon={GraduationCap} label="Qualification" value={text('highestQualification')} />
            {text('course') ? <Fact icon={GraduationCap} label="Course" value={text('course')} /> : null}
            <Fact icon={Briefcase} label="Occupation" value={labelFor(OCCUPATION_LABEL, d.occupationStatus)} />
            {text('designation', employment) ? (
              <Fact icon={Briefcase} label="Designation" value={text('designation', employment)} />
            ) : null}
            {text('company', employment) ? (
              <Fact icon={Briefcase} label="Company" value={text('company', employment)} />
            ) : null}
            {text('businessName', business) ? (
              <Fact icon={Briefcase} label="Business" value={text('businessName', business)} />
            ) : null}
            {Array.isArray(d.otherIncome) && d.otherIncome.length > 0 ? (
              // Amounts arrive only when the profile has chosen to show income.
              <Fact
                icon={Briefcase}
                label="Other Income"
                value={(d.otherIncome as { source?: string; annualIncome?: string }[])
                  .map((row) =>
                    [
                      labelFor(OTHER_INCOME_LABEL, row.source) ?? row.source,
                      row.annualIncome ? `₹${row.annualIncome} a year` : null,
                    ]
                      .filter(Boolean)
                      .join(', '),
                  )
                  .join(' · ')}
              />
            ) : null}
          </View>
        </Card>

        <Card>
          <SectionTitle>Looking For</SectionTitle>
          {data.limited ? (
            <Caption tone="faint">Partner preferences are shared once you both accept interest.</Caption>
          ) : (
            <DetailGrid>
              <DetailRow label="Age">{range(d.preferredAgeMin, d.preferredAgeMax, 'years') ?? '—'}</DetailRow>
              <DetailRow label="Height">{d.preferredHeightMinCm != null && d.preferredHeightMaxCm != null ? `${formatHeight(d.preferredHeightMinCm)} to ${formatHeight(d.preferredHeightMaxCm)}` : '—'}</DetailRow>
              <DetailRow label="Religion">{text('religion', prefs) ?? '—'}</DetailRow>
              <DetailRow label="Caste">{text('caste', prefs) ?? '—'}</DetailRow>
              <DetailRow label="Education">{text('education', prefs) ?? '—'}</DetailRow>
              <DetailRow label="Profession">{text('profession', prefs) ?? '—'}</DetailRow>
              <DetailRow label="Location">{text('locations', prefs) ?? '—'}</DetailRow>
              <DetailRow label="NRI">{NRI_LABEL[String(prefs.nriPreference ?? '')] ?? '—'}</DetailRow>
            </DetailGrid>
          )}
        </Card>

        <Card>
          <SectionTitle>Horoscope</SectionTitle>
          <DetailGrid>
            <DetailRow label="Rashi">{text('rashi', chart) ?? '—'}</DetailRow>
            <DetailRow label="Star">{text('star', chart) ?? '—'}</DetailRow>
            <DetailRow label="Padam">{text('padam', chart) ?? '—'}</DetailRow>
            <DetailRow label="Gothram">{text('gothram', chart) ?? '—'}</DetailRow>
            <DetailRow label="Kuja dosham">{labelFor({}, chart.kujaDosham) ?? '—'}</DetailRow>
          </DetailGrid>
          <HoroscopeChart url={chartUrl} />
        </Card>

        {data.limited ? (
          <Caption tone="faint">
            Family, contact details and the rest of the biodata are shared once you both accept
            interest.
          </Caption>
        ) : (
          <>
            <Card>
              <SectionTitle>Family</SectionTitle>
              <DetailGrid>
                <DetailRow label="Father">{text('name', bag('father')) ?? '—'}</DetailRow>
                <DetailRow label="Mother">{text('name', bag('mother')) ?? '—'}</DetailRow>
                <DetailRow label="Family type">{labelFor(FAMILY_TYPE_LABEL, d.familyType) ?? '—'}</DetailRow>
              </DetailGrid>
              {data.siblings.length > 0 ? (
                <Caption tone="muted">
                  Siblings: {data.siblings.map((s) => s.name).filter(Boolean).join(', ')}
                </Caption>
              ) : null}
            </Card>

            {data.contact ? (
              <Card>
                <SectionTitle>Contact</SectionTitle>
                <DetailGrid>
                  <DetailRow label="Phone">{data.contact.phone ?? '—'}</DetailRow>
                  <DetailRow label="Email">{data.contact.email ?? '—'}</DetailRow>
                </DetailGrid>
              </Card>
            ) : null}

            {typeof bag('maritalHistory').marriageDate === 'string' ? (
              <Card>
                <SectionTitle>Marital history</SectionTitle>
                <DetailGrid>
                  <DetailRow label="Married on">
                    {formatDate(bag('maritalHistory').marriageDate as string)}
                  </DetailRow>
                </DetailGrid>
              </Card>
            ) : null}
          </>
        )}
      </Screen>

      <Sheet visible={menu} title={profile.displayName} onClose={() => setMenu(false)}>
        {profile.profileCode ? (
          <Button
            label="Share profile ID"
            variant="outline"
            onPress={() => {
              setMenu(false);
              void Share.share({ message: `${profile.displayName} on WOW — profile ${profile.profileCode}` });
            }}
          />
        ) : null}
        <Button
          label="Manage in Interests"
          variant="outline"
          onPress={() => {
            setMenu(false);
            router.push('/(tabs)/interests');
          }}
        />
      </Sheet>
    </View>
  );
}

function ProfileHeader({ title, onBack, onMore }: { title: string; onBack: () => void; onMore?: () => void }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingTop: insets.top + space(2),
        paddingBottom: space(2),
        paddingHorizontal: space(3),
        flexDirection: 'row',
        alignItems: 'center',
        gap: space(3),
        borderBottomWidth: 1,
        borderColor: rgb(theme.border),
        backgroundColor: rgb(theme.surface),
      }}
    >
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} hitSlop={8}>
        <ArrowLeft size={22} color={rgb(theme.ink[800])} />
      </Pressable>
      <Caption numberOfLines={1} style={{ flex: 1, fontSize: 17, fontWeight: '700', color: rgb(theme.ink[900]) }}>
        {title}
      </Caption>
      <WowHeaderLogo />
      {onMore ? (
        <Pressable accessibilityRole="button" accessibilityLabel="More options" onPress={onMore} hitSlop={8}>
          <DotsThreeVertical size={22} weight="bold" color={rgb(theme.ink[700])} />
        </Pressable>
      ) : null}
    </View>
  );
}

function Gallery({ photos, gender }: { photos: string[]; gender: string | null }) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const pager = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const w = width - space(8);
  const h = Math.round(w * 1.1);

  if (photos.length === 0) {
    return <ProfileSilhouette gender={gender} style={{ width: w, height: h, borderRadius: radius.md }} />;
  }

  return (
    <View style={{ gap: space(2) }}>
      <View>
        <ScrollView
          ref={pager}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / w))}
          style={{ width: w, height: h, backgroundColor: rgb(theme.surfaceSunken) }}
        >
          {photos.map((photo) => (
            <Image key={photo} source={{ uri: photo }} style={{ width: w, height: h }} contentFit="cover" transition={150} />
          ))}
        </ScrollView>
        <View
          style={{
            position: 'absolute',
            right: space(2),
            bottom: space(2),
            paddingHorizontal: space(2),
            paddingVertical: 2,
            backgroundColor: 'rgba(0,0,0,0.55)',
          }}
        >
          <Caption style={{ color: '#fff', fontWeight: '600' }}>{`${index + 1}/${photos.length}`}</Caption>
        </View>
      </View>
      {photos.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space(2) }}>
          {photos.map((photo, i) => (
            <Pressable
              key={photo}
              accessibilityRole="button"
              accessibilityLabel={`Photo ${i + 1}`}
              onPress={() => {
                setIndex(i);
                pager.current?.scrollTo({ x: i * w, animated: true });
              }}
              style={{ borderWidth: 2, borderColor: i === index ? rgb(theme.brand) : 'transparent' }}
            >
              <Image source={{ uri: photo }} style={{ width: 60, height: 60 }} contentFit="cover" />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

function Fact({ icon: Icon, label, value }: { icon: ComponentType<IconProps>; label: string; value: string | null }) {
  const theme = useTheme();
  return (
    <View style={{ width: '50%', flexDirection: 'row', gap: space(2), paddingRight: space(2) }}>
      <Icon size={18} color={rgb(theme.brand)} />
      <View style={{ flex: 1 }}>
        <Caption tone="faint" style={{ fontSize: 11 }}>{label}</Caption>
        <Body style={{ fontSize: 14 }}>{value ?? '—'}</Body>
      </View>
    </View>
  );
}

/** The chart, drawn if it can be drawn and offered to the phone if not. */
function HoroscopeChart({ url }: { url: string | null }) {
  const theme = useTheme();

  if (!url) {
    /*
     * Not the same answer as a field somebody chose to withhold. This family
     * keeps a horoscope — that is why the section is here — and has not
     * attached the chart (EZ1-I231).
     */
    return <Caption tone="faint">Chart: not uploaded</Caption>;
  }

  if (isChartImage(url)) {
    return (
      <Image
        source={{ uri: url }}
        style={{
          width: '100%',
          height: 260,
          borderRadius: radius.sm,
          backgroundColor: rgb(theme.surfaceSunken),
        }}
        contentFit="contain"
        transition={150}
      />
    );
  }

  return (
    <View style={{ gap: space(1.5) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
        <FileText size={18} color={rgb(theme.ink[400])} />
        <Body tone="muted" style={{ flex: 1 }}>
          The chart is a document.
        </Body>
      </View>
      <Button label="Open the chart" variant="outline" small onPress={() => void Linking.openURL(url)} />
    </View>
  );
}
