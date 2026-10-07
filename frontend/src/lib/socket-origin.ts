/**
 * Where the browser opens its Socket.io connections.
 *
 * Derived from the same setting, and the same default, as the HTTP client in
 * `api.ts`: `/api` when nothing is configured, which means same-origin through
 * the nginx proxy. The socket used to default to `http://localhost:3000`
 * instead, so a build without `VITE_API_URL` (the Docker image, whose `.env` is
 * ignored) pointed every signed-in browser at its own machine. HTTP kept
 * working, the socket never connected, and nobody could ring anybody.
 *
 * An empty string is the answer for same-origin: `io('/chat')` connects to the
 * page's own host and namespace, over wss on an https page.
 */
export function socketOrigin(apiUrl: string | undefined = import.meta.env.VITE_API_URL): string {
  return (apiUrl || '/api').replace(/\/api\/?$/, '');
}
