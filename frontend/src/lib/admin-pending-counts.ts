import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { api } from './api';
import { useAuth } from '../store/auth';

export interface AdminPendingCounts {
  users: number;
  agents: number;
  vendors: number;
  verificationOfficers: number;
  weddingPlanners: number;
  bookings: number;
  payments: number;
  verification: number;
  support: number;
  reports: number;
  notifications: number;
}

const EMPTY_COUNTS: AdminPendingCounts = {
  users: 0,
  agents: 0,
  vendors: 0,
  verificationOfficers: 0,
  weddingPlanners: 0,
  bookings: 0,
  payments: 0,
  verification: 0,
  support: 0,
  reports: 0,
  notifications: 0,
};

function socketOrigin(): string | undefined {
  const configured = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api') as string;
  return configured.replace(/\/api\/?$/, '');
}

export function useAdminPendingCounts(enabled: boolean) {
  const token = useAuth((state) => state.accessToken);
  const [connected, setConnected] = useState(false);
  const query = useQuery<AdminPendingCounts>({
    queryKey: ['admin-pending-counts'],
    queryFn: async () => (await api.get('/admin/pending-counts')).data,
    enabled,
    retry: false,
    refetchInterval: enabled && !connected ? 15000 : false,
  });

  useEffect(() => {
    if (!enabled || !token) return undefined;
    const socket = io(`${socketOrigin()}/admin`, {
      auth: { token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      timeout: 5000,
    });
    const refresh = () => void query.refetch();
    socket.on('connect', () => {
      setConnected(true);
      refresh();
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on('counts:changed', refresh);
    return () => {
      setConnected(false);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [enabled, token, query.refetch]);

  return { counts: query.data ?? EMPTY_COUNTS, isLoading: query.isLoading, connected };
}
