import { ValidationPipe } from '@nestjs/common';
import { BusinessDetailsDto } from './dto/profile-details.dto';
import { businessEntries, saveBusiness } from './business-entries';

const first = { businessName: 'Store', businessType: 'Retail', businessLocation: 'Hyderabad', businessIncome: '0' };
const second = { businessName: 'Farm', businessType: 'Agriculture', businessLocation: 'Pune', businessIncome: '200000' };

describe('business entries', () => {
  it('reads legacy data without modifying it and upgrades it on save', () => {
    expect(businessEntries(first)).toEqual([first]);
    const upgraded = saveBusiness(first, { businessName: 'New store' });
    expect(upgraded).toMatchObject({ businessName: 'New store', businessType: 'Retail', entries: [{ ...first, businessName: 'New store' }] });
    expect(businessEntries(upgraded)[0].id).toEqual(expect.any(String));
  });

  it('keeps stable IDs while editing and removing independent entries', () => {
    const saved = saveBusiness({}, { entries: [first, second] });
    const entries = businessEntries(saved) as unknown as NonNullable<BusinessDetailsDto['entries']>;
    const edited = saveBusiness(saved, { entries: [{ ...entries[0], businessName: 'Updated' }, entries[1]] });
    expect(businessEntries(edited)[1]).toEqual(entries[1]);
    const removed = saveBusiness(edited, { entries: [entries[1]] });
    expect(businessEntries(removed)).toEqual([entries[1]]);
    expect(removed.businessName).toBe('Farm');
  });

  it('keeps later entries when a legacy client updates its single business', () => {
    const saved = saveBusiness({}, { entries: [first, second] });
    const updated = saveBusiness(saved, { businessName: 'Legacy edit' });
    expect(businessEntries(updated)[1]).toEqual(businessEntries(saved)[1]);
    expect(businessEntries(updated)[0]).toMatchObject({ businessName: 'Legacy edit', businessIncome: '0' });
  });

  it('rejects duplicate IDs', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(() => saveBusiness({}, { entries: [{ ...first, id }, { ...second, id }] })).toThrow('unique');
  });

  it('rejects empty legacy submissions without erasing an existing business', () => {
    expect(() => saveBusiness({}, {})).toThrow('business name');
    expect(() => saveBusiness(first, { businessName: null } as unknown as BusinessDetailsDto)).toThrow('business name');
    expect(saveBusiness(first, {})).toMatchObject(first);
  });

  it('validates every entry, including income and empty arrays', async () => {
    const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
    for (const entries of [[], null, {}, [null], [[]], [[first]], [{ businessName: ' ' }], [{ ...first, businessIncome: '-1' }], [{ ...first, businessIncome: '1.2' }], [first, { ...second, businessLocation: 'x'.repeat(201) }]]) {
      await expect(pipe.transform({ entries }, { type: 'body', metatype: BusinessDetailsDto })).rejects.toThrow();
    }
    expect(await pipe.transform({ entries: [first, second] }, { type: 'body', metatype: BusinessDetailsDto })).toMatchObject({ entries: [first, second] });
  });
});
