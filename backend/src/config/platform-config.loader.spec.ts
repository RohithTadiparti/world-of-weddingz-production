import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPlatformConfig } from './platform-config.loader';

const canonical = join(__dirname, '../../../config/platform.yaml');

describe('loadPlatformConfig', () => {
  it('loads the canonical thresholds and safe initial provider modes', () => {
    const config = loadPlatformConfig(canonical, {});
    expect(config.operations.thresholds.accounts).toEqual({ warning: 5000, critical: 10000 });
    expect(config.operations.thresholds.requestsPerDay).toEqual({
      warning: 50000,
      critical: 100000,
    });
    expect(config.operations.logRetentionDays).toBe(30);
    expect(config.providers).toMatchObject({ payment: 'mock', identity: 'mock', mail: 'log' });
    expect(config.migration).toMatchObject({ enabled: false, executor: 'mock', dryRun: true });
    expect(config.migration.readOnlyWindowMinutes).toBe(15);
    expect(config.migration.railwayRetentionHours).toBe(72);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('selects S3 automatically outside local mode', () => {
    expect(
      loadPlatformConfig(canonical, {
        DEPLOYMENT_TIER: 'public-beta',
        S3_BUCKET: 'wow-test',
        COOKIE_SECURE: 'true',
        SWAGGER_ENABLED: 'false',
      }).providers.media,
    ).toBe('s3');
  });

  it('rejects an unknown YAML key with its path', () => {
    const path = tempConfig('version: 1\nunknownThing: true\n');
    expect(() => loadPlatformConfig(path, {})).toThrow(/unknownThing/);
  });

  it('rejects malformed scalar overrides with their environment name', () => {
    expect(() => loadPlatformConfig(canonical, { MIGRATION_ENABLED: 'sometimes' })).toThrow(
      /MIGRATION_ENABLED/,
    );
  });

  it('fails closed for unsafe revenue provider combinations', () => {
    expect(() => loadPlatformConfig(canonical, { DEPLOYMENT_TIER: 'revenue' })).toThrow(
      /providers\.payment/,
    );
  });

  describe('operational alert recipients', () => {
    it('accepts the empty canonical default', () => {
      expect(loadPlatformConfig(canonical, {}).operations.alertRecipients).toEqual([]);
    });

    it('takes a comma-separated environment override and trims each entry', () => {
      const config = loadPlatformConfig(canonical, {
        OPERATIONS_ALERT_RECIPIENTS: ' ops@example.com, oncall@example.org ,',
      });
      expect(config.operations.alertRecipients).toEqual(['ops@example.com', 'oncall@example.org']);
      expect(Object.isFrozen(config.operations.alertRecipients)).toBe(true);
    });

    it('keeps the default when the override is blank', () => {
      expect(
        loadPlatformConfig(canonical, { OPERATIONS_ALERT_RECIPIENTS: '' }).operations
          .alertRecipients,
      ).toEqual([]);
    });

    it.each([
      ['not an address', 'not-an-email'],
      ['a duplicate, ignoring case', 'ops@example.com,OPS@example.com'],
      ['too many entries', Array.from({ length: 21 }, (_, i) => `ops${i}@example.com`).join(',')],
      ['an over-long address', `${'a'.repeat(250)}@example.com`],
    ])('rejects %s without printing the address', (_label, value) => {
      let message = '';
      try {
        loadPlatformConfig(canonical, { OPERATIONS_ALERT_RECIPIENTS: value });
      } catch (error) {
        message = String(error);
      }
      expect(message).toMatch(/operations\.alertRecipients/);
      expect(message).not.toContain('example.com');
      expect(message).not.toContain('not-an-email');
    });

    it('rejects a YAML list that is not a list of addresses', () => {
      const yaml = readFileSync(canonical, 'utf8').replace(
        'alertRecipients: []',
        'alertRecipients: [42]',
      );
      expect(() => loadPlatformConfig(tempConfig(yaml), {})).toThrow(/operations\.alertRecipients/);
    });
  });

  it('never leaks secret-shaped values in validation errors', () => {
    const sentinel = 'do-not-print-this-secret';
    expect(() => loadPlatformConfig(canonical, { MIGRATION_ENABLED: sentinel })).toThrow(
      /\[REDACTED\]/,
    );
    try {
      loadPlatformConfig(canonical, { MIGRATION_ENABLED: sentinel });
    } catch (error) {
      expect(String(error)).not.toContain(sentinel);
    }
  });
});

function tempConfig(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'wow-platform-config-'));
  const path = join(directory, 'platform.yaml');
  writeFileSync(path, contents, 'utf8');
  return path;
}
