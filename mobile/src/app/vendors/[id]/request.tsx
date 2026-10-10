import { useEffect, useState } from 'react';
import { Pressable, Switch, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, apiMessage } from '@/lib/api';
import { hhmm, shortDate } from '@/lib/format';
import { cleanAnswers, validateAnswers, type Answers, type FieldSpec } from '@/shared/dynamic-form';
import {
  EMPTY_SCHEDULE,
  type ScheduleSelection,
  scheduleError,
  schedulePayload,
  toggleOption,
} from '@/shared/request-schedule';
import { WowCalendar } from '@/components/common/WowCalendar';
import { DynamicForm } from '@/components/dynamic-form';
import { Alert, Body, Button, Caption, Card, EmptyState, Field, Loading, Screen, SectionTitle } from '@/components/ui';
import { rgb, space, useTheme, radius } from '@/theme';

type Service = {
  id: string;
  displayName?: string | null;
  definition?: { name: string } | null;
  bookable?: boolean;
  bookingForm?: FieldSpec[];
};

type Slot = { id: string; date: string; startTime: string; endTime: string; remaining: number };
type WeddingEvent = { id: string; name: string; eventDate: string | null };

const serviceName = (s: Service) => s.displayName || s.definition?.name || 'Service';

/**
 * Check Availability & Request, as a screen of its own (row 14).
 *
 * The two ways to say when sit side by side, both visible from the start and
 * neither selected (row 13): "Pick a Date & Time" from the vendor's open slots
 * and "Request on Date" with a date and a time. Each is switched on and off on
 * its own, and only one needs filling in. A request tied to an event must be
 * for that event's day; the server refuses a mismatch with the same sentence.
 */
