import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';

import { api, apiMessage } from '@/lib/api';
import { Permission, can } from '@/shared/permissions';
import { FilterChips } from '@/components/chrome';
import { Caption } from '@/components/ui';
import { selectPermissions, useAuth } from '@/store/auth';
import { space } from '@/theme';

/**
 * Which client an agency is acting for on Matches and Interests.
 *
 * The server answers both only for a named client profile, and without one the
 * screens showed its developer message ("pass profileId"). Held in a store so a
 * client chosen on Matches is still chosen on Interests.
 */
const useActingClientStore = create<{
  profileId: string | null;
  set: (profileId: string | null) => void;
}>((set) => ({
  profileId: null,
  set: (profileId) => set({ profileId }),
}));

interface ActableProfile {
  id: string;
  displayName: string;
}

export function useActingClient() {
  const permissions = useAuth(selectPermissions);
  const isAgent = can(permissions, Permission.AGENCY_MANAGE);
  const chosen = useActingClientStore((s) => s.profileId);
  const setProfileId = useActingClientStore((s) => s.set);

  const clients = useQuery({
    queryKey: ['actable-profiles'],
    queryFn: async () => {
      const data = (await api.get('/agents/profiles/actable')).data;
      return (Array.isArray(data) ? data : (data?.data ?? [])) as ActableProfile[];
    },
    enabled: isAgent,
    retry: false,
  });

  const list = clients.data ?? [];
  // Only a client this account can still act for — a choice left over from
  // another sign-in on the same device is not one.
  const profileId = isAgent && list.some((c) => c.id === chosen) ? chosen : null;

  return {
    isAgent,
    clients: list,
    clientsLoading: isAgent && clients.isLoading,
    clientsError: clients.error,
    profileId,
    setProfileId,
    /** False while an agency has not said which client this is for. */
    ready: !isAgent || Boolean(profileId),
  };
}

export function ActingClientPicker({ acting }: { acting: ReturnType<typeof useActingClient> }) {
  if (!acting.isAgent) return null;
  if (acting.clientsError) {
    return (
      <Caption tone="faint">
        {apiMessage(acting.clientsError, 'Your client profiles could not be loaded.')}
      </Caption>
    );
  }
  if (!acting.clientsLoading && acting.clients.length === 0) {
    return <Caption tone="faint">No client profiles yet, so there is nobody to act for.</Caption>;
  }
  return (
    <View style={{ gap: space(1) }}>
      <Caption tone="faint">Acting for</Caption>
      <FilterChips
        options={acting.clients.map((c) => ({ key: c.id, label: c.displayName }))}
        value={acting.profileId}
        onChange={acting.setProfileId}
      />
    </View>
  );
}
