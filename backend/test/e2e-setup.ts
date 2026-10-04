import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mediaDir = mkdtempSync(join(tmpdir(), 'wow-e2e-media-'));
process.env.MEDIA_MOCK_DIR = mediaDir;
process.env.AUTH_RATE_LIMIT_MAX ??= '100';

afterAll(() => {
  rmSync(mediaDir, { recursive: true, force: true });
});