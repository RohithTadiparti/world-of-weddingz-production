import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SupportCasesService } from './support-cases.service';
import { SupportCase } from './entities/support-case.entity';
import { BUSINESS_CHANGE_CATEGORY, GrantBusinessChangeAccessDto, RaiseCaseDto } from './dto/case.dto';
import { CaseSubject, UserRole } from '../../common/enums';
import { AuthUser } from '../../common/decorators/current-user.decorator';

const vendor: AuthUser = {
  userId: 'vendor-owner',
  email: 'vendor@example.com',
  role: UserRole.VENDOR,
  managedByAgentId: null,
};

const BUSINESS_ID = '8f6c1d7e-3b1a-4c2d-9e4f-1a2b3c4d5e6f';

/**
 * A vendor's request to change verified business details, against every other
 * case about a vendor.
 *
 * Every vendor-subject case used to be treated as a change request, which
 * broke the Support page's "My business listing" option: it names no business
 * and no fields, so it always failed.
 */
describe('business change requests', () => {
  const saved: Partial<SupportCase>[] = [];
  const cases = {
    create: jest.fn((x: Partial<SupportCase>) => ({ ...x }) as SupportCase),
    save: jest.fn(async (x: SupportCase) => {
      saved.push(x);
      return { ...x, id: 'case-1' } as SupportCase;
    }),
  };
  const vendors = {
    findOne: jest.fn(async () => ({ id: BUSINESS_ID, ownerUserId: 'vendor-owner' })),
  };
  const stub = {} as never;
  const service = new SupportCasesService(
    cases as never,
    stub,
    stub,
    stub,
    vendors as never,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    stub,
    { record: jest.fn() } as never,
    { createForRole: jest.fn() } as never,
    stub,
    stub,
  );

  beforeEach(() => {
    saved.length = 0;
    jest.clearAllMocks();
  });

  it('raises an ordinary "My business listing" case with no business and no fields', async () => {
    await service.raise(vendor, {
      subjectType: CaseSubject.VENDOR,
      title: 'My listing is wrong',
      description: 'The listing shows the wrong opening hours.',
    } as RaiseCaseDto);
    expect(saved[0].category).toBeNull();
    expect(saved[0].requestedFields).toBeNull();
  });

  it('stamps an explicit change request and keeps its fields', async () => {
    await service.raise(vendor, {
      subjectType: CaseSubject.VENDOR,
      subjectId: BUSINESS_ID,
      category: BUSINESS_CHANGE_CATEGORY,
      requestedFields: ['name', 'category'],
      title: 'Change request: verified business details',
      description: 'We have rebranded and moved.',
    } as RaiseCaseDto);
    expect(saved[0].category).toBe(BUSINESS_CHANGE_CATEGORY);
    expect(saved[0].requestedFields).toEqual(['name', 'category']);
  });

  it('refuses a change request that names no fields', async () => {
    await expect(
      service.raise(vendor, {
        subjectType: CaseSubject.VENDOR,
        subjectId: BUSINESS_ID,
        category: BUSINESS_CHANGE_CATEGORY,
        title: 'Change request',
        description: 'Please open the listing.',
      } as RaiseCaseDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('business change request fields', () => {
  const raise = (requestedFields: unknown) =>
    plainToInstance(RaiseCaseDto, {
      subjectType: 'vendor',
      subjectId: BUSINESS_ID,
      category: BUSINESS_CHANGE_CATEGORY,
      title: 'Change request',
      description: 'We have rebranded and moved.',
      requestedFields,
    });

  it('reads the categories option as the category correction key', () => {
    const dto = raise(['categories', 'name']);
    expect(validateSync(dto)).toEqual([]);
    expect(dto.requestedFields).toEqual(['category', 'name']);
  });

  it('rejects a field that cannot be corrected when the vendor submits', () => {
    expect(validateSync(raise(['bankAccount']))).not.toEqual([]);
  });

  it('accepts categories when the administrator grants access', () => {
    const dto = plainToInstance(GrantBusinessChangeAccessDto, { fields: ['categories'] });
    expect(validateSync(dto)).toEqual([]);
    expect(dto.fields).toEqual(['category']);
  });

  it('rejects an unknown category value on a case', () => {
    const dto = plainToInstance(RaiseCaseDto, {
      subjectType: 'vendor',
      category: 'anything',
      title: 'Listing issue',
      description: 'Something about the listing.',
    });
    expect(validateSync(dto)).not.toEqual([]);
  });
});
