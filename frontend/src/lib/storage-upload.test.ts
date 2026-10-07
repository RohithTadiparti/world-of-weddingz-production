import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { apiMessage } from './api-errors';
import { StorageUploadError, putToStorage, resolveUploadUrl } from './storage-upload';

const PUBLIC_URL =
  'https://test.worldofweddingz.com/api/mock-storage/users/u1/profile/1-abc-card.jpg';

function file(type = 'image/jpeg') {
  return new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type });
}

describe('putToStorage', () => {
  it('PUTs the file with its type and the presigned headers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await putToStorage(PUBLIC_URL, file(), { 'x-amz-acl': 'private' }, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(PUBLIC_URL, {
      method: 'PUT',
      body: expect.any(Blob),
      headers: { 'Content-Type': 'image/jpeg', 'x-amz-acl': 'private' },
    });
  });

  it('leaves the type to the presigned headers when the browser reported none', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await putToStorage(PUBLIC_URL, file(''), {}, fetchImpl);
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({});
  });

  it('reports a refusal from storage as a refusal, not a lost connection', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const err = await putToStorage(PUBLIC_URL, file(), {}, fetchImpl).catch((e) => e);

    expect(err).toBeInstanceOf(StorageUploadError);
    expect(err.status).toBe(404);
    expect(err.message).toBe(
      'Storage at https://test.worldofweddingz.com refused the file (404). Try again.',
    );
    expect(err.message).not.toMatch(/could not reach/i);
  });

  it('says a 413 is a size problem', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 413 });
    await expect(putToStorage(PUBLIC_URL, file(), {}, fetchImpl)).rejects.toThrow(/too large/);
  });

  it('names the storage origin when nothing answered', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await putToStorage(PUBLIC_URL, file(), {}, fetchImpl).catch((e) => e);

    expect(err).toBeInstanceOf(StorageUploadError);
    expect(err.status).toBeNull();
    expect(err.message).toContain('Could not reach storage at https://test.worldofweddingz.com');
  });

  it('accepts a relative upload URL against the page it was asked from', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await putToStorage(
      '/api/mock-storage/k.jpg',
      file(),
      {},
      fetchImpl,
      'https://test.worldofweddingz.com/biodata',
    ).catch((e) => e);

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://test.worldofweddingz.com/api/mock-storage/k.jpg',
      expect.anything(),
    );
    expect(err).toBeInstanceOf(StorageUploadError);
  });
});

describe('resolveUploadUrl', () => {
  it('keeps an absolute URL as it is', () => {
    expect(resolveUploadUrl(PUBLIC_URL, 'http://localhost:8080/').href).toBe(PUBLIC_URL);
  });
});

describe('apiMessage for errors that never had a response', () => {
  it('calls an axios request that got no answer a lost connection', () => {
    expect(apiMessage({ isAxiosError: true, request: {} }, 'fallback')).toMatch(
      /Could not reach the server/,
    );
  });

  it('does not call a plain error a lost connection', () => {
    expect(apiMessage(new Error('Storage refused the file (404).'), 'That file could not be uploaded.'))
      .toBe('That file could not be uploaded.');
  });
});

describe('web proxy configuration', () => {
  const conf = readFileSync(resolve(__dirname, '../../nginx.conf'), 'utf8');

  it('sends API paths ending in an image extension to the API, not the static rule', () => {
    expect(conf).toMatch(/location \^~ \/api\/ \{/);
  });

  it('accepts a body larger than the 10MB uploader limit', () => {
    const size = conf.match(/client_max_body_size (\d+)m;/);
    expect(Number(size?.[1])).toBeGreaterThan(10);
  });
});