export default function VendorRequest() {
  const theme = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { id, eventId: eventParam } = useLocalSearchParams<{ id: string; eventId?: string }>();

  const [serviceId, setServiceId] = useState('');
  const [schedule, setSchedule] = useState<ScheduleSelection>(EMPTY_SCHEDULE);
  const [eventId, setEventId] = useState(eventParam ?? '');
  const [answers, setAnswers] = useState<Answers>({});
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});
  const [budget, setBudget] = useState('');
  const [requirements, setRequirements] = useState('');
  const [error, setError] = useState('');

  const vendor = useQuery({
    queryKey: ['vendor', id],
    queryFn: async () => (await api.get(`/vendors/${id}`)).data as { id: string; name: string; city?: string },
    enabled: Boolean(id),
    retry: false,
  });
  const services = useQuery({
    queryKey: ['vendor-services', id],
    queryFn: async () => (await api.get(`/vendors/${id}/services`)).data as Service[],
    enabled: Boolean(id),
    retry: false,
  });
  const events = useQuery({
    queryKey: ['my-events'],
    queryFn: async () => ((await api.get('/events')).data ?? []) as WeddingEvent[],
    retry: false,
  });

  const bookable = (Array.isArray(services.data) ? services.data : []).filter((s) => s.bookable !== false);
  const needsService = bookable.length > 0;
  const selectedService = bookable.find((s) => s.id === serviceId);
  // The server answers the form's event date from the slot or chosen date.
  const formFields = (selectedService?.bookingForm ?? []).filter((f) => f.key !== 'event_date');

  useEffect(() => {
    if (bookable.length === 1 && !serviceId) setServiceId(bookable[0].id);
  }, [bookable, serviceId]);

  const slots = useQuery({
    queryKey: ['bookable-slots', id, serviceId],
    queryFn: async () =>
      (
        await api.get(`/vendors/${id}/availability`, {
          params: serviceId ? { vendorServiceId: serviceId } : {},
        })
      ).data as Slot[],
    enabled: Boolean(id) && schedule.pickSlot && (!needsService || Boolean(serviceId)),
    retry: false,
  });

  const eventRows = Array.isArray(events.data) ? events.data : [];
  const selectedEvent = eventRows.find((e) => e.id === eventId) ?? null;
  const problem = scheduleError(schedule, selectedEvent);

  const request = useMutation({
    mutationFn: async () => {
      const serviceAnswers = cleanAnswers(formFields, answers);
      const response = await api.post('/bookings', {
        providerType: 'vendor',
        providerId: id,
        ...schedulePayload(schedule),
        ...(eventId ? { eventId } : {}),
        ...(serviceId ? { vendorServiceId: serviceId } : {}),
        ...(Object.keys(serviceAnswers).length ? { serviceAnswers } : {}),
        ...(budget ? { expectedBudget: Number(budget) } : {}),
        ...(requirements.trim() ? { requirements: requirements.trim() } : {}),
      });
      return response.data as { id: string };
    },
    onSuccess: async (data) => {
      for (const key of ['my-bookings', 'wedding-dashboard', 'event-workspace']) {
        await qc.invalidateQueries({ queryKey: [key] });
      }
      router.replace({ pathname: '/plan/bookings', params: { highlight: data.id } });
    },
    onError: (err) => {
      const body = (err as { response?: { status?: number; data?: Record<string, any> } }).response;
      const existingId = body?.data?.bookingId ?? body?.data?.error?.bookingId;
      if (body?.status === 409 && existingId) {
        router.replace({ pathname: '/plan/bookings', params: { highlight: existingId } });
        return;
      }
      setError(apiMessage(err, 'That request could not be sent.'));
    },
  });

  const submit = () => {
    setError('');
    if (problem) {
      setError(problem);
      return;
    }
    const found = validateAnswers(formFields, answers);
    setAnswerErrors(found);
    if (Object.keys(found).length === 0) request.mutate();
  };

  if (vendor.isPending) {
    return (
      <Screen>
        <Loading rows={4} />
      </Screen>
    );
  }
  if (vendor.error || !vendor.data) {
    return (
      <Screen>
        <EmptyState title="Vendor unavailable">
          {apiMessage(vendor.error, 'This listing may no longer be available.')}
        </EmptyState>
      </Screen>
    );
  }

  const chip = (active: boolean) => ({
    paddingHorizontal: space(3),
    paddingVertical: space(1.5),
    borderRadius: radius.md,
    backgroundColor: active ? rgb(theme.brand) : rgb(theme.surfaceSunken),
  });
  const chipText = (active: boolean) => ({ color: active ? rgb(theme.brandFg) : rgb(theme.ink[700]) });

  return (
    <Screen>
      <View style={{ gap: space(3) }}>
        <View>
          <Caption tone="muted">Check availability &amp; request</Caption>
          <SectionTitle>{vendor.data.name}</SectionTitle>
        </View>
        {error ? <Alert tone="critical">{error}</Alert> : null}

        {needsService ? (
          <Card style={{ gap: space(2) }}>
            <Body style={{ fontWeight: '600' }}>Service</Body>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
              {bookable.map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => {
                    setServiceId(s.id);
                    setSchedule((current) => ({ ...current, slotId: '', slotDate: null }));
                    setAnswers({});
                    setAnswerErrors({});
                  }}
                  style={chip(serviceId === s.id)}
                >
                  <Caption style={chipText(serviceId === s.id)}>{serviceName(s)}</Caption>
                </Pressable>
              ))}
            </View>
          </Card>
        ) : null}

        <Card style={{ gap: space(2) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Body style={{ fontWeight: '600' }}>Pick a Date &amp; Time</Body>
            <Switch
              accessibilityLabel="Pick a Date & Time"
              value={schedule.pickSlot}
              onValueChange={() => setSchedule((s) => toggleOption(s, 'pickSlot'))}
            />
          </View>
          <Caption tone="muted">One of the slots the vendor has published.</Caption>
          {schedule.pickSlot ? (
            needsService && !serviceId ? (
              <Caption tone="muted">Pick a service above to see the slots they have open.</Caption>
            ) : slots.isFetching ? (
              <Loading rows={1} />
            ) : (slots.data ?? []).length === 0 ? (
              <Caption tone="muted">No open slots are published. Use Request on Date instead.</Caption>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
                {(slots.data ?? []).map((slot) => {
                  const active = schedule.slotId === slot.id;
                  return (
                    <Pressable
                      key={slot.id}
                      accessibilityState={{ selected: active }}
                      onPress={() =>
                        setSchedule((s) =>
                          active ? { ...s, slotId: '', slotDate: null } : { ...s, slotId: slot.id, slotDate: slot.date },
                        )
                      }
                      style={chip(active)}
                    >
                      <Caption style={chipText(active)}>
                        {shortDate(slot.date)} · {hhmm(slot.startTime)}–{hhmm(slot.endTime)} · {slot.remaining} left
                      </Caption>
                    </Pressable>
                  );
                })}
              </View>
            )
          ) : null}
        </Card>

        <Card style={{ gap: space(2) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Body style={{ fontWeight: '600' }}>Request on Date</Body>
            <Switch
              accessibilityLabel="Request on Date"
              value={schedule.requestDate}
              onValueChange={() => setSchedule((s) => toggleOption(s, 'requestDate'))}
            />
          </View>
          <Caption tone="muted">A date and time they have not published. The vendor confirms it before you pay.</Caption>
          {schedule.requestDate ? (
            <>
              <WowCalendar
                label="Date"
                value={schedule.date}
                onChange={(date) => setSchedule((s) => ({ ...s, date }))}
                minimumDate={new Date().toISOString().slice(0, 10)}
              />
              <Field
                label="Time (HH:MM, 24-hour)"
                value={schedule.time}
                onChangeText={(time) => setSchedule((s) => ({ ...s, time }))}
                placeholder="18:30"
                maxLength={5}
              />
            </>
          ) : null}
        </Card>

        {problem && (schedule.pickSlot || schedule.requestDate) ? (
          <Caption style={{ color: rgb(theme.cautionFg) }}>{problem}</Caption>
        ) : null}

        {eventRows.length > 0 ? (
          <Card style={{ gap: space(2) }}>
            <Body style={{ fontWeight: '600' }}>Which event is this for?</Body>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
              <Pressable onPress={() => setEventId('')} style={chip(!eventId)}>
                <Caption style={chipText(!eventId)}>Not tied to one event</Caption>
              </Pressable>
              {eventRows.map((ev) => (
                <Pressable key={ev.id} onPress={() => setEventId(ev.id)} style={chip(eventId === ev.id)}>
                  <Caption style={chipText(eventId === ev.id)}>
                    {ev.name}
                    {ev.eventDate ? ` · ${shortDate(ev.eventDate)}` : ''}
                  </Caption>
                </Pressable>
              ))}
            </View>
          </Card>
        ) : null}

        <DynamicForm
          fields={formFields}
          answers={answers}
          errors={answerErrors}
          onChange={(key, value) => setAnswers((current) => ({ ...current, [key]: value }))}
        />
        <Field label="Budget (optional)" value={budget} onChangeText={setBudget} keyboardType="number-pad" />
        <Field
          label="What do you need?"
          value={requirements}
          onChangeText={setRequirements}
          placeholder="Tell them briefly what you need"
          multiline
        />
        <Button
          label="Send request"
          busy={request.isPending}
          disabled={request.isPending || Boolean(problem) || (needsService && !serviceId)}
          onPress={submit}
        />
        <Button label="Back to vendor" variant="outline" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
