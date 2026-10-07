import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '../store/auth';
import { socketOrigin } from './socket-origin';

export type CallState = 'idle' | 'ringing' | 'incoming' | 'connecting' | 'active' | 'ended';

export interface IncomingCall {
  fromUserId: string;
  sdp: string;
  media: 'audio' | 'video';
}

interface Signal {
  fromUserId: string;
  sdp?: string;
  candidate?: RTCIceCandidateInit;
  reason?: string;
}

/**
 * How long a signalling request may go unanswered. Without a limit, a request
 * made while the socket is down is buffered indefinitely, and the caller sits
 * on "Ringing…" for a call that never left the browser.
 */
export const SIGNAL_TIMEOUT_MS = 10_000;

/** Public STUN, used when the server's own ICE configuration cannot be had. */
export const FALLBACK_ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302'] }];

/** The ICE servers in a signalling reply, or the public fallback. */
export function iceServersFrom(reply: unknown): RTCIceServer[] {
  const servers = (reply as { iceServers?: unknown } | null | undefined)?.iceServers;
  return Array.isArray(servers) && servers.length > 0
    ? (servers as RTCIceServer[])
    : FALLBACK_ICE_SERVERS;
}

const OFFLINE = 'Calling is not connected right now. Check your connection and try again.';

/**
 * Voice and video between two people who have matched.
 *
 * The media never touches our server: the two browsers negotiate through the
 * socket and then talk directly. That is the only way calling is affordable —
 * a relay carrying every call's audio is a bandwidth bill that grows with usage
 * rather than with revenue.
 *
 * The consequence is that some calls will not connect. Roughly one network in
 * ten sits behind a NAT that peer-to-peer cannot traverse, and those need a
 * TURN relay, which costs money precisely because it does carry the audio. The
 * server hands its ICE configuration back on the offer, so adding TURN later is
 * a deployment change and nothing here has to move. Until then, `failed` is
 * reported plainly rather than leaving somebody staring at a connecting screen.
 */
