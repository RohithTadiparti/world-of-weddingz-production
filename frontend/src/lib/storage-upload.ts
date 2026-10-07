/**
 * The step of an upload that goes from the browser straight to storage.
 *
 * Its failures used to be reported as "Could not reach the server". A refusal
 * from storage was thrown as a bare Error, the uploader handed that to
 * `apiMessage`, and `apiMessage` read the missing HTTP response as a dead
 * connection. When nginx answered the mock-storage PUT with its own 404 for
 * anything ending in .jpg or .png, every biodata photograph and every wedding
 * invitation card failed with a sentence about the person's internet, which
 * sent the report in exactly the wrong direction. A refusal now says it was a
 * refusal, with the status and the place that gave it.
 */
export class StorageUploadError extends Error {
  constructor(
    message: string,
    /** The HTTP status storage answered with, or null when nothing answered. */
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'StorageUploadError';
  }
}

/**
 * The upload URL as an absolute address.
 *
 * Storage normally hands out an absolute URL, but a relative one (`/api/...`)
 * is a valid upload target for the page that asked. `new URL(relative)` throws,
 * and that throw escaped as yet another "Could not reach the server".
 */
export function resolveUploadUrl(uploadUrl: string, base?: string): URL {
  const fallback = base ?? (typeof window !== 'undefined' ? window.location.href : undefined);
  return new URL(uploadUrl, fallback);
}

type FetchLike = (input: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status'>>;

/** PUTs the file to the presigned URL and throws a StorageUploadError on any failure. */
export async function putToStorage(
  uploadUrl: string,
  file: Blob,
  headers: Record<string, string> = {},
  fetchImpl: FetchLike = fetch,
  base?: string,
): Promise<void> {
  const target = resolveUploadUrl(uploadUrl, base);
  let response: Pick<Response, 'ok' | 'status'>;
  try {
    response = await fetchImpl(target.href, {
      method: 'PUT',
      body: file,
      headers: { ...(file.type ? { 'Content-Type': file.type } : {}), ...headers },
    });
  } catch {
    throw new StorageUploadError(
      `Could not reach storage at ${target.origin}. Check your connection and try again.`,
      null,
    );
  }
  if (response.ok) return;
  if (response.status === 413) {
    throw new StorageUploadError('That file is too large to upload. Choose a smaller one.', 413);
  }
  throw new StorageUploadError(
    `Storage at ${target.origin} refused the file (${response.status}). Try again.`,
    response.status,
  );
}
