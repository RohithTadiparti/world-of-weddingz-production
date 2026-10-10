import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { api, apiMessage } from '@/lib/api';
import { dateTime, humanise } from '@/lib/format';
import {
  CASE_ACTIONS,
  STATUS_TONE,
  type CaseAction,
  type Officer,
  type SupportCase,
} from '@/lib/verification';
import {
  CASE_ACTION_LABEL,
  CASE_STATUS_LABEL,
  MILESTONE_LABEL,
  Permission,
  can,
} from '@/shared/permissions';
import { canClose, canReply, raiserTimeline } from '@/shared/support-cases';
import { Badge, Divider } from '@/components/chrome';
import { Textarea } from '@/components/form';
import { PromptSheet } from '@/components/prompt';
import { CaseContext } from '@/components/cases/case-context';
import {
  Alert,
  Body,
  Button,
  Caption,
  Card,
  EmptyState,
  Field,
  Loading,
  PageSubtitle,
  PageTitle,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { selectPermissions, useAuth } from '@/store/auth';
import { rgb, space, useTheme } from '@/theme';

/** Which prompt is open, since three of the actions ask for a sentence first. */
type Ask = 'escalate' | 'await' | 'sendBack' | 'cancel' | null;

/**
 * One investigation.
 *
 * The web client's CaseRow, which is 500 lines of card because it holds the
 * whole workflow at once. On a phone the case is a screen: the context blocks
 * the server filled in, then the step that is actually this person's to take.
 *
 * Who may press what is the point of the layout, and it follows the web
 * exactly. Recording findings and proposing a resolution is the assigned
 * officer's step, so an administrator — who allocates and later reviews — is
 * not shown those controls. And while the case sits with the officer, the
 * administrator's own strip goes: re-allocating a case an officer had already
 * started used to be one stray press away.
 */
export default function Case() {
  const theme = useTheme();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const permissions = useAuth(selectPermissions);
  const myId = useAuth((s) => s.user?.id ?? null);
  const canAllocate = can(permissions, Permission.VERIFICATION_ALLOCATE);
  const canInvestigate = can(permissions, Permission.CASE_INVESTIGATE);

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [findings, setFindings] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [amount, setAmount] = useState('');
  const [ask, setAsk] = useState<Ask>(null);
  const [seeded, setSeeded] = useState(false);
  const [reply, setReply] = useState('');

  // The case itself, by id. Searching the first page of the queue for it told
  // anybody whose case had fallen past that page that it was no longer theirs.
  const {
    data: item,
    isPending,
    error: loadError,
  } = useQuery({
    queryKey: ['verification-case', id],
    queryFn: async () => (await api.get(`/verification/cases/${id}`)).data as SupportCase,
    enabled: Boolean(id),
    retry: false,
    refetchInterval: 20_000,
  });

  const { data: officers = [] } = useQuery({
    queryKey: ['verification-officers'],
    queryFn: async () => (await api.get('/verification/officers')).data as Officer[],
    retry: false,
    enabled: canAllocate,
  });

  // Seed the findings box from whatever is already on the record, once, then
  // leave the officer's typing alone — this list polls every twenty seconds,
  // and re-seeding on every poll would wipe a half-written write-up.
  useEffect(() => {
    if (item && !seeded) {
      setFindings(item.findings ?? '');
      setSeeded(true);
    }
  }, [item, seeded]);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setError('');
    setNotice('');
    try {
      await fn();
      if (done) setNotice(done);
      void qc.invalidateQueries({ queryKey: ['verification-case', id] });
      void qc.invalidateQueries({ queryKey: ['verification-cases'] });
      void qc.invalidateQueries({ queryKey: ['verification-metrics'] });
    } catch (err) {
      setError(apiMessage(err, 'That action was rejected.'));
    }
  }

  if (isPending) {
    return (
      <Screen>
        <Loading rows={4} />
      </Screen>
    );
  }

  if (!item) {
    return (
      <Screen>
        <EmptyState title="That case could not be opened">
          {apiMessage(loadError, 'It may have been reallocated or closed by somebody else.')}
        </EmptyState>
      </Screen>
    );
  }

  const settled =
    item.status === 'resolved' || item.status === 'closed' || item.status === 'cancelled';
  const businessChange = item.subjectType === 'vendor' && item.category === 'business_change';
  const isRaiser = !canAllocate && item.raisedByUserId === myId && item.assignedToUserId !== myId;
  // An officer has proposed a resolution and it is waiting on an administrator
  // to approve it or send it back — a different screen from settling a fresh
  // case, so the two do not blur into one another.
  const inReview = item.status === 'resolution_submitted' || item.status === 'admin_review';
  /*
   * Whether the case is currently somebody else's move.
   *
   * While it sits with the officer, or with whoever was asked for information,
   * the administrator's strip goes; it comes back the moment the ball is back
   * in their court.
   */
  const withSomebodyElse =
    item.status === 'allocated' ||
    item.status === 'in_progress' ||
    item.status === 'waiting_for_information';

  const actions = CASE_ACTIONS[item.subjectType] ?? CASE_ACTIONS.other;
  const aboutMoney = item.subjectType === 'booking' || item.subjectType === 'payment';

  const runAction = (action: CaseAction) => {
    if (action.kind === 'escalate') {
      setAsk('escalate');
      return;
    }
    // Said, rather than a press that comes back refused (row 27).
    if (!resolutionNotes.trim()) {
      setError('Write what you did about it first. The person who raised the case reads this note.');
      return;
    }
    void run(
      () =>
        api.put(`/verification/cases/${item.id}/settle`, {
          outcome: action.outcome,
          action: action.key,
          notes: resolutionNotes.trim() || undefined,
        }),
      'Recommendation submitted for review.',
    );
  };

  return (
    <Screen>
      <View style={{ gap: space(1) }}>
        <PageTitle>{item.title}</PageTitle>
        <PageSubtitle>
          Case {item.id.slice(0, 8)} · {humanise(item.subjectType)} · raised{' '}
          {dateTime(item.createdAt)}
        </PageSubtitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space(2) }}>
          <Badge tone={STATUS_TONE[item.status] ?? 'neutral'}>
            {CASE_STATUS_LABEL[item.status] ?? humanise(item.status)}
          </Badge>
          {item.assignedToUserId ? (
            <Badge>
              {/* The officer list is only fetched for an allocator, so an
                  officer reading their own case is told it is theirs. */}
              {item.assignedToUserId === myId
                ? 'You'
                : (officers.find((o) => o.id === item.assignedToUserId)?.name ??
                  item.assignedToName ??
                  'Assigned to an officer')}
            </Badge>
          ) : null}
        </View>
      </View>

      {error ? <Alert tone="critical">{error}</Alert> : null}
      {notice ? <Alert tone="positive">{notice}</Alert> : null}

      <Card>
        <SectionTitle>What was reported</SectionTitle>
        <Body>{item.description}</Body>
        {item.milestone ? (
          <Caption>
            The argument is over the{' '}
            {(MILESTONE_LABEL[item.milestone] ?? item.milestone).toLowerCase()}.
          </Caption>
        ) : null}
        {item.requiresPhysicalVerification ? (
          <Caption style={{ color: rgb(theme.cautionFg) }}>
            Escalated. This one needs somebody on the ground.
          </Caption>
        ) : null}
      </Card>

      <CaseContext item={item} />

      {item.settlementOutcome && !inReview ? (
        <Card>
          <Caption tone="faint">Settled</Caption>
          <Body>
            {humanise(item.settlementOutcome)}
            {item.resolutionAction
              ? ` · ${CASE_ACTION_LABEL[item.resolutionAction] ?? humanise(item.resolutionAction)}`
              : ''}
          </Body>
          {item.settlementNotes ? <Caption>{item.settlementNotes}</Caption> : null}
        </Card>
      ) : null}

      {/* The officer's proposal, and the administrator's decision on it. */}
      {inReview && (
        <Card>
          <SectionTitle>Resolution submitted for review</SectionTitle>
          {item.resolutionAction ? (
            <Body>
              Action:{' '}
              {CASE_ACTION_LABEL[item.resolutionAction] ?? humanise(item.resolutionAction)}
            </Body>
          ) : null}
          {item.settlementOutcome ? (
            <Body>Proposed: {humanise(item.settlementOutcome)}</Body>
          ) : null}
          {item.findings ? <Body tone="muted">{item.findings}</Body> : null}
          {item.settlementNotes ? <Caption>{item.settlementNotes}</Caption> : null}

          {canAllocate ? (
            <>
              <Divider />
              <Button
                label="Approve resolution"
                onPress={() =>
                  void run(
                    () =>
                      api.put(`/verification/cases/${item.id}/review`, { decision: 'approve' }),
                    'Approved. The resolution stands.',
                  )
                }
              />
              <Button label="Send back" variant="outline" onPress={() => setAsk('sendBack')} />
            </>
          ) : (
            <Caption tone="faint">This is with an administrator for a decision.</Caption>
          )}
        </Card>
      )}

      {/*
        With the officer, so nothing here is the administrator's to press. The
        assignment and what it is waiting on stay visible above; only the
        actions go.
      */}
      {canAllocate && !settled && !inReview && withSomebodyElse ? (
        <Caption tone="faint">
          {item.status === 'waiting_for_information'
            ? 'Waiting on a reply. Actions return when they respond.'
            : 'With the assigned officer. Actions return when they report back.'}
        </Caption>
      ) : null}

      {canAllocate && !settled && !inReview && !withSomebodyElse && (
        <Card>
          <SectionTitle>Move it on</SectionTitle>
          <Button
            label="Allocate to lightest workload"
            onPress={() =>
              void run(
                () => api.put(`/verification/cases/${item.id}/allocate`, {}),
                'Allocated.',
              )
            }
          />
          {!item.requiresPhysicalVerification ? (
            <Button label="Needs a visit" variant="outline" onPress={() => setAsk('escalate')} />
          ) : null}
          <Button label="Waiting on them" variant="outline" onPress={() => setAsk('await')} />
          <Caption tone="faint">
            Naming a particular officer is done from the web console, where the whole roster and
            each officer&apos;s workload are on screen together.
          </Caption>
        </Card>
      )}

      {/*
        Recording findings and proposing a resolution is the assigned officer's
        step, so an administrator is not shown these controls.
      */}
      {/* A business change request: grant edit access or cancel it (row 24). */}
      {canAllocate && businessChange && (item.status === 'open' || item.status === 'triaged') ? (
        <Card>
          <SectionTitle>Business change request</SectionTitle>
          <Caption tone="faint">
            Grant the vendor temporary edit access to the requested details, or cancel the request.
            An officer is allocated after the vendor submits the update.
          </Caption>
          <Button
            label="Grant edit access"
            disabled={!item.requestedFields?.length}
            onPress={() =>
              void run(
                () =>
                  api.put(`/verification/cases/${item.id}/grant-business-edit-access`, {
                    fields: item.requestedFields ?? [],
                  }),
                'Edit access granted. The vendor has been notified.',
              )
            }
          />
          <Button label="Cancel Request" variant="outline" onPress={() => setAsk('cancel')} />
        </Card>
      ) : null}

      {/* Whoever raised it follows along, and can answer or close it. */}
      {isRaiser ? (
        <Card>
          <SectionTitle>Updates</SectionTitle>
          {raiserTimeline(item.history, myId).map((h, i) => (
            <Caption key={i}>
              {h.label} · {dateTime(h.at)}
              {h.note ? `: ${h.note}` : ''}
            </Caption>
          ))}
          {canReply(item.status) ? (
            <>
              <Textarea
                label={item.status === 'waiting_for_information' ? 'Answer the question' : 'Add a reply'}
                value={reply}
                onChange={setReply}
                rows={3}
                maxLength={4000}
              />
              <Button
                label="Send reply"
                disabled={reply.trim().length < 2}
                onPress={() =>
                  void run(
                    () => api.put(`/verification/cases/${item.id}/reply`, { message: reply.trim() }),
                    'Reply sent. Whoever is working on it has been told.',
                  ).then(() => setReply(''))
                }
              />
            </>
          ) : null}
          {canClose(item.status) ? (
            <Button
              label={settled ? 'Close case' : 'Withdraw and close'}
              variant="outline"
              onPress={() =>
                void run(() => api.put(`/verification/cases/${item.id}/close`, {}), 'Case closed.')
              }
            />
          ) : null}
        </Card>
      ) : null}

      {!canAllocate && canInvestigate && !settled && !inReview && (
        <>
          <Card>
            <SectionTitle>What the investigation found</SectionTitle>
            <Textarea
              label="Findings"
              value={findings}
              onChange={setFindings}
              rows={4}
              placeholder="What the investigation found."
            />
            <Button
              label="Record findings"
              variant="outline"
              disabled={findings.trim().length < 10}
              onPress={() =>
                void run(
                  () => api.put(`/verification/cases/${item.id}/findings`, { findings }),
                  'Findings recorded.',
                )
              }
            />
          </Card>

          <Card>
            <SectionTitle>Resolution</SectionTitle>
            <Caption tone="faint">
              {aboutMoney
                ? 'Money on the disputed booking stays frozen. You recommend the action; an administrator approves it before anything moves.'
                : 'You recommend the action; an administrator approves it before the case closes.'}
            </Caption>
            <Textarea
              label="Notes on the resolution"
              value={resolutionNotes}
              onChange={setResolutionNotes}
              rows={3}
              placeholder="Required. The person who raised the case reads this."
            />
            {actions.map((action) => (
              <Button
                key={action.key}
                label={action.label}
                variant={action.kind === 'settle' && action.primary ? 'primary' : 'outline'}
                onPress={() => runAction(action)}
              />
            ))}

            {/* Partial settlement needs an amount, so it sits apart from the
                one-press actions. */}
            {aboutMoney && (
              <>
                <Divider />
                <Field
                  label="Partial amount"
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                />
                <Button
                  label="Recommend partial settlement"
                  variant="outline"
                  disabled={!amount}
                  onPress={() =>
                    void run(
                      () =>
                        api.put(`/verification/cases/${item.id}/settle`, {
                          outcome: 'partial',
                          amount: Number(amount),
                          action: 'partial_settlement',
                          notes: resolutionNotes.trim() || undefined,
                        }),
                      'Recommendation submitted for review.',
                    )
                  }
                />
              </>
            )}
          </Card>
        </>
      )}

      <PromptSheet
        visible={ask === 'escalate'}
        title="Why does this need somebody on the ground?"
        message="The next officer reads this."
        minLength={10}
        confirmLabel="Escalate"
        onCancel={() => setAsk(null)}
        onConfirm={(reason) => {
          setAsk(null);
          void run(
            () => api.put(`/verification/cases/${item.id}/escalate`, { reason }),
            'Escalated. It now needs a physical visit before it can be settled.',
          );
        }}
      />

      <PromptSheet
        visible={ask === 'await'}
        title="What have you asked for, and from whom?"
        minLength={10}
        confirmLabel="Park it"
        onCancel={() => setAsk(null)}
        onConfirm={(reason) => {
          setAsk(null);
          void run(
            () => api.put(`/verification/cases/${item.id}/await-information`, { reason }),
            'Parked. The clock is on them now, not on you.',
          );
        }}
      />

      <PromptSheet
        visible={ask === 'cancel'}
        title="Why is this request being cancelled?"
        message="The vendor reads this."
        minLength={3}
        confirmLabel="Cancel Request"
        onCancel={() => setAsk(null)}
        onConfirm={(reason) => {
          setAsk(null);
          void run(
            () => api.put(`/verification/cases/${item.id}/cancel-business-change`, { reason }),
            'Request cancelled. The vendor has been notified.',
          );
        }}
      />

      <PromptSheet
        visible={ask === 'sendBack'}
        title="Why is it going back?"
        message="The next officer needs to know."
        minLength={3}
        confirmLabel="Send back"
        onCancel={() => setAsk(null)}
        onConfirm={(note) => {
          setAsk(null);
          void run(
            () =>
              api.put(`/verification/cases/${item.id}/review`, {
                decision: 'reassign',
                note,
              }),
            'Sent back for another look.',
          );
        }}
      />
    </Screen>
  );
}
