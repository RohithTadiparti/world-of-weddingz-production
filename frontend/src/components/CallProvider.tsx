import { createContext, ReactNode, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Permission, canAny } from '../lib/permissions';
import { useCall } from '../lib/useCall';
import { useAuth, usePermissions } from '../store/auth';
import CallPanel from './CallPanel';

export type CallSession = ReturnType<typeof useCall>;

const CallContext = createContext<CallSession | null>(null);

/** The app-wide call, for the controls that start one. */
export function useCallSession(): CallSession {
  const session = useContext(CallContext);
  if (!session) throw new Error('useCallSession must be used inside <CallProvider>');
  return session;
}

/**
 * Calling, for the whole signed-in app.
 *
 * The call socket and the ringing overlay used to live inside the chat page,
 * so a person was reachable only while they had that page open. Everybody else
 * — on their dashboard, browsing matches, reading a profile — never heard the
 * phone, and the caller watched "Ringing…" until they gave up. Mounted once
 * above the routes, the socket survives navigation and an incoming call shows
 * its Answer and Decline wherever the person happens to be.
 *
 * Only accounts the server will let onto the chat socket open one: the
 * handshake refuses anybody without the chat permission, or still holding a
 * temporary password.
 */
export default function CallProvider({ children }: { children: ReactNode }) {
  const permissions = usePermissions();
  const mustResetPassword = useAuth((s) => s.user?.mustResetPassword ?? false);
  const canCall = canAny(permissions, [Permission.CHAT_INQUIRE]) && !mustResetPassword;
  const call = useCall(canCall);

  // Shares the chat page's cache, so a name the inbox already knows costs
  // nothing; fetched here only while there is somebody on the line.
  const { data: conversations = [] } = useQuery<{ withUserId: string; displayName: string }[]>({
    queryKey: ['conversations'],
    queryFn: async () => (await api.get('/chat/conversations')).data,
    enabled: canCall && Boolean(call.peerId),
    retry: false,
  });
  const withName =
    conversations.find((c) => c.withUserId === call.peerId)?.displayName ??
    (call.state === 'incoming' ? 'Someone' : 'them');

  return (
    <CallContext.Provider value={call}>
      {children}
      <CallPanel
        state={call.state}
        media={call.media}
        error={call.error}
        withName={withName}
        localStream={call.localStream}
        remoteStream={call.remoteStream}
        onAnswer={call.answer}
        onHangUp={call.hangUp}
      />
    </CallContext.Provider>
  );
}
