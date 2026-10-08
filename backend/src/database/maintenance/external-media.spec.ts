import { DataSource, EntityManager } from 'typeorm';
import {
  ExternalMediaReport,
  MEDIA_COLUMNS,
  externalIn,
  withoutExternal,
} from './external-media';

const OWN = 'media://users/u1/profile/1-a-photo.jpg';
const OWN_URL = 'https://wow.test/api/mock-storage/users/u1/profile/2-b-photo.jpg';
const OUT = 'https://photos.example.com/a.jpg';
const OUT2 = 'https://photos.example.com/b.jpg';
const isUploaded = (v: unknown) => typeof v === 'string' && (v.startsWith('media://') || v.startsWith('https://wow.test/'));

describe('external media report', () => {
  it('cleans only gallery lists, never single values, evidence or booking references', () => {
    const cleanable = MEDIA_COLUMNS.filter((c) => c.cleanable);
    expect(cleanable.every((c) => c.kind === 'list' || c.kind === 'wedding-photos')).toBe(true);
    expect(cleanable.map((c) => `${c.table}.${c.column}`)).toEqual([
      'profiles.photos',
      'agent_profiles.pictures',
      'vendors.portfolio',
      'vendors.complianceDocuments',
      'planner_profiles.portfolio',
      'planner_profiles.weddings',
    ]);
  });

  describe('externalIn', () => {
    it('finds outside entries in a list and in a single value', () => {
      expect(externalIn('list', [OWN, OUT, OWN_URL, OUT2, 7, ''], isUploaded)).toEqual([OUT, OUT2]);
      expect(externalIn('value', OUT, isUploaded)).toEqual([OUT]);
      expect(externalIn('value', OWN, isUploaded)).toEqual([]);
      expect(externalIn('value', null, isUploaded)).toEqual([]);
    });

    it("reads a planner's weddings for photos and covers separately", () => {
      const weddings = [
        { id: 'w1', coverUrl: OUT, photos: [OWN, OUT2] },
        { id: 'w2', coverUrl: OWN, photos: [] },
        { id: 'w3' },
      ];
      expect(externalIn('wedding-photos', weddings, isUploaded)).toEqual([OUT2]);
      expect(externalIn('wedding-cover', weddings, isUploaded)).toEqual([OUT]);
      expect(externalIn('wedding-photos', null, isUploaded)).toEqual([]);
    });
  });

  describe('withoutExternal', () => {
    it('drops outside entries from a list and keeps the order', () => {
      expect(withoutExternal('list', [OUT, OWN, OUT2, OWN_URL], isUploaded)).toEqual([OWN, OWN_URL]);
    });

    it('returns null when there is nothing to drop, or for a single value', () => {
      expect(withoutExternal('list', [OWN], isUploaded)).toBeNull();
      expect(withoutExternal('value', OUT, isUploaded)).toBeNull();
      expect(withoutExternal('wedding-cover', [{ coverUrl: OUT }], isUploaded)).toBeNull();
    });

    it('drops outside wedding photos and leaves every other field, the cover included', () => {
      const weddings = [
        { id: 'w1', title: 'A', coverUrl: OUT, photos: [OUT2, OWN], events: [{ name: 'Haldi' }] },
        { id: 'w2', title: 'B', photos: [OWN] },
      ];
      expect(withoutExternal('wedding-photos', weddings, isUploaded)).toEqual([
        { id: 'w1', title: 'A', coverUrl: OUT, photos: [OWN], events: [{ name: 'Haldi' }] },
        { id: 'w2', title: 'B', photos: [OWN] },
      ]);
    });
  });

  describe('ExternalMediaReport', () => {
    it('scans each existing column and reports rows holding outside values', async () => {
      const query = jest.fn(async (sql: string, params: unknown[]) => {
        if (sql.includes('information_schema')) return params[0] === 'profiles' ? [{}] : [];
        return [
          { id: 'p1', value: [OWN, OUT] },
          { id: 'p2', value: [OWN] },
        ];
      });
      const report = new ExternalMediaReport({ query } as unknown as DataSource, isUploaded);
      const findings = await report.scan(MEDIA_COLUMNS.slice(0, 2));
      expect(findings).toEqual([
        { table: 'profiles', column: 'photos', kind: 'list', cleanable: true, id: 'p1', external: [OUT] },
      ]);
    });

    it('cleans cleanable findings inside a transaction, re-reading each row, and moves a removed primary photo', async () => {
      const query = jest.fn(async (...[sql]: [string, unknown[]?]) => {
        if (sql.startsWith('SELECT')) return [{ value: [OUT, OWN] }];
        if (sql.includes('"profile_details"')) return [[{ id: 'd1' }], 1];
        return [[], 1];
      });
      const manager = { query } as unknown as EntityManager;
      const transaction = jest.fn(async (work: (m: EntityManager) => Promise<unknown>) => work(manager));
      const report = new ExternalMediaReport({ transaction } as unknown as DataSource, isUploaded);

      const result = await report.clean([
        { table: 'profiles', column: 'photos', kind: 'list', cleanable: true, id: 'p1', external: [OUT] },
        { table: 'events', column: 'imageUrl', kind: 'value', cleanable: false, id: 'e1', external: [OUT] },
      ]);

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ rowsUpdated: 1, entriesRemoved: 1, rowsSkipped: 0, primaryPhotosReset: 1 });
      const sqls = query.mock.calls.map((c) => c[0] as string);
      expect(sqls[0]).toContain('FOR UPDATE');
      expect(sqls.some((s) => s.includes('"events"'))).toBe(false);
      const update = query.mock.calls.find((c) => (c[0] as string).startsWith('UPDATE "profiles"'));
      expect(update?.[1]).toEqual([JSON.stringify([OWN]), 'p1']);
      const primary = query.mock.calls.find((c) => (c[0] as string).includes('"profile_details"'));
      expect(primary?.[1]).toEqual([OWN, 'p1', JSON.stringify([OWN])]);
    });

    it('skips a row that no longer holds anything external', async () => {
      const query = jest.fn(async () => [{ value: [OWN] }]);
      const manager = { query } as unknown as EntityManager;
      const transaction = jest.fn(async (work: (m: EntityManager) => Promise<unknown>) => work(manager));
      const report = new ExternalMediaReport({ transaction } as unknown as DataSource, isUploaded);
      const result = await report.clean([
        { table: 'vendors', column: 'portfolio', kind: 'list', cleanable: true, id: 'v1', external: [OUT] },
      ]);
      expect(result).toEqual({ rowsUpdated: 0, entriesRemoved: 0, rowsSkipped: 1, primaryPhotosReset: 0 });
      expect(query).toHaveBeenCalledTimes(1);
    });
  });
});
