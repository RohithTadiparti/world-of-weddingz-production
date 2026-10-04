import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CaretDown, CaretUp, Star } from 'phosphor-react-native';

import { api, apiMessage } from '@/lib/api';
import { dateTime, humanise } from '@/lib/format';
import { STATUS_TONE, type SupportCase } from '@/lib/verification';
import { CASE_STATUS_LABEL, isProvider } from '@/shared/permissions';
import { Badge } from '@/components/chrome';
import { SelectField, Textarea } from '@/components/form';
import {
  Alert,
  Body,
  Button,
  Caption,
  Card,
  Field,
  Loading,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { useAuth } from '@/store/auth';
import { rgb, space, useTheme } from '@/theme';

type SupportType = 'help' | 'contact' | 'feedback';

const TITLES: Record<SupportType, string> = {
  help: 'Help Center',
  contact: 'Contact Support',
  feedback: 'Share Feedback',
};

const FAQS: { q: string; a: string }[] = [
  {
    q: 'How do I complete my profile?',
    a: 'Open More → Edit Profile for your name, age and location. Add biodata, photographs and partner preferences from My Profile. Completion is calculated on the server from what is stored.',
  },
  {
    q: 'How do I find matches?',
    a: 'Open Find Matches from More, or the Matches tab. Save people to Shortlisted, and send an interest when a profile looks right.',
  },
  {
    q: 'When can I message someone?',
    a: 'Chat opens after both families accept an interest. Until then, send an interest from the profile.',
  },
  {
    q: 'How does verification work?',
    a: 'Record a government ID from Verification, or confirm Aadhaar with the code sent to the registered mobile. An officer may also confirm the document in person.',
  },
  {
    q: 'How do I plan wedding events?',
    a: 'Open Wedding Planning from More to add ceremony days, venues and times. Those events are what bookings hang off.',
  },
  {
    q: 'How do I get help with a problem?',
    a: 'Use Contact Support for something that has gone wrong. Use Share Feedback for a rating or a suggestion.',
  },
];

type Audience = 'provider' | 'seeker';

const SUBJECTS: { value: string; label: string; note?: string; audience?: Audience[] }[] = [
  { value: 'booking', label: 'A booking', note: 'Money held on it is frozen until this is settled' },
  { value: 'payment', label: 'A payment or payout' },
  { value: 'vendor', label: 'My business listing', audience: ['provider'] },
  { value: 'availability', label: 'Availability', audience: ['provider'] },
  { value: 'profile', label: 'A profile', audience: ['seeker'] },
  { value: 'match', label: 'A match', audience: ['seeker'] },
  { value: 'account', label: 'My account' },
  { value: 'other', label: 'Something else' },
];

function subjectsFor(role?: string) {
  const provider = isProvider(role);
  const seeker = role === 'bride' || role === 'groom' || role === 'family' || role === 'agent';
  return SUBJECTS.filter((subject) => {
    if (!subject.audience) return true;
    if (provider) return subject.audience.includes('provider');
    if (seeker) return subject.audience.includes('seeker');
    return true;
  });
}

export default function Support() {
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ type?: string }>();
  const type: SupportType =
    params.type === 'help' || params.type === 'feedback' ? params.type : 'contact';

  useEffect(() => {
    navigation.setOptions({ title: TITLES[type] });
  }, [navigation, type]);

  if (type === 'help') return <HelpCenter />;
  if (type === 'feedback') return <ShareFeedback />;
  return <ContactSupport />;
}

function HelpCenter() {
  const [open, setOpen] = useState<string | null>(FAQS[0]?.q ?? null);

  return (
    <Screen>
      {FAQS.map((item) => (
        <Faq key={item.q} item={item} open={open === item.q} onToggle={() => setOpen((current) => (current === item.q ? null : item.q))} />
      ))}
    </Screen>
  );
}

function Faq({
  item,
  open,
  onToggle,
}: {
  item: { q: string; a: string };
  open: boolean;
  onToggle: () => void;
}) {
  const theme = useTheme();
  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space(2) }}
      >
        <SectionTitle style={{ flex: 1 }}>{item.q}</SectionTitle>
        {open ? (
          <CaretUp size={16} color={rgb(theme.ink[400])} />
        ) : (
          <CaretDown size={16} color={rgb(theme.ink[400])} />
        )}
      </Pressable>
      {open ? <Body tone="muted">{item.a}</Body> : null}
    </Card>
  );
}

function ContactSupport() {
  const role = useAuth((s) => s.user?.role);
  return (
    <Screen>
      <RaiseCase subjects={subjectsFor(role)} submitLabel="Send Message" doneMessage="Sent. Somebody will read it." />
      <MyCases />
    </Screen>
  );
}

