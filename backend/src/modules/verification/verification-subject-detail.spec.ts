import { ForbiddenException } from '@nestjs/common';
import { VerificationService } from './verification.service';
import { ApplicantType, UserRole } from '../../common/enums';

/**
 * The record an administrator or verification officer opens: the business as
 * submitted, its social media links and its catalog with every price's name,
 * details and description. The screens render all of it, so all of it has to
 * arrive; the allocation rule still decides who may open it at all.
 */
describe('VerificationService.findOne for a vendor business', () => {
  const socialLinks = [
    { platform: 'instagram', url: 'https://www.instagram.com/everafter/' },
    { platform: 'facebook', url: 'https://www.facebook.com/everafter' },
    { platform: 'website', url: 'https://everafter.in' },
  ];
  const catalog = [
    {
      id: 's1',
      active: true,
      displayName: null,
      definition: { name: 'Lehenga' },
      category: { name: 'Bridal Wear' },
      offerings: [
        {
          id: 'o1',
          name: 'Pre-wedding-shoot',
          description: 'Two hours on location with one photographer and twenty edited photos.',
          pricingModel: 'fixed',
          price: '15000.00',
          currency: 'INR',
          unitLabel: null,
          active: true,
        },
      ],
    },
  ];

  function build(assignedToUserId: string | null) {
    const requests = {
      findOne: jest.fn(async () => ({
        id: 'r1',
        applicantUserId: 'owner',
        applicantType: ApplicantType.VENDOR,
        subjectId: 'v1',
        assignedToUserId,
        history: [],
      })),
    };
    const users = { findOne: jest.fn(async () => ({ id: 'owner', email: 'owner@example.com' })) };
    const vendors = {
      findOne: jest.fn(async () => ({ id: 'v1', name: 'Everafter', socialLinks })),
    };
    const vendorServices = { listForVendor: jest.fn(async () => catalog) };
    return new (VerificationService as unknown as new (...args: unknown[]) => VerificationService)(
      requests,
      {},
      {},
      users,
      {},
      vendors,
      {},
      {},
      {},
      {},
      {},
      {},
      vendorServices,
    );
  }

  it('returns every social link and the full catalog to an administrator', async () => {
    const detail = (await build(null).findOne(
      { userId: 'admin', role: UserRole.ADMIN } as never,
      'r1',
    )) as unknown as {
      subject: { socialLinks: unknown[] };
      services: typeof catalog;
    };
    expect(detail.subject.socialLinks).toEqual(socialLinks);
    expect(detail.services[0].category.name).toBe('Bridal Wear');
    expect(detail.services[0].definition.name).toBe('Lehenga');
    expect(detail.services[0].offerings[0]).toMatchObject({
      name: 'Pre-wedding-shoot',
      price: '15000.00',
      description: expect.stringContaining('Two hours on location'),
    });
  });

  it('returns the same to the officer the request is allocated to', async () => {
    const detail = (await build('officer-1').findOne(
      { userId: 'officer-1', role: UserRole.IN_PERSON } as never,
      'r1',
    )) as unknown as { subject: { socialLinks: unknown[] }; services: unknown[] };
    expect(detail.subject.socialLinks).toHaveLength(3);
    expect(detail.services).toHaveLength(1);
  });

  it('still refuses an officer the request is not allocated to', async () => {
    await expect(
      build('officer-2').findOne({ userId: 'officer-1', role: UserRole.IN_PERSON } as never, 'r1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
