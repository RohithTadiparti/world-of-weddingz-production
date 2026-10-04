import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, apiMessage } from '../lib/api';
import { CategoryNames } from './CategoryPicker';
import DynamicForm, { Answers, FieldSpec, cleanAnswers, validateAnswers } from './DynamicForm';
import { offeringPrice, requestFormFields, requirementsRequired } from '../lib/booking-request';
import { Offering, OfferingPicker, ReferencePhotos, takesQuantity, totalLabel } from './BookingRequestParts';
import SlotPicker, { Slot } from './SlotPicker';

/** The vendor being asked, as much of it as the request needs. */
interface RequestVendor {
  id: string;
  name: string;
  category: string | null;
  categories?: string[];
  city?: string;
}

interface WeddingEvent {
  id: string;
  name: string;
  eventDate: string | null;
}

interface VendorServiceSummary {
  id: string;
  displayName: string | null;
  bookable: boolean;
  definition: { name: string } | null;
}

interface BookingContext {
  bookingForm: FieldSpec[];
  offerings: Offering[];
  /** Whether "What do you need?" must be answered, as the server will check it. */
  requirementsRequired?: boolean;
}

/**
 * The booking request form, opened from the vendor directory.
 *
 * Moved out of pages/Vendors.tsx, which it had grown larger than.
 */
