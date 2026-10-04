import { useQuery } from '@tanstack/react-query';

import { api } from '@/lib/api';

/**
 * Whether matchmaking is open for a profile, and why not when it is closed.
 *
 * The same rule as the web client's matchmaking gate. Matches asked for
 * suggestions regardless, so a profile that was incomplete or had already fixed
 * its match got a refusal from the server instead of the reason.
 */
export interface MatchStatus {
  profileId: string;
  profileCompleted: boolean;
  matchFixedState: string;
}

export interface BiodataCompletion {
  complete: boolean;
  percent: number;
  missing: string[];
}

export function matchmakingGate(status?: MatchStatus, biodata?: BiodataCompletion): string | undefined {
  if (!status || !biodata) return undefined;
  if (!status.profileCompleted || !biodata.complete) {
    return 'Complete the profile first — basic details, preferences and at least one photo.';
  }
  if (status.matchFixedState === 'confirmed') {
    return 'This profile has a fixed match, so matchmaking is closed.';
  }
  return undefined;
}

/** `profileId` is the client an agency acts for; null asks about your own profile. */
export function useMatchmakingGate(profileId: string | null, enabled: boolean) {
  const query = useQuery({
    queryKey: ['match-status', profileId ?? 'self'],
    queryFn: async () =>
      (await api.get('/matches/status', { params: profileId ? { profileId } : {} }))
        .data as MatchStatus,
    enabled,
    retry: false,
  });

  const effectiveProfileId = query.data?.profileId;

  const completionQuery = useQuery({
    queryKey: ['biodata-completion', effectiveProfileId],
    queryFn: async () =>
      (await api.get(`/profiles/${effectiveProfileId}/details/completion`)).data as BiodataCompletion,
    enabled: enabled && Boolean(effectiveProfileId),
    retry: false,
  });

  const hasError = query.isError || completionQuery.isError;
  const gateMessage = hasError
    ? 'Complete the profile first — basic details, preferences and at least one photo.'
    : matchmakingGate(query.data, completionQuery.data);

  return {
    status: query.data,
    biodata: completionQuery.data,
    gate: gateMessage,
    /** Answered either way, so a failed status check does not hold the list back. */
    settled: (query.isFetched || query.isError) && (completionQuery.isFetched || completionQuery.isError),
  };
}
