import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { useBusinesses } from '../store/business';
import {
  Permission,
  ROLE_LABEL,
  VERIFICATION_LABEL,
  canAny,
} from '../lib/permissions';
import { Visit, VISIT_TONE, isTodayVisit, scheduledLabel } from '../lib/visits';
import { BUSINESS_STATUS_LABEL, humanize } from '../lib/labels';
import { ReactNode, useEffect, useState } from 'react';
import ClaimRequests from '../components/ClaimRequests';
import GetStarted from '../components/GetStarted';
import VendorDashboard from '../components/VendorDashboard';
import IndividualDashboard from '../components/IndividualDashboard';
import { AppDownloadCard } from '../components/AppDownload';
import { ArrowRight } from '@phosphor-icons/react';
import { AnimatedCard, AnimatedCounter } from '../components/ui/Motion';
import {
  Bell,
  CalendarCheck,
  CheckCircle,
  Coins,
  ClipboardText,
  Hourglass,
  Lifebuoy,
  Prohibit,
  UserCircle,
  UserPlus,
  UsersThree,
  Vault,
  Warning,
  WarningCircle,
} from '@phosphor-icons/react';

/**
 * One tile catalogue for every persona; each tile declares what it needs, and
 * the dashboard renders only the ones the signed-in account can actually use.
 */
const TILES = [
  {
    to: '/profile',
    title: 'Your Profile',
    desc: 'Complete your details to get better matches',
    requires: [Permission.PROFILE_MANAGE_OWN],
  },
  {
    to: '/client-profiles',
    title: 'Client Profiles',
    desc: 'Build a profile for someone who has not joined yet, then invite them',
    requires: [Permission.MANAGED_PROFILE_MANAGE],
    hideFor: ['family'],
  },
  {
    to: '/shared-with-me',
    title: 'Shared With Me',
    desc: 'Biodata other agencies have circulated to you',
    requires: [Permission.ACT_ON_BEHALF],
    hideFor: ['family'],
  },
  {
    to: '/pool',
    title: 'Network Pool',
    desc: 'Profiles other approved agencies have opened to the network',
    requires: [Permission.NETWORK_POOL_BROWSE],
  },
  {
    to: '/interests',
    title: 'Interests',
    desc: 'Who has asked about you, who you have asked, and what came of it',
    requires: [Permission.MATCH_BROWSE, Permission.ACT_ON_BEHALF],
    hideFor: ['vendor', 'planner', 'in_person'],
  },
  {
    to: '/wedding-planners',
    title: 'Hire a Planner',
    desc: 'Find somebody to run your wedding end to end',
    requires: [Permission.BOOKING_CREATE],
  },
  {
    to: '/console',
    title: 'My Business',
    desc: 'Your listing and the bookings coming in',
    requires: [Permission.VENDOR_LISTING_MANAGE, Permission.PLANNER_LISTING_MANAGE],
  },
  {
    to: '/availability',
    title: 'Availability',
    desc: 'Publish the windows you can take work in',
    requires: [Permission.VENDOR_LISTING_MANAGE],
  },
  {
    to: '/accounts',
    title: 'Accounts',
    desc: 'What you have earned and what is still in escrow',
    requires: [Permission.BOOKING_READ_INCOMING],
  },
  {
    to: '/events',
    title: 'Events',
    desc: 'Each day of the wedding, its guests and its vendors',
    requires: [Permission.EVENT_MANAGE_OWN],
  },
  {
    to: '/travel',
    title: 'Honeymoon',
    desc: 'Packages by budget and by how long you have',
    requires: [Permission.TRAVEL_BOOK],
  },
  {
    to: '/planner',
    title: 'My Wedding Plan',
    desc: 'Your own timeline, worked back from the date',
    requires: [Permission.PLAN_MANAGE_OWN, Permission.PLAN_MANAGE_ENGAGED],
  },
  {
    to: '/bookings',
    title: 'Bookings',
    // A provider reaches the same page from the other side — the work coming
    // in against their listings, which used to be duplicated on My Business.
    desc: 'Requests, quotations, confirmations and escrow',
    requires: [Permission.BOOKING_READ_OWN, Permission.BOOKING_READ_INCOMING],
  },
  {
    to: '/genie',
    title: 'WOW Genie',
    desc: 'AI budget insights and planning help',
    requires: [Permission.AI_ASSIST],
  },
  {
    to: '/notifications',
    title: 'Notifications',
    desc: 'Everything that has happened since you were last here',
    requires: [],
  },
  {
    to: '/security',
    title: 'Security',
    desc: 'Password, two-factor and signed-in devices',
    requires: [Permission.SESSION_MANAGE_OWN],
  },
  {
    to: '/admin',
    title: 'Admin',
    desc: 'Approvals, analytics, disputes and the audit trail',
    requires: [Permission.ADMIN_ANALYTICS_READ],
  },
];

void TILES;

