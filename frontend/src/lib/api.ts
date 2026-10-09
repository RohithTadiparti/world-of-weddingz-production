import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { useAuth } from '../store/auth';
import { newRequestId, reportClientError } from './client-errors';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  // The refresh token is an httpOnly cookie, so every request must carry
  // credentials for the silent-refresh flow to work.
  withCredentials: true,
});

// Attach the access token to every request.
api.interceptors.request.use((config) => {
  config.headers['X-Request-ID'] = config.headers['X-Request-ID'] || newRequestId();
  const token = useAuth.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/**
 * Single-flight refresh. Several requests can 401 at once when a short-lived
 * access token expires; without this they would each fire their own refresh and
 * race to rotate the token — which the server now treats as reuse and punishes
 * by revoking the whole session family.
 */
let refreshing: Promise<string | null> | null = null;

/** The server's code for "another request rotated this token a moment ago". */
const REFRESH_SUPERSEDED = 'REFRESH_SUPERSEDED';

function postRefresh() {
  // A bare axios call, so this request does not recurse through the
  // interceptor with the stale access token attached. The cookie travels
  // automatically.
  return axios.post(`${api.defaults.baseURL}/auth/refresh`, {}, { withCredentials: true });
}

function isSuperseded(err: unknown): boolean {
  const e = err as AxiosError<{ error?: { code?: string } }>;
  return e?.response?.status === 401 && e.response.data?.error?.code === REFRESH_SUPERSEDED;
}

/**
 * Tabs share one cookie, so two tabs refreshing at once would present the same
 * token twice. Where the browser has Web Locks the refreshes are serialised
 * across tabs: the second runs after the first has stored the new cookie.
 */
function acrossTabs<T>(work: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? (locks.request('wow-auth-refresh', work) as Promise<T>) : work();
}

async function refreshAccessToken(): Promise<string | null> {
  const { setAuth, clear } = useAuth.getState();
  try {
    let response;
    try {
      response = await acrossTabs(postRefresh);
    } catch (err) {
      // Lost a race the lock could not see (an older browser, or a reload
      // mid-refresh). The server refused without ending the login, and the
      // winner's cookie should be in the jar now, so try once more with it.
      if (!isSuperseded(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 300));
      response = await acrossTabs(postRefresh);
    }
    setAuth(response.data);
    return response.data.accessToken as string;
  } catch {
    // Refused (expired, revoked, or reuse detected): sign out here cleanly so
    // the next screen is the login page, not a loop of failing requests.
    clear();
    return null;
  }
}

/**
 * The refresh in flight, shared. Start-up and every 401 go through here, so a
 * request that fails while the session is still being restored waits for that
 * refresh instead of sending the same cookie a second time, which the server
 * reads as a stolen token and answers by ending the login.
 */
function refreshOnce(): Promise<string | null> {
  refreshing =
    refreshing ??
    refreshAccessToken().finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/**
 * Called once at start-up. If the refresh cookie is still valid the session is
 * restored without the user signing in again; otherwise they land on /login.
 */
export async function bootstrapSession(): Promise<void> {
  const token = await refreshOnce();
  if (!token) useAuth.getState().setReady(true);
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retried?: boolean };
    const url = original?.url ?? '';

    // Only a 401 is a token problem. A 403 means the account genuinely lacks the
    // permission, and refreshing would not change that — leave the caller to
    // surface the message rather than silently signing the user out.
    const isAuthRoute =
      url.includes('/auth/login') ||
      url.includes('/auth/refresh') ||
      url.includes('/auth/invitations');

    if (error.response?.status === 401 && original && !original._retried && !isAuthRoute) {
      original._retried = true;
      const token = await refreshOnce();
      if (token) {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      }
    }

    const status = error.response?.status;
    if ((!status || status >= 500) && !url.includes('/telemetry/client-errors')) {
      reportClientError({
        category: status ? 'server' : 'network',
        message: status ? `API request failed with ${status}` : 'API request failed without a response',
        route: url,
        requestId: String(original?.headers?.['X-Request-ID'] ?? ''),
      });
    }

    return Promise.reject(error);
  },
);

export { apiMessage, isConflict } from './api-errors';
