import { useEffect, useState } from 'react';
import { Alert as NativeAlert, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { CalendarBlank, MapPin, UsersThree } from 'phosphor-react-native';

import { api } from '@/lib/api';
import {
  PAYMENT_LABEL,
  PAYMENT_TONE,
  QUOTATION_STAGE_LABEL,
  QUOTATION_STAGE_TONE,
  SELLER_STATUS_LABEL,
  isRequestOnDate,
  nextActionFor,
  type IncomingBooking,
} from '@/lib/bookings';
import { money, shortDate } from '@/lib/format';
import { Badge, DetailGrid, DetailRow, Divider } from '@/components/chrome';
import { BookingDetail } from '@/components/bookings/detail';
import { BookingChat } from '@/components/bookings/chat';
import { RequestedServices } from '@/components/bookings/requested-services';
import { QuotationForm } from '@/components/bookings/quotation';
import { RaiseIssueForm } from '@/components/bookings/raise-issue';
import { isRequoteRequested, pricingModelLabel, sellerActions } from '@/shared/booking-rules';
import { PromptSheet } from '@/components/prompt';
import { Body, Button, Caption, Card } from '@/components/ui';
import { radius, rgb, space, useTheme } from '@/theme';

/**
 * One job in the provider's queue.
 *
 * Everything the decision is actually made on is on the card: who it is for,
 * where, how many people, which service, what the customer had in mind, and
 * whether any money has moved. On the web all of that arrived at once because
 * answering a request used to mean opening the wedding, the client and the
 * quotation on separate screens.
 *
 * The one thing held back is the detail behind the fold — the client's answers,
 * their add-ons, the message thread. A phone card that opened all of it would
 * be a screen, and a queue of them would be forty nested queries deep before
 * the first row was readable.
 */
export function BookingCard({
  booking,
  canQuote,
  onAct,
  acting,
  onQuoted,
  openByDefault = false,
}: {
  booking: IncomingBooking;
  canQuote: boolean;
  onAct: (id: string, path: string, body?: Record<string, unknown>) => void;
  acting: boolean;
  onQuoted: () => void;
  /**
   * Opened on arrival, for a card something else asked for by name — a
   * notification about this booking, or a row on the dashboard. Somebody who
   * tapped one booking is not then made to tap Show detail on it.
   */
  openByDefault?: boolean;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(openByDefault);
  const [quoting, setQuoting] = useState(false);
  const [deliveryPrompt, setDeliveryPrompt] = useState(false);
  const [raising, setRaising] = useState(false);

  // The list recycles its rows, so a card that was already mounted when the
  // request to open it arrived would keep its own collapsed state.
  useEffect(() => {
    if (openByDefault) setExpanded(true);
  }, [openByDefault]);

  // What the provider may do now (rows 17 and 20), from the shared rules.
  const actions = sellerActions(booking, { canQuote });
  const requote = isRequoteRequested(booking);
  const onDate = isRequestOnDate(booking);
  const paid = Number(booking.paidAmount ?? 0);
  const remaining = Math.max(0, Number(booking.amount ?? 0) - paid);
  const nextAction = nextActionFor(booking);

  return (
    <Card>
      <View style={{ flexDirection: 'row', gap: space(2.5) }}>
        {/* The client's photo, so the provider recognises who they are dealing
            with without opening the profile. */}
        {booking.clientPhoto ? (
          <Image
            source={{ uri: booking.clientPhoto }}
            style={{
              width: 40,
              height: 40,
              borderRadius: radius.md,
              backgroundColor: rgb(theme.surfaceSunken),
            }}
            contentFit="cover"
          />
        ) : null}
        <View style={{ flex: 1, gap: space(0.5) }}>
          {/* The real customer name; "Customer" only when the record genuinely
              has no name, never "A client". */}
          <Body numberOfLines={2}>
            {booking.clientName ?? 'Customer'}
            {booking.serviceName ? ` · ${booking.serviceName}` : ''}
            {pricingModelLabel(booking.pricingModel) ? ` (${pricingModelLabel(booking.pricingModel)})` : ''}
            {booking.offeringName ? ` · ${booking.offeringName}` : ''}
          </Body>
          <Caption tone="faint">
            Asked {shortDate(booking.createdAt)} · {booking.id.slice(0, 8)}
          </Caption>
          {/* Where the customer is. Their phone and email are not shown to a
              vendor (WOW-06); Messages opens once the advance is paid. */}
          {booking.clientCity || booking.eventCity ? (
            <Caption tone="faint">{booking.clientCity ?? booking.eventCity}</Caption>
          ) : null}
        </View>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(1.5) }}>
        <Badge>{SELLER_STATUS_LABEL[booking.status] ?? booking.status.replace(/_/g, ' ')}</Badge>
        {/* Marked on the row as well as gathered under its own tab, so it reads
            as one wherever the provider comes across it. */}
        {onDate ? <Badge tone="caution">Request on date</Badge> : null}
        {booking.status === 'confirmed' && booking.collectedMilestones?.includes('advance') ? (
          <Badge tone="positive">Advance received</Badge>
        ) : null}
        {/* A declined, withdrawn or revised offer is not a new request, and the
            card says so (EZ1-I264). */}
        {requote ? <Badge tone="critical">Quotation rejected - requote requested</Badge> : null}
        {booking.quotation && !requote && ['requested', 'quotation_sent'].includes(booking.status) ? (
          <Badge tone={QUOTATION_STAGE_TONE[booking.quotation.stage]}>
            {QUOTATION_STAGE_LABEL[booking.quotation.stage]}
          </Badge>
        ) : null}
        {booking.paymentStatus ? (
          <Badge tone={PAYMENT_TONE[booking.paymentStatus] ?? 'neutral'}>
            {PAYMENT_LABEL[booking.paymentStatus] ?? booking.paymentStatus.replace(/_/g, ' ')}
          </Badge>
        ) : null}
      </View>

      {/* The facts, as chips rather than a table: a phone has no room for a
          definition list and these read fine as a sentence of icons. */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(3) }}>
        {booking.eventDate ? (
          <Fact icon={<CalendarBlank size={14} color={rgb(theme.ink[400])} />}>
            {`${shortDate(booking.eventDate)}${booking.requestedTime ? ` · ${booking.requestedTime}` : ''}`}
          </Fact>
        ) : null}
        {booking.eventVenue || booking.eventCity ? (
          <Fact icon={<MapPin size={14} color={rgb(theme.ink[400])} />}>
            {[booking.eventVenue, booking.eventCity].filter(Boolean).join(', ')}
          </Fact>
        ) : null}
        {booking.expectedGuests ? (
          <Fact icon={<UsersThree size={14} color={rgb(theme.ink[400])} />}>
            {`${booking.expectedGuests} guests`}
          </Fact>
        ) : null}
      </View>

      <DetailGrid>
        <View style={{ flexDirection: 'row', gap: space(4) }}>
          {/* The agreed total once there is one; until then the latest offer,
              rather than an amount of 0 that reads as free (EZ1-I264). */}
          {Number(booking.amount) > 0 ? (
            <View style={{ flex: 1 }}>
              <DetailRow label="Total">{money(booking.amount, booking.currency)}</DetailRow>
            </View>
          ) : booking.quotation ? (
            <View style={{ flex: 1 }}>
              <DetailRow label="Quoted">
                {money(booking.quotation.amount, booking.quotation.currency)}
              </DetailRow>
            </View>
          ) : null}
          {/*
            Once the advance has cleared, what is paid and what is left are the
            two figures a vendor is actually tracking — and both come off the
            list read rather than a request per row (EZ1-I259).
          */}
          {paid > 0 ? (
            <View style={{ flex: 1 }}>
              <DetailRow label="Paid">{money(paid, booking.currency)}</DetailRow>
            </View>
          ) : null}
          {/*
            The number the customer actually entered when they asked: the
            booking amount is 0 until a quote is agreed, so without this the
            vendor saw INR 0 and could not tell what the customer had in mind.
          */}
          {booking.expectedBudget && Number(booking.expectedBudget) > 0 ? (
            <View style={{ flex: 1 }}>
              <DetailRow label="Customer budget">
                {money(booking.expectedBudget, booking.currency)}
              </DetailRow>
            </View>
          ) : null}
        </View>
      </DetailGrid>

      {paid > 0 && remaining > 0 ? (
        <Caption tone="faint">Remaining {money(remaining, booking.currency)}</Caption>
      ) : null}

      {/* The one thing waiting on the provider, so the queue reads as a to-do
          list rather than a wall of statuses. */}
      {nextAction ? (
        <Caption style={{ color: rgb(theme.cautionFg), fontWeight: '600' }}>
          Next: {nextAction}
        </Caption>
      ) : null}

      {/* Why a cancelled booking was cancelled, and by whom. */}
      {booking.status === 'cancelled' && (booking.cancellationReason || booking.cancelledByName) ? (
        <View
          style={{
            backgroundColor: rgb(theme.criticalBg),
            borderRadius: radius.sm,
            padding: space(2.5),
          }}
        >
          <Caption style={{ color: rgb(theme.criticalFg) }}>
            Cancelled
            {booking.cancelledByName
              ? ` by ${booking.cancelledByName}${
                  booking.cancelledByRole ? ` (${booking.cancelledByRole})` : ''
                }`
              : ''}
            {booking.cancellationReason ? ` — ${booking.cancellationReason}` : ''}
          </Caption>
        </View>
      ) : null}

      <RequestedServices services={booking.requestedServices} />

      {booking.requirements ? (
        <Sunken>
          <Caption>{booking.requirements}</Caption>
        </Sunken>
      ) : null}

      {/* A free-text note the customer left on the request. */}
      {booking.notes ? (
        <Sunken>
          <Caption>
            <Caption tone="faint">Note: </Caption>
            {booking.notes}
          </Caption>
        </Sunken>
      ) : null}

      <Divider />

      {/* What the buyer answered on this service's own form, plus the add-ons
          and the thread. Fetched only when opened. */}
      <Button
        label={expanded ? 'Hide detail' : 'Show detail'}
        variant="ghost"
        small
        onPress={() => setExpanded((e) => !e)}
      />
      {expanded && (
        <>
          <BookingDetail booking={booking} />
          <BookingChat bookingId={booking.id} />
        </>
      )}

      {actions.length > 0 && (
        <View style={{ gap: space(2) }}>
          {actions.map((action) => {
            if (action.key === 'requote' || action.key === 'send_quote') {
              return (
                <Button
                  key={action.key}
                  label={action.label}
                  variant={action.primary ? 'primary' : 'outline'}
                  onPress={() => setQuoting((q) => !q)}
                />
              );
            }
            if (action.key === 'raise_issue') {
              return (
                <Button
                  key={action.key}
                  label={raising ? 'Never mind' : action.label}
                  variant="outline"
                  onPress={() => setRaising((r) => !r)}
                />
              );
            }
            return (
              <View key={action.key} style={{ gap: space(1) }}>
                <Button
                  label={action.label}
                  variant={action.primary ? 'primary' : 'outline'}
                  disabled={acting || Boolean(action.disabledReason)}
                  onPress={() => {
                    if (action.key === 'withdraw_quote') {
                      NativeAlert.alert(
                        'Withdraw this quotation?',
                        'The customer can no longer accept it, and the request comes back to you to price again.',
                        [
                          { text: 'Keep it', style: 'cancel' },
                          {
                            text: 'Withdraw',
                            style: 'destructive',
                            onPress: () => onAct(booking.id, action.path as string),
                          },
                        ],
                      );
                      return;
                    }
                    if (action.key === 'accept_request') {
                      NativeAlert.alert(
                        `${action.label}?`,
                        'The customer will be asked to pay the advance once you accept.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Accept',
                            onPress: () => onAct(booking.id, 'accept', { amount: action.amount }),
                          },
                        ],
                      );
                      return;
                    }
                    // Marking a delivery asks what was delivered; cancelling the
                    // prompt cancels the action.
                    if (action.key === 'deliver') {
                      setDeliveryPrompt(true);
                      return;
                    }
                    onAct(booking.id, action.path as string);
                  }}
                />
                {/* Why it is unavailable, on the card (row 20). */}
                {action.disabledReason ? (
                  <Caption style={{ color: rgb(theme.cautionFg) }}>{action.disabledReason}</Caption>
                ) : null}
              </View>
            );
          })}
        </View>
      )}

      {raising && (
        <RaiseIssueForm
          bookingId={booking.id}
          onCancel={() => setRaising(false)}
          onDone={() => {
            setRaising(false);
            onQuoted();
          }}
        />
      )}

      {quoting && (
        <QuotationForm
          bookingId={booking.id}
          onDone={() => {
            setQuoting(false);
            onQuoted();
          }}
          onCancel={() => setQuoting(false)}
        />
      )}

      <PromptSheet
        visible={deliveryPrompt}
        title="What was delivered?"
        message="The customer sees this when they confirm. Leave it blank to skip."
        placeholder="Gallery link, delivery note, anything the customer should see"
        confirmLabel="Mark delivered"
        onCancel={() => setDeliveryPrompt(false)}
        onConfirm={(value) => {
          setDeliveryPrompt(false);
          onAct(booking.id, 'complete', value ? { notes: value } : {});
        }}
      />
    </Card>
  );
}

function Fact({ icon, children }: { icon: React.ReactNode; children: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space(1.5) }}>
      {icon}
      <Caption>{children}</Caption>
    </View>
  );
}

function Sunken({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: rgb(theme.surfaceSunken),
        borderRadius: radius.sm,
        padding: space(2.5),
      }}
    >
      {children}
    </View>
  );
}