export default function RequestDialog({
  vendor,
  initialDate,
  onClose,
}: {
  vendor: RequestVendor;
  /** A date already checked on the detail page, retained when the request opens. */
  initialDate?: string;
  onClose: () => void;
}) {
  const nav = useNavigate();
  // Arriving from an event carries it in. An organiser who pressed "book
  // someone for this day" has already told the app which day, and asking again
  // in a dropdown is asking them to repeat themselves.
  const [params] = useSearchParams();
  const [slotId, setSlotId] = useState('');
  // A request without a published window (EZ1-I179): the vendor may have nothing
  // open, or none of the open windows suit, so the buyer names a date and the
  // vendor confirms. Prefilled from the detail page's date check when it arrives.
  const [eventDate, setEventDate] = useState(initialDate ?? params.get('date') ?? '');
  const [eventId, setEventId] = useState(params.get('eventId') ?? '');
  const [serviceId, setServiceId] = useState('');
  const [offeringId, setOfferingId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [answers, setAnswers] = useState<Answers>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [requirements, setRequirements] = useState('');
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [budget, setBudget] = useState('');
  const [error, setError] = useState('');
  const [existing, setExisting] = useState('');
  // The note beside the "open it" link — the partner-already-booked case says
  // something different from an ordinary duplicate (EZ1-I160).
  const [existingNote, setExistingNote] = useState('');
  const [busy, setBusy] = useState(false);
  /*
   * Whose wedding this request is for.
   *
   * Empty for a couple booking for themselves, which is every ordinary caller
   * and the reason the picker below only appears for a planner: `/events/engaged`
   * answers with the weddings this account was engaged on, and a couple is
   * engaged on none (EZ1-I235).
   */
  const [forClient, setForClient] = useState('');
  const { data: engagedClients = [] } = useQuery({
    queryKey: ['engaged-hosts'],
    queryFn: async () =>
      (await api.get('/events/engaged')).data as { userId: string; name: string }[],
    retry: false,
  });

  // What this business sells, from the catalog. A vendor who has not adopted
  // it has none, and the request falls back to the free-text form below.
  const { data: services = [], isLoading: servicesLoading } = useQuery<VendorServiceSummary[]>({
    queryKey: ['vendor-public-services', vendor.id],
    queryFn: async () => (await api.get(`/vendors/${vendor.id}/services`)).data,
    retry: false,
  });

  const bookable = services.filter((s) => s.bookable);

  // Service before availability (EZ1-I197): where the vendor has bookable
  // services, the buyer must pick one before any dates are shown — the slots
  // are that service's, and a calendar chosen before the service is a calendar
  // for the wrong thing. A vendor with no catalog has nothing to pick, so the
  // window (or the slotless date, EZ1-I179) opens straight away as before.
  const needsService = bookable.length > 0;
  const showAvailability = needsService ? Boolean(serviceId) : !servicesLoading;

  // Availability is service-specific (EZ1-I28/I32): once a service is chosen the
  // time slots are only that service's (plus any general, service-less slots),
  // so a slot published for Transport is not offered when booking Makeup. Not
  // fetched until a service is chosen where the catalog offers one (EZ1-I197).
  const { data: slots = [], isLoading } = useQuery<Slot[]>({
    queryKey: ['bookable-slots', vendor.id, serviceId],
    enabled: showAvailability,
    queryFn: async () =>
      (
        await api.get(`/vendors/${vendor.id}/availability`, {
          params: serviceId ? { vendorServiceId: serviceId } : {},
        })
      ).data,
  });

  // The questions this service asks, generated from the same rows the server
  // validates the answers against.
  const { data: context } = useQuery<BookingContext>({
    queryKey: ['service-booking-form', serviceId],
    queryFn: async () => (await api.get(`/services/${serviceId}/booking-form`)).data,
    enabled: Boolean(serviceId),
    retry: false,
  });

  // "Date of the function" is answered by the date picked below, not asked
  // again: the server fills it in from the slot or the requested date.
  const fields = requestFormFields(context?.bookingForm ?? []);
  const offerings = context?.offerings ?? [];
  const offering = offerings.find((o) => o.id === offeringId);
  const countsQuantity = takesQuantity(offering);
  // Only venue, catering and florist need the brief; the server says which
  // this service is, and a vendor with no catalog goes by its own categories.
  const briefRequired =
    context?.requirementsRequired ??
    requirementsRequired(vendor.categories?.length ? vendor.categories : [vendor.category], fields.length > 0);
  const selectedService = bookable.find((s) => s.id === serviceId);

  // Bookings can be tied to one event — the mehendi's makeup artist is not the
  // reception's. Absent for anyone who has not set their events up yet.
  const { data: events = [] } = useQuery<WeddingEvent[]>({
    queryKey: ['my-events'],
    queryFn: async () => (await api.get('/events')).data ?? [],
    retry: false,
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setExisting('');
    setExistingNote('');

    // Checked here so a long form does not have to be sent to find out about a
    // missing guest count. The server checks all of it again regardless.
    const found = validateAnswers(fields, answers);
    setFieldErrors(found);
    if (Object.keys(found).length > 0) {
      setError('Some answers need attention.');
      return;
    }

    // A planner has to say whose wedding this is. Sending it as their own would
    // put a couple's booking on the planner's account (EZ1-I235).
    if (engagedClients.length > 0 && !forClient) {
      setError('Choose which wedding this request is for.');
      return;
    }

    setBusy(true);
    try {
      const { data } = await api.post('/bookings', {
        providerType: 'vendor',
        providerId: vendor.id,
        ...(slotId ? { slotId } : {}),
        // No published window: carry the date the buyer asked for so the vendor
        // knows which day to confirm. The server derives it from the slot when
        // one is chosen, so the two are never sent together.
        ...(!slotId && eventDate ? { eventDate } : {}),
        ...(requirements.trim() ? { requirements } : {}),
        ...(serviceId ? { vendorServiceId: serviceId } : {}),
        ...(offeringId ? { offeringId } : {}),
        ...(countsQuantity && quantity ? { quantity: Number(quantity) } : {}),
        ...(referenceImages.length > 0 ? { referenceImages } : {}),
        ...(fields.length > 0 ? { serviceAnswers: cleanAnswers(fields, answers) } : {}),
        ...(eventId ? { eventId } : {}),
        ...(budget ? { expectedBudget: Number(budget) } : {}),
        // Only ever sent by a planner naming an engaged couple; the server
        // refuses it from anybody else and refuses a wedding they do not run.
        ...(forClient ? { forClientUserId: forClient } : {}),
      });
      // A planner who raised this for a client cannot see it on /bookings --
      // they hold no BOOKING_READ_OWN, so that page renders their own incoming
      // work instead. The client's page carries it, under Vendors and services.
      nav(forClient ? `/my-clients/${forClient}#vendors` : `/bookings?highlight=${data.id}`);
    } catch (err) {
      const body = (err as { response?: { data?: { error?: { code?: string; bookingId?: string } } } })
        .response?.data?.error;
      if (body?.code === 'DUPLICATE_BOOKING_REQUEST' && body.bookingId) {
        setExisting(body.bookingId);
      } else if (body?.code === 'PARTNER_ALREADY_BOOKED' && body.bookingId) {
        // The couple share one wedding: the partner already holds this booking,
        // and it shows up in this account's shared Bookings list (EZ1-I160).
        setExisting(body.bookingId);
        setExistingNote('Your partner has already booked this service.');
      } else {
        setError(apiMessage(err, 'That request could not be sent.'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-surface p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="section-title">{vendor.name}</h2>
            <p className="text-sm text-gray-600">
              <CategoryNames slugs={vendor.categories?.length ? vendor.categories : [vendor.category]} />
              {vendor.city ? ` · ${vendor.city}` : ''}
            </p>
          </div>
          <button className="text-2xl leading-none text-gray-400" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {error && <p className="mb-3 alert-critical">{error}</p>}
        {existing && (
          <div className="mb-3 alert-caution">
            {existingNote || 'You have already asked this vendor for that window.'}{' '}
            <button className="underline" onClick={() => nav(`/bookings?highlight=${existing}`)}>
              {existingNote ? 'Open the booking' : 'Open the request you already have'}
            </button>
            .
          </div>
        )}

          <form onSubmit={submit} className="space-y-4">
            {bookable.length > 0 && (
              <label className="block text-sm">
                <span className="text-gray-700">Which service?</span>
                <select
                  className="input mt-1"
                  value={serviceId}
                  onChange={(e) => {
                    setServiceId(e.target.value);
                    setOfferingId('');
                    setQuantity('');
                    setAnswers({});
                    setFieldErrors({});
                    // The slots belong to the previous service; clear the pick so
                    // a stale slot cannot be submitted against the new service.
                    setSlotId('');
                  }}
                  required
                >
                  <option value="">Choose…</option>
                  {bookable.map((sv) => (
                    <option key={sv.id} value={sv.id}>
                      {sv.displayName ?? sv.definition?.name ?? 'Service'}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {offerings.length > 0 && (
              <OfferingPicker
                offerings={offerings}
                offeringId={offeringId}
                quantity={quantity}
                onPick={(id) => {
                  setOfferingId(id);
                  // A quantity belongs to one particular price. Leaving it in
                  // state when the price changes (or is cleared) could submit
                  // a stale count with a quote-only request.
                  setQuantity('');
                }}
                onQuantity={setQuantity}
              />
            )}

            {/* Service before availability (EZ1-I197): the dates only appear once
                the buyer has chosen what they are booking. The summary restates
                the service and its price above the calendar, and each window
                carries its own time (its duration) and, where the vendor runs
                several at once, how many places are left. Windows that are full
                or blocked never reach here — listBookable returns only the free
                ones — so every date shown is one the buyer can actually take. */}
            {showAvailability ? (
              <SlotPicker
                slots={slots}
                isLoading={isLoading}
                slotId={slotId}
                eventDate={eventDate}
                onSlot={(id) => {
                  setSlotId(id);
                  setEventDate('');
                }}
                onDate={setEventDate}
                summary={
                  selectedService && (
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 rounded-sm bg-surface-sunken px-3 py-2">
                      <span className="text-sm font-medium text-gray-900">
                        {selectedService.displayName ?? selectedService.definition?.name ?? 'Service'}
                      </span>
                      {offering && (
                        <span className="text-sm text-gray-700">
                          {totalLabel(offering, quantity) ?? offeringPrice(offering)}
                        </span>
                      )}
                    </div>
                  )
                }
              />
            ) : (
              needsService && (
                <p className="rounded-sm bg-surface-sunken px-3 py-2 text-sm text-gray-500">
                  Pick a service above to see the dates and times they are free.
                </p>
              )
            )}

            {/*
              The questions below are generated from the service the buyer
              picked, not written into this page. That is what replaces a
              hand-written request form per vendor type.
            */}
            {fields.length > 0 && (
              <div className="space-y-2">
                <p className="label">What they need to know</p>
                <DynamicForm
                  fields={fields}
                  answers={answers}
                  errors={fieldErrors}
                  onChange={(k, v) => setAnswers((a) => ({ ...a, [k]: v }))}
                />
              </div>
            )}

            {events.length > 0 && (
              <label className="block text-sm">
                <span className="text-gray-700">Which event is this for?</span>
                <select
                  className="input mt-1"
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
                >
                  <option value="">Not tied to one event</option>
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.name}
                      {ev.eventDate ? `: ${ev.eventDate}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="block text-sm">
              <span className="text-gray-700">
                {fields.length > 0 ? 'Anything else they should know?' : 'What do you need?'}
                {briefRequired ? ' *' : ''}
              </span>
              <textarea
                className="input mt-1"
                rows={fields.length > 0 ? 2 : 4}
                // The server asks for a sentence whenever anything is sent; an
                // empty box is not sent at all, so this only bites when typed in.
                minLength={10}
                required={briefRequired}
                placeholder="450 guests, vegetarian, service from 7pm, two live counters."
                value={requirements}
                onChange={(e) => setRequirements(e.target.value)}
              />
              <span className="mt-1 block text-xs text-gray-500">
                {fields.length > 0
                  ? 'Optional. The questions above cover the usual ground.'
                  : `${briefRequired ? '' : 'Optional. '}The more specific this is, the closer their quote will be to the final price.`}
              </span>
            </label>

            <ReferencePhotos urls={referenceImages} onChange={setReferenceImages} />

            <label className="block text-sm">
              <span className="text-gray-700">Budget you have in mind</span>
              <input
                className="input mt-1 max-w-[12rem]"
                type="number"
                min={0}
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
              <span className="mt-1 block text-xs text-gray-500">
                Optional. Leave it blank if you would rather hear their number first.
              </span>
            </label>

            {/*
              Whose wedding, asked only of somebody running one.

              A couple never sees this: /events/engaged answers empty for them.
              A planner must choose, because the booking is the couple's and
              guessing would put it on the wrong account (EZ1-I235).
            */}
            {engagedClients.length > 0 && (
              <label className="block text-sm">
                <span className="text-gray-700">Requesting for</span>
                <select
                  className="input mt-1"
                  value={forClient}
                  onChange={(e) => setForClient(e.target.value)}
                >
                  <option value="">Choose the wedding…</option>
                  {engagedClients.map((c) => (
                    <option key={c.userId} value={c.userId}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-gray-500">
                  The booking belongs to them and is paid by them. You are recorded as having
                  placed it.
                </span>
              </label>
            )}

            <div className="flex gap-2">
              <button
                className="btn"
                disabled={
                  (!slotId && !eventDate) ||
                  busy ||
                  (engagedClients.length > 0 && !forClient) ||
                  (bookable.length > 0 && !serviceId)
                }
              >
                {busy ? 'Sending…' : 'Send request'}
              </button>
              <button type="button" className="btn-outline" onClick={onClose}>
                Cancel
              </button>
            </div>
          </form>
      </div>
    </div>
  );
}