/** What this person has raised, which is where a case notification brings them. */
function MyCases() {
  const router = useRouter();
  const cases = useQuery({
    queryKey: ['support-cases'],
    queryFn: async () => {
      const data = (await api.get('/verification/cases')).data as SupportCase[] | { data: SupportCase[] };
      return Array.isArray(data) ? data : data.data;
    },
    retry: false,
  });

  if (cases.isPending) return <Loading rows={2} />;
  if (cases.error) return <Alert tone="critical">{apiMessage(cases.error, 'Your requests could not be loaded.')}</Alert>;
  if (!cases.data?.length) return null;

  return (
    <View style={{ gap: space(2) }}>
      <SectionTitle>Your requests</SectionTitle>
      {cases.data.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/case/[id]', params: { id: item.id } })}
        >
          <Card style={{ gap: space(1) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(2) }}>
              <Body style={{ flex: 1, fontWeight: '600' }} numberOfLines={1}>
                {item.title}
              </Body>
              <Badge tone={STATUS_TONE[item.status] ?? 'neutral'}>
                {CASE_STATUS_LABEL[item.status] ?? humanise(item.status)}
              </Badge>
            </View>
            <Caption tone="muted">{`Raised ${dateTime(item.createdAt)}`}</Caption>
          </Card>
        </Pressable>
      ))}
    </View>
  );
}

function ShareFeedback() {
  const theme = useTheme();
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const qc = useQueryClient();

  const send = useMutation({
    mutationFn: async () => {
      await api.post('/verification/cases', {
        subjectType: 'other',
        title: `App feedback (${rating}/5)`,
        description: message.trim(),
      });
    },
    onSuccess: () => {
      setMessage('');
      setRating(0);
      setError('');
      setNotice('Thank you. Your feedback has been sent.');
      void qc.invalidateQueries({ queryKey: ['support-cases'] });
    },
    onError: (err) => setError(apiMessage(err, 'Feedback could not be sent.')),
  });

  return (
    <Screen>
      {notice ? <Alert tone="positive">{notice}</Alert> : null}
      {error ? <Alert tone="critical">{error}</Alert> : null}
      <Card>
        <SectionTitle>How would you rate your experience?</SectionTitle>
        <View style={{ flexDirection: 'row', gap: space(1), marginTop: space(1) }}>
          {[1, 2, 3, 4, 5].map((star) => (
            <Pressable
              key={star}
              accessibilityRole="button"
              accessibilityLabel={`${star} star${star === 1 ? '' : 's'}`}
              onPress={() => setRating(star)}
              hitSlop={6}
            >
              <Star
                size={28}
                weight={star <= rating ? 'fill' : 'regular'}
                color={rgb(star <= rating ? theme.cautionFg : theme.ink[300])}
              />
            </Pressable>
          ))}
        </View>
        <Textarea
          label="Your Feedback"
          value={message}
          onChange={setMessage}
          rows={5}
          maxLength={500}
          placeholder="Tell us what you think…"
          hint="At least 10 characters."
        />
        <Caption tone="faint">{message.length}/500</Caption>
        <Button
          label="Submit Feedback"
          busy={send.isPending}
          disabled={rating < 1 || message.trim().length < 10}
          onPress={() => send.mutate()}
        />
      </Card>
    </Screen>
  );
}

function RaiseCase({
  subjects,
  submitLabel,
  doneMessage,
}: {
  subjects: { value: string; label: string; note?: string }[];
  submitLabel: string;
  doneMessage: string;
}) {
  const [subjectType, setSubjectType] = useState('other');
  const [subjectId, setSubjectId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const needsSubject = subjectType === 'booking' || subjectType === 'payment';
  const qc = useQueryClient();

  const raise = useMutation({
    mutationFn: async () => {
      await api.post('/verification/cases', {
        subjectType,
        subjectId: subjectId.trim() || undefined,
        title: title.trim(),
        description: description.trim(),
      });
    },
    onSuccess: () => {
      setTitle('');
      setDescription('');
      setSubjectId('');
      setError('');
      setNotice(doneMessage);
      void qc.invalidateQueries({ queryKey: ['support-cases'] });
    },
    onError: (err) => {
      setNotice('');
      setError(apiMessage(err, 'That could not be sent.'));
    },
  });

  return (
    <>
      {notice ? <Alert tone="positive">{notice}</Alert> : null}
      {error ? <Alert tone="critical">{error}</Alert> : null}
      <Card>
        <SelectField
          label="Subject"
          value={subjectType}
          options={subjects}
          onChange={(value) => {
            setSubjectType(value);
            setSubjectId('');
          }}
        />
        {needsSubject ? (
          <Field
            label={subjectType === 'booking' ? 'Booking reference' : 'Payment reference'}
            value={subjectId}
            onChangeText={setSubjectId}
            autoCapitalize="none"
            autoCorrect={false}
            hint="Any money held on it is frozen until this is settled."
          />
        ) : null}
        <Field
          label="In one line"
          value={title}
          onChangeText={setTitle}
          placeholder="What has gone wrong"
        />
        <Textarea
          label="Message"
          value={description}
          onChange={setDescription}
          rows={5}
          placeholder="Describe your issue"
        />
        <Button
          label={submitLabel}
          busy={raise.isPending}
          disabled={title.trim().length < 5 || description.trim().length < 10}
          onPress={() => raise.mutate()}
        />
      </Card>
    </>
  );
}
