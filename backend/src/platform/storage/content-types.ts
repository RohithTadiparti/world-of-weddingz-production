/** What a browser is told a file is, from its extension. */
export const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  // Chrome on Windows writes ordinary JPEGs under this extension. Serving it
  // as octet-stream makes the browser download the photograph instead of
  // showing it, which reads as "the upload did not work".
  jfif: 'image/jpeg',
  pjpeg: 'image/jpeg',
  png: 'image/png',
  apng: 'image/apng',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  '3gp': 'video/3gpp',
  pdf: 'application/pdf',
};

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** The content type a stored object is served as, decided by its key alone. */
export function contentTypeFor(key: string): string {
  return CONTENT_TYPES[extensionOf(key)] ?? 'application/octet-stream';
}

/** `image`, `video` or `application` — the part that must agree with the name. */
function family(contentType: string): string {
  return contentType.split('/')[0].toLowerCase();
}

/**
 * Whether a content type a client reports is one it may upload under this name.
 *
 * Judged on the family rather than the exact type, because devices disagree
 * about the details — a JFIF arrives as `image/jpeg`, a HEIC as `image/heic` or
 * `image/heif` — while never disagreeing about whether it is an image. What is
 * refused is the mismatch that matters: an HTML page uploaded as `photo.jpg`.
 */
export function contentTypeFits(key: string, contentType: string): boolean {
  const expected = CONTENT_TYPES[extensionOf(key)];
  if (!expected) return false;
  if (!/^(image|video)\/[a-z0-9.+-]{1,64}$|^application\/pdf$/i.test(contentType)) return false;
  return family(contentType) === family(expected);
}
