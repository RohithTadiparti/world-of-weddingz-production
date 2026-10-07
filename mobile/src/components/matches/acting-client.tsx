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
 * Which client an agency, or which relative a family member, is acting for on
 * Matches and Interests.
 *
 * The server answers both only for a named profile, and without one the
 * screens showed its developer message ("pass profileId"). Held in a store so a
 * client chosen on Matches is still chosen on Interests. A family account is
 * the parent, not the bride or groom, so it never matches as itself either.
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
  const isFamily = useAuth((s) => s.user?.role) === 'family';
  const choosesProfile = isAgent || isFamily;
  const chosen = useActingClientStore((s) => s.profileId);
  const setProfileId = useActingClientStore((s) => s.set);

  const clients = useQuery({
    queryKey: ['actable-profiles'],
    queryFn: async () => {
      const data = (await api.get('/agents/profiles/actable')).data;
      return (Array.isArray(data) ? data : (data?.data ?? [])) as ActableProfile[];
    },
    enabled: choosesProfile,
    retry: false,
  });

  const list = clients.data ?? [];
  // Only a client this account can still act for — a choice left over from
  // another sign-in on the same device is not one. A family looking after one
  // relative has nothing to choose, so that one is taken.
  const profileId = !choosesProfile
    ? null
    : list.some((c) => c.id === chosen)
      ? chosen
      : isFamily && list.length === 1
        ? list[0].id
        : null;

  return {
    isAgent,
    isFamily,
    choosesProfile,
    clients: list,
    clientsLoading: choosesProfile && clients.isLoading,
    clientsError: clients.error,
    profileId,
    setProfileId,
    /** False while an agency or family has not said whose profile this is for. */
    ready: !choosesProfile || Boolean(profileId),
  };
}

export function ActingClientPicker({ acting }: { acting: ReturnType<typeof useActingClient> }) {
  if (!acting.choosesProfile) return null;
  if (acting.clientsError) {
    return (
      <Caption tone="faint">
        {apiMessage(
          acting.clientsError,
          acting.isFamily
            ? 'Your family profiles could not be loaded.'
            : 'Your client profiles could not be loaded.',
        )}
      </Caption>
    );
  }
  if (!acting.clientsLoading && acting.clients.length === 0) {
    return (
      <Caption tone="faint">
        {acting.isFamily
          ? 'No family profiles yet. Add your son, daughter or relative on the website under Family Profiles.'
          : 'No client profiles yet, so there is nobody to act for.'}
      </Caption>
    );
  }
  return (
    <View style={{ gap: space(1) }}>
      <Caption tone="faint">{acting.isFamily ? 'Finding matches for' : 'Acting for'}</Caption>
      <FilterChips
        options={acting.clients.map((c) => ({ key: c.id, label: c.displayName }))}
        value={acting.profileId}
        onChange={acting.setProfileId}
      />
    </View>
  );
}
