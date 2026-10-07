import { describe, expect, it } from 'vitest';
import { FALLBACK_ICE_SERVERS, iceServersFrom } from './useCall';

describe('iceServersFrom', () => {
  it('uses the ICE servers the server hands back', () => {
    const servers = [
      { urls: ['stun:stun.example.com:3478'] },
      { urls: ['turn:turn.example.com:3478'], username: 'u', credential: 'c' },
    ];
    expect(iceServersFrom({ iceServers: servers })).toBe(servers);
  });

  it('falls back to public STUN rather than building a host-only connection', () => {
    expect(iceServersFrom(undefined)).toBe(FALLBACK_ICE_SERVERS);
    expect(iceServersFrom({ error: 'Call rejected' })).toBe(FALLBACK_ICE_SERVERS);
    expect(iceServersFrom({ iceServers: [] })).toBe(FALLBACK_ICE_SERVERS);
    expect(FALLBACK_ICE_SERVERS.length).toBeGreaterThan(0);
  });
});