export default function Dashboard({
  adminUserId,
  readOnly = false,
  adminView = false,
  roleOverride,
}: {
  adminUserId?: string;
  readOnly?: boolean;
  adminView?: boolean;
  roleOverride?: 'agent' | 'vendor' | 'planner' | 'officer';
}) {
  void readOnly;
  void adminView;
  const adminScope = adminUserId ? { userId: adminUserId, role: roleOverride } : undefined;
  const user = useAuth((s) => s.user);
  // Read reactively: the Overdue tasks tile links back into this same page with
  // ?tasks=overdue, so the panel below has to notice the change (EZ1-I230).
  const [taskParams] = useSearchParams();
  const permissions = user?.permissions ?? [];

  const isProvider = roleOverride === 'vendor' || roleOverride === 'planner' || canAny(permissions, [Permission.BOOKING_READ_INCOMING]);
  const isBuyer = canAny(permissions, [Permission.BOOKING_READ_OWN]);

  const { data: profile } = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/users/me')).data,
    retry: false,
    enabled: !adminUserId,
  });

  // A dashboard that only links to other pages tells you nothing you did not
  // already know. These are the three numbers each persona opens the app for.
  const { data: unread } = useQuery({
    queryKey: ['unread-count'],
    queryFn: async () => (await api.get('/notifications/unread-count', { params: adminScope })).data,
    retry: false,
  });

  // The provider dashboard always refetches on mount (EZ1-I118): navigating back
  // to it after changing something in another module shows the current figures,
  // not whatever was cached when it was last open.
  // The provider's "waiting on you" counts poll while the dashboard is open and
  // refresh when the tab regains focus, so a new request shows up without a
  // manual refresh (EZ1-I133), on top of the refetch-on-navigation (EZ1-I118).
  const liveCount = {
    retry: false,
    enabled: isProvider,
    refetchOnMount: 'always' as const,
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  };
  const { data: incoming } = useQuery({
    queryKey: ['incoming-bookings-count'],
    queryFn: async () => (await api.get('/bookings/incoming', { params: { limit: 1, ...adminScope } })).data,
    ...liveCount,
  });

  // "Bookings against your listing" counts everything ever, including jobs
  // finished last year. What a vendor opens the app to find out is how many
  // people are waiting on a price from them right now.
  const { data: newRequests } = useQuery({
    queryKey: ['new-requests-count'],
    queryFn: async () =>
      (await api.get('/bookings/incoming', { params: { limit: 1, status: 'requested', ...adminScope } })).data,
    ...liveCount,
  });

  const { data: earnings } = useQuery({
    queryKey: ['earnings'],
    queryFn: async () => (await api.get('/bookings/earnings', { params: adminScope })).data,
    retry: false,
    enabled: isProvider,
    refetchOnMount: 'always',
  });

  // A vendor's own summary, for the business the header switcher has selected.
  // Everything here is a number they would otherwise open three pages to find.
  const isVendor = roleOverride === 'vendor' || canAny(permissions, [Permission.VENDOR_LISTING_MANAGE]);
  const { active, businesses } = useBusinesses();

  const { data: quoted } = useQuery({
    queryKey: ['awaiting-answer-count'],
    queryFn: async () =>
      (await api.get('/bookings/incoming', { params: { limit: 1, status: 'quotation_sent' } }))
        .data,
    ...liveCount,
    enabled: isVendor,
  });

  const { data: slots } = useQuery({
    queryKey: ['availability-summary', active?.id],
    queryFn: async () => (await api.get(`/vendors/${active?.id}/availability/summary`)).data,
    retry: false,
    enabled: isVendor && Boolean(active?.id),
    refetchOnMount: 'always',
  });

  // A wedding planner is a provider who is not a vendor. Their dashboard opens
  // onto their clients rather than a shop window, so it carries an "action
  // required" band of the things waiting on them (EZ1-I39).
  const isPlanner = roleOverride === 'planner' || (isProvider && !isVendor);
  const { data: plannerBook } = useQuery({
    queryKey: ['planner-clients-summary'],
    queryFn: async () =>
      (await api.get('/planner/clients', { params: adminScope })).data as {
        clients: {
          userId: string;
          planId: string;
          name: string;
          status: string;
          weddingDate: string | null;
          location: string | null;
          nextEvent?: { id: string; name: string; date: string } | null;
        }[];
        requests: unknown[];
        upcomingTasks?: {
          id: string;
          planId: string;
          clientName: string;
          title: string;
          dueDate: string | null;
          overdue: boolean;
        }[];
      },
    retry: false,
    enabled: isPlanner,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
  // The counters come off the same engagement My Clients is built from, so a
  // wedding on the screen can never sit beside a zero count, and escrow reads
  // zero when there is genuinely no book rather than borrowing a listing's
  // figure (EZ1-I184).
  const { data: plannerOverview } = useQuery({
    queryKey: ['planner-overview'],
    queryFn: async () =>
      (await api.get('/planner/overview', { params: adminScope })).data as {
        weddings: number;
        active: number;
        upcoming: number;
        completed: number;
        clients: number;
        bookings: { total: number; confirmed: number; pending: number };
        escrowHeld: string;
        tasks: { total: number; done: number; overdue: number };
        currency: string;
      },
    retry: false,
    enabled: isPlanner,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
  const plannerClients = plannerBook?.clients ?? [];
  const activeClients = plannerOverview?.active ?? 0;
  const upcomingClients = plannerOverview?.upcoming ?? 0;
  const plannerRequests = plannerBook?.requests?.length ?? 0;
  const plannerUpcomingEvents = plannerClients.filter((client) => client.nextEvent).length;
  const plannerPendingTasks = Math.max(
    0,
    (plannerOverview?.tasks.total ?? 0) - (plannerOverview?.tasks.done ?? 0),
  );
  const overdueOnly = taskParams.get('tasks') === 'overdue';
  const completedPlanIds = new Set(
    plannerClients.filter((client) => client.status === 'completed').map((client) => client.planId),
  );
  const upcomingTasks = (plannerBook?.upcomingTasks ?? []).filter(
    (task) => !completedPlanIds.has(task.planId),
  );
  const shownTasks = overdueOnly ? upcomingTasks.filter((task) => task.overdue) : upcomingTasks;
  // The next few weddings by date, so the band leads with what is coming rather
  // than only how many there are (EZ1-I52).
  const upcomingWeddings = plannerClients
    .filter((c) => c.weddingDate)
    .sort((a, b) => new Date(a.weddingDate!).getTime() - new Date(b.weddingDate!).getTime())
    .slice(0, 4);

  // A marriage agent opens the app to see their book at a glance.
  const isAgent = roleOverride === 'agent' || canAny(permissions, [Permission.AGENCY_MANAGE]);
  const { data: agentStats } = useQuery({
    queryKey: ['agent-dashboard', adminUserId],
    queryFn: async () => (await api.get('/agents/dashboard', { params: adminScope })).data as {
      totalClients: number;
      matchesFixed: number;
      remainingClients: number;
      totalInterests: number;
      newInterests: number;
      pendingClientActions: number;
      issuesPending: number;
      escrow: { total: string; pending: string; released: string; refunded: string; currency: string };
    },
    retry: false,
    enabled: isAgent,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });

  // A verification officer opens the app to see the work waiting on them
  // (EZ1-I92): how many verifications are new, in progress or submitted, and
  // which have a deadline coming up. VERIFICATION_FIELDWORK is held by officers
  // and never by an administrator, so it identifies the persona cleanly.
  const isOfficer = roleOverride === 'officer' || canAny(permissions, [Permission.VERIFICATION_FIELDWORK]);
  const { data: officerQueue } = useQuery({
    queryKey: ['officer-queue'],
    queryFn: async () =>
      (await api.get('/verification/requests', { params: { limit: 100, ...adminScope } })).data as {
        data: Visit[];
      },
    retry: false,
    enabled: isOfficer,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
  const { data: officerSummary } = useQuery({
    queryKey: ['officer-dashboard'],
    queryFn: async () => (await api.get('/verification/officer-dashboard')).data as {
      today: number;
      assigned: number;
      pending: number;
      inProgress: number;
      submitted: number;
      needsAnotherLook: number;
      completed: number;
      approved: number;
      rejected: number;
      escalated: number;
      openIssues: number;
    },
    retry: false,
    enabled: isOfficer,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
  });
  const officerRequests: Visit[] = officerQueue?.data ?? [];
  const officerCounts = {
    assigned: officerSummary?.assigned ?? officerRequests.filter((r) => r.status === 'assigned').length,
    inProgress: officerSummary?.inProgress ?? officerRequests.filter((r) => r.status === 'in_progress').length,
    submitted: officerSummary?.submitted ?? officerRequests.filter((r) => r.status === 'submitted').length,
    additional: officerSummary?.needsAnotherLook ?? officerRequests.filter((r) => r.status === 'additional_review').length,
    today: officerSummary?.today ?? officerRequests.filter(isTodayVisit).length,
  };
  // Today's schedule, soonest first, for the section below the overview.
  const todaysVisits = officerRequests
    .filter(isTodayVisit)
    .sort(
      (a, b) =>
        (a.slaDeadline ? new Date(a.slaDeadline).getTime() : Infinity) -
        (b.slaDeadline ? new Date(b.slaDeadline).getTime() : Infinity),
    );

  // The dashboard is about the profile being completed, so its greeting must
  // use the name saved in Profile Details. `accountName` is deliberately kept
  // separate for account navigation: for family accounts it can be inferred
  // from the login/steward record and is not necessarily this profile's name.
  const profileName = typeof profile?.displayName === 'string' ? profile.displayName.trim() : '';

  // The vendor's home is a dedicated, backend-driven dashboard (EZ1-I147). All
  // the hooks above still run so the hook order is stable across a role change;
  // the branch is here, after them, rather than as an early return.
  if (isVendor) return <VendorDashboard />;

  return (
    <div className="space-y-10">
      {/*
        A masthead rather than a filled accent panel.

        A solid brand-coloured block at the top of every visit is the loudest
        thing on the page, competing with whatever the page is actually for.
        The greeting carries the same information at a fraction of the volume,
        and the one part of it that is actionable, an unfinished profile, gets
        to be a control instead of a sentence.
      */}
      <header className="relative overflow-hidden rounded-lg border border-brand/35 bg-gradient-to-br from-brand-strong via-brand to-brand-rose px-6 py-6 text-brand-fg shadow-lifted sm:px-8">
        <span aria-hidden className="absolute -right-8 -top-10 h-32 w-32 rounded-full border border-gold/60" />
        <span aria-hidden className="absolute -bottom-16 right-20 h-28 w-28 rounded-full border border-gold-lit/50" />
        <p className="relative text-sm text-brand-fg/75">
          Signed in as {user ? (ROLE_LABEL[user.role] ?? user.role) : ''}
          {user?.managedByAgentId ? ', represented by an agent' : ''}
        </p>
        <h1 className="relative mt-1 border-0 pl-0 font-serif text-[2.25rem] font-normal leading-[1.1] text-brand-fg sm:text-[3rem]">
          {greeting()}
          {profileName ? `, ${profileName}` : ''}
        </h1>
        {profile && !profile.profileCompleted && (
          <div className="relative mt-5 flex flex-wrap items-center gap-4 rounded-md border border-gold/60 bg-surface-raised/95 p-4 text-gray-900">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-gray-900">Your profile is not finished</p>
              <p className="mt-0.5 text-sm text-gray-500">
                Families see a complete profile far more often than an incomplete one.
              </p>
            </div>
            <Link className="btn shrink-0" to="/profile">
              Finish profile
              <ArrowRight size={16} aria-hidden />
            </Link>
          </div>
        )}
      </header>

      {/*
        The provider equivalent of the profile nudge above it.

        Same reason, and a worse consequence: an unfinished profile is seen by
        fewer families, while an unwritten listing cannot be found at all and
        never reaches an administrator. It renders nothing once the business is
        live.
      */}
      <GetStarted />

      <ClaimRequests />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Counter
          label="Unread notifications"
          value={unread?.unread ?? 0}
          to="/notifications"
        />
        {/*
          A provider that is not a planner (there is one persona here now that
          vendors have their own dashboard) keeps the listing-scoped counters.
          A planner's headline numbers come from their engaged book instead, so
          they agree with My Clients — see the planner block below.
        */}
        {isProvider && !isPlanner && (
          <>
            <Counter
              label="New requests"
              value={newRequests?.total ?? 0}
              to="/bookings"
              tone={(newRequests?.total ?? 0) > 0 ? 'text-amber-700' : undefined}
            />
            <Counter
              label="Bookings in total"
              value={incoming?.total ?? 0}
              to="/bookings"
            />
            <Counter
              label="Held in escrow"
              value={`₹${Number(earnings?.heldInEscrow ?? 0).toLocaleString('en-IN')}`}
              to="/accounts"
            />
          </>
        )}
      </div>

      {/*
        Verification Overview (EZ1-I200): the officer's workload as summary
        cards, each a live count that opens the matching filtered visit list.
        The stage counts that used to sit in a static row here (EZ1-I92) are
        now the clickable way into the work, with Today's Visits added.
      */}
      {isOfficer && (
        <section className="space-y-4">
          <OfficerAvailability />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="section-title">Verification Overview</h2>
            <Link className="btn-outline btn-sm" to="/visits">
              All visits
            </Link>
          </div>
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Today's work</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <OfficerMetric label="Unread notifications" value={unread?.unread ?? 0} to="/notifications" icon={Bell} gradient="from-brand-soft to-surface" />
              <OfficerMetric label="Today's visits" value={officerCounts.today} to="/visits?view=today" icon={CalendarCheck} gradient="from-brand-100 to-brand-50" />
              <OfficerMetric label="Pending visits" value={officerSummary?.pending ?? officerCounts.assigned} to="/visits?status=assigned" icon={Hourglass} gradient="from-caution-bg to-surface" />
              <OfficerMetric label="In progress" value={officerCounts.inProgress} to="/visits?status=in_progress" icon={WarningCircle} gradient="from-positive-bg to-surface" />
            </div>
            <p className="pt-2 text-xs font-medium uppercase tracking-wide text-gray-500">Verification workload</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <OfficerMetric label="Assigned visits" value={officerCounts.assigned} to="/visits?status=assigned" icon={ClipboardText} gradient="from-brand-100 to-surface" />
              <OfficerMetric label="Submitted" value={officerCounts.submitted} to="/visits?status=submitted" icon={ClipboardText} gradient="from-brand-soft to-brand-50" />
              <OfficerMetric label="Needs another look" value={officerCounts.additional} to="/visits?status=additional_review" icon={Warning} gradient="from-caution-bg to-surface" />
              <OfficerMetric label="Completed visits" value={officerSummary?.completed ?? 0} to="/visits?view=completed" icon={CheckCircle} gradient="from-positive-bg to-brand-50" />
            </div>
            <p className="pt-2 text-xs font-medium uppercase tracking-wide text-gray-500">Verification outcomes</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <OfficerMetric label="Approved" value={officerSummary?.approved ?? 0} to="/visits?status=approved" icon={CheckCircle} gradient="from-positive-bg to-brand-50" />
              <OfficerMetric label="Rejected" value={officerSummary?.rejected ?? 0} to="/visits?status=rejected" icon={Prohibit} gradient="from-rose-50 to-surface" />
              <OfficerMetric label="Escalated" value={officerSummary?.escalated ?? 0} to="/support?status=escalated" icon={Warning} gradient="from-brand-soft to-rose-50" />
              <OfficerMetric label="Open issues" value={officerSummary?.openIssues ?? 0} to="/support?status=open" icon={Lifebuoy} gradient="from-rose-50 to-surface" />
            </div>
          </div>

          {/*
            Today's Verification: the visits scheduled for today, the thing an
            officer opens the app to see. Each row carries who and where, the
            scheduled time and status, and the way straight into it.
          */}
          <div className="rounded-lg border border-gray-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-gray-500">Today's Verification</h3>
              <Link className="btn-outline btn-sm" to="/calendar">
                Open calendar
              </Link>
            </div>
            {todaysVisits.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">Nothing scheduled for today.</p>
            ) : (
              <div className="mt-3 space-y-2">
                {todaysVisits.map((v) => (
                  <TodayVisit key={v.id} visit={v} />
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/*
        The individual couple's home screen (EZ1-I150): matches, interests,
        messages, events, bookings, the wedding plan, the honeymoon and support,
        each a live figure wired to its own module with the right navigation and
        an honest empty state. It owns its own booking counts, so the buckets
        that used to live here (EZ1-I75) now sit inside it.
      */}
      {isBuyer && !isProvider && <IndividualDashboard />}

      {/*
        The agent's book at a glance (EZ1-I79). Separate row from the account
        counters above because these are about the clients they run.
      */}
      {isAgent && (
        <section className="space-y-4">
          <h2 className="section-title">Action required</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <AgentMetric label="Unread notifications" value={unread?.unread ?? 0} to="/notifications" icon={Bell} gradient="from-brand-100 to-brand-50" />
            <AgentMetric label="New interests" value={agentStats?.newInterests ?? 0} to="/interests?status=pending" icon={UserPlus} gradient="from-brand-soft to-surface" />
            <AgentMetric label="Pending client actions" value={agentStats?.pendingClientActions ?? 0} to="/clients?status=incomplete" icon={UserCircle} gradient="from-caution-bg to-surface" />
            <AgentMetric label="Issues pending" value={agentStats?.issuesPending ?? 0} to="/support?status=open" icon={Warning} gradient="from-rose-50 to-surface" />
          </div>
          <h2 className="section-title pt-2">Clients & matchmaking</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <AgentMetric label="Total clients" value={agentStats?.totalClients ?? 0} to="/clients" icon={UsersThree} gradient="from-brand-100 to-surface" />
            <AgentMetric
            label="Matches fixed"
            value={agentStats?.matchesFixed ?? 0}
            to="/matches"
            icon={CheckCircle}
            gradient="from-positive-bg to-brand-50"
            />
            <AgentMetric label="Remaining clients" value={agentStats?.remainingClients ?? 0} to="/clients?status=remaining" icon={UsersThree} gradient="from-caution-bg to-surface" />
            <AgentMetric label="Total interests" value={agentStats?.totalInterests ?? 0} to="/interests" icon={UserPlus} gradient="from-brand-soft to-brand-50" />
          </div>
          <h2 className="section-title pt-2">Escrow & financial</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <AgentMetric label="Total escrow" value={money(agentStats?.escrow.total, agentStats?.escrow.currency)} to="/agent-escrow" icon={Vault} gradient="from-caution-bg to-brand-50" />
            <AgentMetric label="Escrow pending" value={money(agentStats?.escrow.pending, agentStats?.escrow.currency)} to="/agent-escrow?status=pending" icon={Coins} gradient="from-positive-bg to-surface" />
            <AgentMetric label="Escrow released" value={money(agentStats?.escrow.released, agentStats?.escrow.currency)} to="/agent-escrow?status=released" icon={CheckCircle} gradient="from-positive-bg to-brand-50" />
            <AgentMetric label="Escrow refunded" value={money(agentStats?.escrow.refunded, agentStats?.escrow.currency)} to="/agent-escrow?status=refunded" icon={Lifebuoy} gradient="from-rose-50 to-surface" />
          </div>
        </section>
      )}

      {/*
        The vendor's own row. Separate from the counters above because these are
        about one business rather than the account — with two businesses the
        header switcher decides which, and these follow it.
      */}
      {isVendor && active && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Counter
            label={businesses.length > 1 ? active.name : 'Your business'}
            value={
              active.isApproved
                ? 'Live in search'
                : (BUSINESS_STATUS_LABEL[active.status] ?? humanize(active.status))
            }
            to="/console"
            tone={active.isApproved ? 'text-emerald-700' : 'text-amber-700'}
          />
          <Counter
            label="Waiting on the client"
            value={quoted?.total ?? 0}
            to="/bookings"
          />
          <Counter
            label="Open windows"
            value={slots?.openSlots ?? 0}
            to="/availability"
            tone={(slots?.openSlots ?? 0) === 0 ? 'text-amber-700' : undefined}
          />
          <Counter
            label="Paid out"
            value={`₹${Number(earnings?.paidOut ?? 0).toLocaleString('en-IN')}`}
            to="/accounts"
          />
        </div>
      )}

      {/*
        The planner's headline row. Every figure comes off the same engagement
        My Clients is built from (EZ1-I184) — weddings they are running, bookings
        across that book, the escrow they actually hold for it, and what is
        genuinely overdue — so a wedding on screen can never sit beside a zero
        count, and all of it reads zero when there is no book rather than
        borrowing a number from an unrelated listing.
      */}
      {isPlanner && (
        <section className="space-y-4">
          <h2 className="section-title">Action required</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <PlannerMetric label="New quotation requests" value={plannerRequests} to="/my-clients/requests" tone="from-brand-soft to-surface" />
            <PlannerMetric label="Pending tasks" value={plannerPendingTasks} to="/tasks?status=pending" tone="from-caution-bg to-surface" />
            <PlannerMetric label="Overdue tasks" value={plannerOverview?.tasks.overdue ?? 0} to="/tasks?status=overdue" tone="from-rose-50 to-surface" />
            <PlannerMetric label="Upcoming events" value={plannerUpcomingEvents} to="/events" tone="from-positive-bg to-brand-50" />
          </div>
          <h2 className="section-title pt-2">Wedding portfolio</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <PlannerMetric label="Active weddings" value={activeClients} to="/weddings?status=active" tone="from-brand-100 to-brand-50" />
            <PlannerMetric label="Upcoming weddings" value={upcomingClients} to="/weddings?status=upcoming" tone="from-brand-soft to-surface" />
            <PlannerMetric label="Completed weddings" value={plannerOverview?.completed ?? 0} to="/weddings?status=completed" tone="from-positive-bg to-brand-50" />
            <PlannerMetric label="Client weddings" value={plannerOverview?.weddings ?? 0} to="/weddings" tone="from-brand-100 to-surface" />
          </div>
          <h2 className="section-title pt-2">Bookings & escrow</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <PlannerMetric label="Planner bookings" value={plannerOverview?.bookings.total ?? 0} to="/bookings" tone="from-brand-soft to-brand-50" />
            <PlannerMetric label="Pending payment milestones" value={plannerOverview?.bookings.pending ?? 0} to="/bookings?status=payment_pending" tone="from-caution-bg to-surface" />
            <PlannerMetric label="Amount in escrow" value={`₹${Number(plannerOverview?.escrowHeld ?? 0).toLocaleString('en-IN')}`} to="/accounts" tone="from-positive-bg to-brand-50" />
            <PlannerMetric label="Tasks completed" value={plannerOverview?.tasks.done ?? 0} to="/tasks?status=done" tone="from-positive-bg to-surface" />
          </div>
        </section>
      )}

      {false && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Counter label="Weddings" value={plannerOverview?.weddings ?? 0} to="/weddings" />
          {/*
            To the bookings, not to the client list.

            This pointed at My Clients, which is a list of couples and shows no
            booking at all -- the same fault as the Overdue tasks tile
            (EZ1-I230), reported again for this one as EZ1-I237. A planner
            clicking "12 bookings" is asking to see those twelve.
          */}
          <Counter
            label="Bookings"
            value={plannerOverview?.bookings.total ?? 0}
            to="/bookings"
          />
          <Counter
            label="Held in escrow"
            value={`₹${Number(plannerOverview?.escrowHeld ?? 0).toLocaleString('en-IN')}`}
            to="/accounts"
          />
          {/*
            Straight to the overdue tasks themselves.

            This pointed at My Clients, which is a list of couples and does not
            mention a task -- a planner clicking "3 overdue" was shown their
            client list and left to work out which three (EZ1-I230). The
            deadlines panel below is already on this page and already holds
            them, so the tile filters that panel to the overdue ones and takes
            the planner to it.
          */}
          <Counter
            label="Overdue tasks"
            value={plannerOverview?.tasks.overdue ?? 0}
            to="/tasks?status=overdue"
            tone={(plannerOverview?.tasks.overdue ?? 0) > 0 ? 'text-red-600' : undefined}
          />
        </div>
      )}

      {/*
        The planner's action band. A planner opens the app to answer the
        couples waiting on them and to keep their weddings moving, not to look
        at a shop window — so the things that need them come first, each with the
        one action that clears it (EZ1-I39).
      */}
      {isPlanner && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-gray-500">Action required</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <Counter
              label="Requests to answer"
              value={plannerRequests}
              to="/my-clients/requests"
              tone={plannerRequests > 0 ? 'text-amber-700' : undefined}
            />
            <Counter label="Active weddings" value={activeClients} to="/weddings?status=active" />
            <Counter label="Upcoming weddings" value={upcomingClients} to="/weddings?status=upcoming" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link className="btn" to="/bookings">
              Review requests
            </Link>
            <Link className="btn-outline" to="/tasks">
              Manage tasks
            </Link>
            <Link className="btn-outline" to="/availability">
              Set availability
            </Link>
            <Link className="btn-outline" to="/my-clients">
              View clients
            </Link>
          </div>

          {/* What is actually coming and what is actually due — the two lists a
              planner opens the app to see, not just their counts (EZ1-I52). */}
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <div className="card">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="section-title text-sm">Upcoming weddings</h3>
                <Link className="text-xs text-brand-dark hover:underline" to="/weddings">
                  Open weddings
                </Link>
              </div>
              {upcomingWeddings.length === 0 ? (
                <p className="mt-1 text-sm text-gray-500">No dated weddings yet.</p>
              ) : (
                <ul className="mt-2 divide-y">
                  {upcomingWeddings.map((c) => (
                    <li key={c.userId} className="py-1.5 text-sm">
                      <Link className="text-brand-dark hover:underline" to={`/my-clients/${c.userId}`}>
                        {c.name}
                      </Link>
                      <span className="text-gray-500">
                        {' · '}
                        {new Date(c.weddingDate as string).toLocaleDateString()}
                        {c.location ? ` · ${c.location}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="card" id="planner-tasks">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="section-title text-sm">
                  {overdueOnly ? 'Overdue tasks' : 'Tasks & deadlines'}
                </h3>
                {overdueOnly && (
                  <Link className="text-xs text-brand-dark hover:underline" to="/">
                    Show everything due
                  </Link>
                )}
              </div>
              {shownTasks.length === 0 ? (
                <p className="mt-1 text-sm text-gray-500">
                  {overdueOnly ? 'Nothing overdue.' : 'Nothing due across your weddings.'}
                </p>
              ) : (
                <ul className="mt-2 divide-y">
                  {shownTasks.slice(0, overdueOnly ? 50 : 6).map((t) => (
                    <li key={t.id} className="flex items-baseline justify-between gap-2 py-1.5 text-sm">
                      <span className="truncate">
                        <span className="text-gray-800">{t.title}</span>
                        <span className="text-gray-400"> · {t.clientName}</span>
                      </span>
                      {t.dueDate && (
                        <span
                          className={`shrink-0 text-xs ${
                            t.overdue ? 'font-medium text-red-600' : 'text-gray-500'
                          }`}
                        >
                          {t.overdue ? 'overdue · ' : ''}
                          {new Date(t.dueDate).toLocaleDateString()}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      <AppDownloadCard />
    </div>
  );
}

type OfficerAvailabilityStatus = 'available' | 'on_leave' | 'unavailable';

function OfficerAvailability() {
  const [status, setStatus] = useState<OfficerAvailabilityStatus>('available');
  const [leaveFrom, setLeaveFrom] = useState('');
  const [leaveTo, setLeaveTo] = useState('');
  const [seeded, setSeeded] = useState(false);
  const [notice, setNotice] = useState('');
  const availability = useQuery({
    queryKey: ['my-availability'],
    queryFn: async () => (await api.get('/verification/officers/me/availability')).data as { status: OfficerAvailabilityStatus; leaveFrom?: string | null; leaveTo?: string | null },
    retry: false,
  });
  useEffect(() => {
    if (availability.data && !seeded) { setStatus(availability.data.status); setLeaveFrom(availability.data.leaveFrom ?? ''); setLeaveTo(availability.data.leaveTo ?? ''); setSeeded(true); }
  }, [availability.data, seeded]);
  async function save() {
    await api.put('/verification/officers/me/availability', {
      status,
      ...(status === 'on_leave' ? { leaveFrom, leaveTo } : {}),
    });
    await availability.refetch();
    setNotice('Availability updated.');
  }
  return <div className="card flex flex-wrap items-end gap-3">
    <div className="min-w-52 flex-1"><h2 className="section-title">My availability</h2><p className="mt-1 text-sm text-gray-600">Set your fieldwork status before new visits are allocated.</p></div>
    <label className="text-sm"><span className="mb-1 block text-gray-600">Status</span><select className="input" value={status} onChange={(e) => setStatus(e.target.value as OfficerAvailabilityStatus)}><option value="available">Available</option><option value="on_leave">On leave</option><option value="unavailable">Unavailable</option></select></label>
    {status === 'on_leave' && <><label className="text-sm"><span className="mb-1 block text-gray-600">From</span><input className="input" type="date" value={leaveFrom} onChange={(e) => setLeaveFrom(e.target.value)} /></label><label className="text-sm"><span className="mb-1 block text-gray-600">To</span><input className="input" type="date" value={leaveTo} min={leaveFrom} onChange={(e) => setLeaveTo(e.target.value)} /></label></>}
    <button className="btn" disabled={status === 'on_leave' && (!leaveFrom || !leaveTo)} onClick={() => void save()}>Save availability</button>
    {notice && <p className="w-full text-sm text-positive-fg">{notice}</p>}
  </div>;
}

/** Time of day, from the browser. Nothing about it needs a round trip. */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** One of today's scheduled visits on the officer dashboard (EZ1-I200). */
function TodayVisit({ visit }: { visit: Visit }) {
  const canStart = visit.status === 'assigned' || visit.status === 'additional_review';
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface-sunken p-3">
      <div className="min-w-0">
        <p className="truncate font-medium capitalize text-gray-900">
          {visit.applicantType} verification
          {visit.subjectName ? <span className="text-gray-500"> — {visit.subjectName}</span> : null}
        </p>
        <p className="text-xs text-gray-500">
          {visit.applicantCity ?? 'Location not set'} · {scheduledLabel(visit.slaDeadline)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`rounded-sm px-2 py-0.5 text-xs font-medium ${
            VISIT_TONE[visit.status] ?? 'bg-gray-100 text-gray-600'
          }`}
        >
          {VERIFICATION_LABEL[visit.status] ?? visit.status.replace(/_/g, ' ')}
        </span>
        <Link className={canStart ? 'btn btn-sm' : 'btn-outline btn-sm'} to="/verification">
          {canStart ? 'Start' : 'View'}
        </Link>
      </div>
    </div>
  );
}

function Counter({
  label,
  value,
  to,
  tone,
}: {
  label: string;
  value: ReactNode;
  to: string;
  /** Set only when the number means somebody has to do something. */
  tone?: string;
}) {
  return (
    <AnimatedCard intensity="low" className="h-full">
      <Link
        to={to}
        className="group block h-full rounded-lg border border-gray-200 bg-surface p-4 transition-[border-color,box-shadow] duration-200 hover:border-gray-300 hover:shadow-card"
      >
        <p className="truncate text-[0.8125rem] text-gray-500">{label}</p>
        <p className={`mt-1.5 font-mono text-[1.75rem] font-medium leading-none tracking-[-0.02em] ${tone ?? 'text-gray-900'}`}>
          {typeof value === 'number' ? <AnimatedCounter value={value} /> : value}
        </p>
      </Link>
    </AnimatedCard>
  );
}

function PlannerMetric({
  label,
  value,
  to,
  tone,
}: {
  label: string;
  value: ReactNode;
  to: string;
  tone: string;
}) {
  return (
    <AnimatedCard intensity="medium" className="h-full">
      <Link
        to={to}
        className={`group block h-full rounded-lg border border-gray-200 bg-gradient-to-br ${tone} p-4 shadow-sm transition-all duration-200 hover:border-gray-300 hover:shadow-card`}
      >
        <p className="truncate text-[0.8125rem] font-medium text-gray-600">{label}</p>
        <p className="mt-2 font-mono text-[1.75rem] font-medium leading-none text-gray-900">{typeof value === 'number' ? <AnimatedCounter value={value} /> : value}</p>
      </Link>
    </AnimatedCard>
  );
}

function OfficerMetric({
  label,
  value,
  to,
  icon: Icon,
  gradient,
}: {
  label: string;
  value: ReactNode;
  to: string;
  icon: typeof Bell;
  gradient: string;
}) {
  return (
    <AnimatedCard intensity="low" className="h-full">
      <Link
        to={to}
        className={`group block h-full rounded-lg border border-gray-200 bg-gradient-to-br ${gradient} p-4 shadow-sm transition-all duration-200 hover:border-gray-300 hover:shadow-card`}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="truncate text-[0.8125rem] font-medium text-gray-600">{label}</p>
          <Icon size={20} weight="duotone" className="shrink-0 text-brand-dark" aria-hidden />
        </div>
        <p className="mt-2 font-mono text-[1.75rem] font-medium leading-none text-gray-900">{typeof value === 'number' ? <AnimatedCounter value={value} /> : value}</p>
      </Link>
    </AnimatedCard>
  );
}

function money(value?: string, currency = 'INR') {
  return `${currency === 'INR' ? '₹' : ''}${Number(value ?? 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function AgentMetric({ label, value, to, icon: Icon, gradient }: {
  label: string;
  value: ReactNode;
  to: string;
  icon: any;
  gradient: string;
}) {
  return (
    <AnimatedCard intensity="medium" className="h-full">
      <Link
        to={to}
        className={`group block h-full rounded-lg border border-gray-200 bg-gradient-to-br ${gradient} p-4 shadow-sm transition-all duration-200 hover:border-gray-300 hover:shadow-card`}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="truncate text-[0.8125rem] font-medium text-gray-600">{label}</p>
          <Icon size={20} weight="duotone" className="shrink-0 text-brand-dark" aria-hidden />
        </div>
        <p className="mt-2 font-mono text-[1.75rem] font-medium leading-none text-gray-900">{typeof value === 'number' ? <AnimatedCounter value={value} /> : value}</p>
      </Link>
    </AnimatedCard>
  );
}