export function useCall(enabled = true) {
  const token = useAuth((s) => s.accessToken);
  const userId = useAuth((s) => s.user?.id ?? null);
  const signedIn = Boolean(token);
  // Read at every (re)connect, so a refreshed access token is used without
  // tearing the socket — and any call on it — down.
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const [state, setState] = useState<CallState>('idle');
  const [peerId, setPeerId] = useState<string | null>(null);
  const [media, setMedia] = useState<'audio' | 'video'>('audio');
  const [error, setError] = useState('');
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);

  const socket = useRef<Socket | null>(null);
  const connection = useRef<RTCPeerConnection | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const remoteStream = useRef<MediaStream | null>(null);
  // Fetched before each peer connection is built. A connection created with an
  // empty list gathers only host candidates and cannot leave the local network.
  const iceServers = useRef<RTCIceServer[]>(FALLBACK_ICE_SERVERS);
  // Candidates can arrive before the remote description is set, and adding one
  // then throws. They are queued and flushed once there is something to add
  // them to.
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);

  const teardown = useCallback(() => {
    connection.current?.close();
    connection.current = null;
    localStream.current?.getTracks().forEach((track) => track.stop());
    localStream.current = null;
    remoteStream.current = null;
    pendingCandidates.current = [];
    setPeerId(null);
    setIncoming(null);
  }, []);

  // One socket for the session, owned by the app shell rather than by the chat
  // page: a ring has to reach somebody wherever they are in the app, and
  // reconnecting per call would mean the first ring arriving before the
  // listener exists.
  useEffect(() => {
    if (!enabled || !signedIn || !userId) return undefined;

    const client = io(`${socketOrigin()}/chat`, {
      auth: (cb) => cb({ token: tokenRef.current }),
      transports: ['websocket'],
    });
    socket.current = client;

    client.on('call:incoming', (payload: IncomingCall) => {
      // One call at a time. A second ring while you are already talking is
      // dropped rather than stacking two audio streams on top of each other.
      if (connection.current) {
        client.emit('call:end', { toUserId: payload.fromUserId, reason: 'busy' });
        return;
      }
      setIncoming(payload);
      setPeerId(payload.fromUserId);
      setMedia(payload.media);
      setState('incoming');
    });

    client.on('call:answered', async ({ sdp }: Signal) => {
      if (!connection.current || !sdp) return;
      await connection.current.setRemoteDescription({ type: 'answer', sdp });
      await flushCandidates();
      setState('connecting');
    });

    client.on('call:candidate', async ({ candidate }: Signal) => {
      if (!candidate) return;
      if (!connection.current?.remoteDescription) {
        pendingCandidates.current.push(candidate);
        return;
      }
      await connection.current.addIceCandidate(candidate).catch(() => undefined);
    });

    client.on('call:ended', ({ reason }: Signal) => {
      setError(reason === 'busy' ? 'They are already on a call.' : '');
      teardown();
      setState('ended');
    });

    return () => {
      client.close();
      socket.current = null;
      teardown();
    };
  }, [enabled, signedIn, userId, teardown]);

  // The server drops a socket whose token has expired and does not ask it back.
  // A refreshed token is the moment to reconnect.
  useEffect(() => {
    if (token && socket.current && !socket.current.connected && !socket.current.active) {
      socket.current.connect();
    }
  }, [token]);

  /** The relay configuration for a call with this person. */
  async function loadIceServers(toUserId: string) {
    try {
      const reply = await socket.current
        ?.timeout(SIGNAL_TIMEOUT_MS)
        .emitWithAck('call:ice-servers', { toUserId });
      iceServers.current = iceServersFrom(reply);
    } catch {
      iceServers.current = FALLBACK_ICE_SERVERS;
    }
  }

  async function flushCandidates() {
    const queued = pendingCandidates.current;
    pendingCandidates.current = [];
    for (const candidate of queued) {
      await connection.current?.addIceCandidate(candidate).catch(() => undefined);
    }
  }

  /** Builds the peer connection and wires its events to state. */
  function createConnection(toUserId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: iceServers.current });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.current?.emit('call:candidate', { toUserId, candidate: event.candidate.toJSON() });
      }
    };

    pc.ontrack = (event) => {
      remoteStream.current = event.streams[0];
      setState('active');
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setState('active');
      if (pc.connectionState === 'failed') {
        // Almost always a NAT that peer-to-peer cannot cross. Saying so is more
        // use than a spinner that never resolves.
        setError('The call could not connect on this network. Try messaging instead.');
        teardown();
        setState('ended');
      }
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
        teardown();
        setState('ended');
      }
    };

    connection.current = pc;
    return pc;
  }

  async function capture(kind: 'audio' | 'video'): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: kind === 'video',
    });
    localStream.current = stream;
    return stream;
  }

  /** Ring somebody. */
  const call = useCallback(
    async (toUserId: string, kind: 'audio' | 'video' = 'audio') => {
      setError('');
      setMedia(kind);
      setPeerId(toUserId);
      setState('ringing');

      if (!socket.current?.connected) {
        setError(OFFLINE);
        teardown();
        setState('ended');
        return;
      }

      try {
        await loadIceServers(toUserId);
        const stream = await capture(kind);
        const pc = createConnection(toUserId);
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const reply = await socket.current?.timeout(SIGNAL_TIMEOUT_MS).emitWithAck('call:offer', {
          toUserId,
          sdp: offer.sdp,
          media: kind,
        });

        if (reply?.error) {
          setError(reply.reason ?? reply.error);
          teardown();
          setState('ended');
          return;
        }
      } catch (err) {
        // Overwhelmingly a declined microphone permission, which is worth
        // naming rather than reporting as a failed call.
        setError(
          (err as Error).name === 'NotAllowedError'
            ? 'Your browser blocked access to the microphone.'
            : socket.current?.connected
              ? 'That call could not be started.'
              : OFFLINE,
        );
        teardown();
        setState('ended');
      }
    },
    [teardown],
  );

  /** Pick up. */
  const answer = useCallback(async () => {
    if (!incoming) return;
    setError('');
    setState('connecting');

    try {
      await loadIceServers(incoming.fromUserId);
      const stream = await capture(incoming.media);
      const pc = createConnection(incoming.fromUserId);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      await pc.setRemoteDescription({ type: 'offer', sdp: incoming.sdp });
      await flushCandidates();

      const answerSdp = await pc.createAnswer();
      await pc.setLocalDescription(answerSdp);

      const reply = await socket.current?.timeout(SIGNAL_TIMEOUT_MS).emitWithAck('call:answer', {
        toUserId: incoming.fromUserId,
        sdp: answerSdp.sdp,
      });
      if (reply?.error) throw new Error(reply.error);

      setIncoming(null);
    } catch (err) {
      setError(
        (err as Error).name === 'NotAllowedError'
          ? 'Your browser blocked access to the microphone.'
          : 'That call could not be answered.',
      );
      teardown();
      setState('ended');
    }
  }, [incoming, teardown]);

  /** Hang up, or decline. */
  const hangUp = useCallback(
    (reason = 'ended') => {
      const other = peerId ?? incoming?.fromUserId;
      if (other) socket.current?.emit('call:end', { toUserId: other, reason });
      teardown();
      setState('idle');
    },
    [peerId, incoming, teardown],
  );

  return {
    state,
    media,
    error,
    peerId,
    incoming,
    call,
    answer,
    hangUp,
    localStream: localStream.current,
    remoteStream: remoteStream.current,
  };
}
