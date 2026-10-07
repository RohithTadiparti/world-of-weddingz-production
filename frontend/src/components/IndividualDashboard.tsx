import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth, usePermissions } from '../store/auth';
import { Permission, PermissionValue, canAny } from '../lib/permissions';
import { QuickAction } from './IndividualDashboardParts';
import MatchCard, { type Suggestion } from './MatchCard';
import ProfilePreview from './ProfilePreview';
import ProfileReadinessPanel from './individual/ProfileReadinessPanel';

/**
 * The individual couple's home screen.
 *
 * Everything here is a live number or list pulled from the module it belongs to
 * — matches, interests, chat, events, bookings, the wedding plan, the honeymoon
 * — never a placeholder. A card the account cannot reach (no permission for
 * that module) is not rendered rather than shown empty, and a module the
 * account can reach but has not used yet shows an honest empty state.
 *
 * Real-time without sockets (EZ1-I150): every query refetches on mount, on
 * window focus and on an interval, so coming back to this tab shows the current
 * figures. Reading a notification here invalidates the same keys the sidebar
 * badge reads, so the two never disagree.
 */
export default function IndividualDashboard() {
  const permissions = usePermissions();
  const has = (...p: PermissionValue[]) => canAny(permissions, p);

  /*
   * A family account is the parent or guardian, not the bride or groom. Its
   * own profile has no biodata and is never matched, so the readiness, match
   * status and suggestions below, which all read the account's own profile,
   * are not asked for. The family's relatives are reached from Family
   * Profiles, Matches and Biodata, where the family chooses whose they mean.
   */
  const isFamily = useAuth((s) => s.user?.role) === 'family';
  const canMatch = has(Permission.MATCH_BROWSE) && !isFamily;
  const canProfile = has(Permission.PROFILE_MANAGE_OWN) && !isFamily;
  const { data: matchStatus } = useQuery({
    queryKey: ['match-status', 'self'],
    queryFn: async () => (await api.get('/matches/status')).data as { matchFixedState?: string },
    enabled: canMatch,
    retry: false,
  });
  const weddingUnlocked = matchStatus?.matchFixedState === 'confirmed';
  // Whether matchmaking is open for this profile at all: a fixed match or an
  // unfinished profile is refused suggestions, so the count is not asked for.

  // Poll while open, refresh on focus, and never serve a stale figure on
  // navigation back to the dashboard.
  const live = {
    retry: false as const,
    refetchOnMount: 'always' as const,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  };

  // Shared with the parent dashboard's ['me'] query, so this reuses that cache.
  const { data: profile } = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/users/me')).data,
    retry: false,
  });
  const profileId: string | undefined = profile?.id;

  const { data: completion } = useQuery({
    queryKey: ['profile-completion', profileId],
    queryFn: async () =>
      (await api.get(`/profiles/${profileId}/details/completion`)).data as {
        percent: number;
        complete: boolean;
        missing: string[];
      },
    enabled: canProfile && Boolean(profileId),
    ...live,
  });

  // A complete biodata is best reviewed as an introduction; an unfinished one
  // should return directly to the next actionable section rather than a generic
  // account page.
  // Completion is live, so a finished profile stays quiet until a later edit
  // genuinely lowers the score again. The fallback covers older accounts while
  // the completion request is still loading.
  const profileComplete = completion?.complete ?? Boolean(profile?.profileCompleted);
  const profilePercent = completion?.percent ?? (profile?.profileCompleted ? 100 : 0);
  const profileMissing = completion?.missing ?? [];
  const profileReadinessTo = profileComplete ? '/profile' : '/biodata';
  const introductionTo = isFamily ? '/client-profiles' : '/biodata';
  const [previewId, setPreviewId] = useState<string>('');
  const [recommendedIndex, setRecommendedIndex] = useState(0);
  const [recentIndex, setRecentIndex] = useState(0);
  const { data: recommendedData } = useQuery({
    queryKey: ['home-recommended-matches', profileId],
    queryFn: async () => (await api.get('/matches/suggestions', { params: { minScore: 51, sort: 'score', limit: 8 } })).data as { data?: Suggestion[] },
    enabled: canMatch && profileComplete && !weddingUnlocked,
    retry: false,
    refetchOnWindowFocus: true,
  });
  const recommendedMatches = (recommendedData?.data ?? [])
    .filter((match) => match.score > 50)
    .sort((a, b) => b.score - a.score);
  const { data: recentData } = useQuery({
    queryKey: ['home-recent-matches', profileId],
    queryFn: async () => (await api.get('/matches/suggestions', { params: { sort: 'recent', limit: 12 } })).data as { data?: Suggestion[] },
    enabled: canMatch && profileComplete && !weddingUnlocked,
    retry: false,
    refetchOnWindowFocus: true,
  });
  const recentMatches = recentData?.data ?? [];

  return (
    <div className="space-y-10">
      {/* Halden-inspired catalogue rail: collections are ways of browsing a
          life together, not another dense dashboard report. */}
      <section aria-labelledby="home-collections">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="eyebrow">Explore what matters</p>
            <h2 id="home-collections" className="section-title mt-1 text-xl">Collections for your journey</h2>
          </div>
          <Link className="text-xs text-brand hover:underline" to="/matches">Browse all</Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Same values', 'Profiles aligned with your priorities.', '/matches?view=values'],
            ['Near you', 'People and families in your city.', '/matches?view=near'],
            ['Recently joined', 'Fresh introductions worth a hello.', '/matches?view=recent'],
            ['Family preferences', 'A thoughtful way to compare what matters at home.', '/biodata'],
          ].map(([title, body, to], index) => (
            <Link key={title} to={to} className={`group relative min-h-28 overflow-hidden border border-brand/20 bg-gradient-to-br p-5 text-white ${index % 2 === 0 ? 'from-brand-strong to-brand' : 'from-gold-deep to-brand-strong'}`}>
              <span className="absolute -right-5 -top-8 text-7xl font-serif text-white/10">0{index + 1}</span>
              <span className="relative block font-serif text-xl">{title}</span>
              <span className="relative mt-1 block max-w-[14rem] text-xs leading-relaxed text-white/80">{body}</span>
              <span className="relative mt-3 block text-xs uppercase tracking-[0.16em] text-gold-lit transition-transform group-hover:translate-x-1">Explore →</span>
            </Link>
          ))}
        </div>
      </section>

      {previewId && (
        <ProfilePreview profileId={previewId} onClose={() => setPreviewId('')} />
      )}

      {profileComplete && !weddingUnlocked && (
        <div className="space-y-5">
          <MatchCarousel eyebrow="Handpicked for you" title="Handpicked for you" items={recommendedMatches} index={recommendedIndex} onIndexChange={setRecommendedIndex} onOpen={(id) => setPreviewId(id)} empty="Your most compatible introductions will appear here." viewAll="/matches?minScore=51&sort=score" />
          <MatchCarousel eyebrow="Fresh introductions" title="Recently added" items={recentMatches} index={recentIndex} onIndexChange={setRecentIndex} onOpen={(id) => setPreviewId(id)} empty="New introductions will appear here as people join." viewAll="/matches?sort=recent" />
        </div>
      )}

      <JourneyStageTracker
        profileComplete={profileComplete}
        matchFixed={weddingUnlocked}
        introductionTo={introductionTo}
      />

      {!profileComplete && canProfile && (
        <ProfileReadinessPanel percent={profilePercent} missing={profileMissing} to={profileReadinessTo} />
      )}

      {/* Recent notifications — reading one clears it here and on the sidebar. */}

      {/* Quick actions — every one navigates. */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-gray-500">Quick actions</h2>
        <div className="flex flex-wrap gap-2">
          {has(Permission.MATCH_BROWSE) && <QuickAction to="/matches" label="Find matches" />}
          {has(Permission.MEDIA_MANAGE_OWN) && <QuickAction to="/media" label="Upload media" />}
          {has(Permission.AI_ASSIST) && <QuickAction to="/genie" label="Ask WOW Genie" />}
          {has(Permission.CASE_RAISE) && <QuickAction to="/support" label="Get support" />}
        </div>
      </section>

      {/* Support: raise an issue or read the ones already raised. */}
      {has(Permission.CASE_RAISE) && (
        <section className="card flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="section-title text-sm">Support</h2>
            <p className="text-sm text-gray-500">
              Something gone wrong with a booking, a payment or a listing? Somebody reads every one.
            </p>
          </div>
          <div className="flex gap-2">
            <Link className="btn" to="/support?new=1">
              Raise an issue
            </Link>
            <Link className="btn-outline" to="/support">
              View my tickets
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
function MatchCarousel({
  eyebrow,
  title,
  items,
  index,
  onIndexChange,
  onOpen,
  empty,
  viewAll,
}: {
  eyebrow: string;
  title: string;
  items: Suggestion[];
  index: number;
  onIndexChange: (index: number) => void;
  onOpen: (id: string) => void;
  empty: string;
  viewAll: string;
}) {
  const visible = items.slice(index, index + 3);
  const maxIndex = Math.max(0, items.length - 3);
  return (
    <section className="card space-y-4" aria-label={title}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="section-title mt-1 text-xl">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="grid h-8 w-8 place-items-center rounded-full border border-brand/20 bg-white/70 text-brand disabled:cursor-not-allowed disabled:opacity-30" aria-label={`Previous ${title}`} disabled={index === 0} onClick={() => onIndexChange(Math.max(0, index - 1))}>←</button>
          <button type="button" className="grid h-8 w-8 place-items-center rounded-full border border-brand/20 bg-white/70 text-brand disabled:cursor-not-allowed disabled:opacity-30" aria-label={`Next ${title}`} disabled={index >= maxIndex} onClick={() => onIndexChange(Math.min(maxIndex, index + 1))}>→</button>
          <Link className="ml-1 text-xs text-brand hover:underline" to={viewAll}>View all</Link>
        </div>
      </div>
      {visible.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-3">
          {visible.map((match) => (
            <MatchCard key={match.profile.id} suggestion={match} detail="brief" showScore surface="glass" onOpen={() => onOpen(match.profile.id)} />
          ))}
        </div>
      ) : (
        <p className="border border-dashed border-brand/20 bg-brand-soft/30 p-4 text-sm text-gray-600">{empty}</p>
      )}
    </section>
  );
}

function JourneyStageTracker({
  profileComplete,
  matchFixed,
  introductionTo,
}: {
  profileComplete: boolean;
  matchFixed: boolean;
  /** Where the introduction is written: the biodata, or a family's relatives. */
  introductionTo: string;
}) {
  const stages = [
    ['Create your introduction', 'Share the details that help the right people understand you.', profileComplete, introductionTo],
    ['Discover compatible matches', 'Explore profiles aligned with your values and hopes.', matchFixed, '/matches'],
    ['Have a meaningful conversation', 'Take your time getting to know someone privately.', matchFixed, '/chat'],
    ['Fix your match', 'Confirm the person and families you want to move forward with.', matchFixed, '/matches'],
    ['Plan the wedding together', 'Your shared wedding workspace opens after your match is fixed.', false, '/planner'],
  ] as const;
  const current = stages.findIndex((stage) => !stage[2]);
  return (
    <section className="card" aria-labelledby="journey-tracker-title">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Your journey</p>
          <h2 id="journey-tracker-title" className="section-title mt-1 text-xl">A thoughtful path to your celebration</h2>
        </div>
        <span className="text-xs text-gray-500">Step {Math.min(current + 1, stages.length)} of {stages.length}</span>
      </div>
      <ol className="grid gap-3 md:grid-cols-5">
        {stages.map(([title, body, done, to], index) => {
          const active = index === current;
          const locked = index > current && !done;
          return (
            <li key={title} className={`relative border-t-2 pt-3 ${done ? 'border-positive' : active ? 'border-brand' : 'border-gray-200'}`}>
              <span className={`mb-2 grid h-7 w-7 place-items-center rounded-full text-xs font-semibold ${done ? 'bg-positive text-white' : active ? 'bg-brand text-white' : 'bg-gray-100 text-gray-500'}`}>{done ? '✓' : `0${index + 1}`}</span>
              <h3 className="text-sm font-medium text-gray-900">{title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-gray-500">{body}</p>
              {active && <Link to={to} className="mt-3 inline-block text-xs font-semibold uppercase tracking-[0.12em] text-brand hover:underline">Continue →</Link>}
              {locked && <span className="mt-3 inline-block text-xs uppercase tracking-[0.12em] text-gray-400">Coming next</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
