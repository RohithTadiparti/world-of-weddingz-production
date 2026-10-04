import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateManagedProfileDto } from './managed-profile.dto';

describe('IntakeBiodataDto validation', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const metadata: ArgumentMetadata = { type: 'body', metatype: CreateManagedProfileDto };
  const base = {
    displayName: 'Asha Rao',
    contactPhone: '+919876543210',
    consent: { method: 'in_person', givenByRelation: 'self', givenAt: '2026-01-01' },
  };

  const validate = (biodata: Record<string, unknown>) =>
    pipe.transform({ ...base, biodata }, metadata);

  it('accepts the established nested biodata shapes', async () => {
    await expect(
      validate({
        father: { name: 'Ravi Rao', profession: 'Teacher' },
        mother: { name: 'Lata Rao', lifeStatus: 'alive' },
        horoscope: { rashi: 'Mesha', timeOfBirth: '06:30' },
        employment: { company: 'Example Ltd', designation: 'Engineer', salary: '1200000' },
        business: { businessName: 'Rao Textiles', businessLocation: 'Hyderabad' },
        residence: { city: 'Hyderabad', state: 'Telangana' },
      }),
    ).resolves.toBeInstanceOf(CreateManagedProfileDto);
  });

  it.each([
    ['father', { name: 'Ravi Rao', untrusted: 'value' }],
    ['mother', { name: 'Lata Rao', untrusted: 'value' }],
    ['horoscope', { rashi: 'Mesha', untrusted: 'value' }],
    ['employment', { company: 'Example Ltd', untrusted: 'value' }],
    ['business', { businessName: 'Rao Textiles', untrusted: 'value' }],
    ['residence', { city: 'Hyderabad', untrusted: 'value' }],
  ])('rejects unknown nested %s properties', async (field, value) => {
    await expect(validate({ [field]: value })).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['father', 'mother', 'horoscope', 'employment', 'business', 'residence'])(
    'rejects an array for nested %s',
    async (field) => {
      await expect(validate({ [field]: [] })).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('uses the established text limits', async () => {
    const result = await validate({
      communicationAddress: 'a'.repeat(500),
      bio: 'a'.repeat(2000),
    });
    const biodata = (result as CreateManagedProfileDto).biodata!;
    expect(biodata.communicationAddress).toHaveLength(500);
    expect(biodata.bio).toHaveLength(2000);
    await expect(validate({ communicationAddress: 'a'.repeat(501) })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(validate({ bio: 'a'.repeat(2001) })).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['alternateMobile', 21],
    ['maritalStatus', 41],
    ['familyType', 41],
    ['occupationStatus', 41],
    ['profession', 121],
    ['designation', 121],
    ['company', 161],
    ['workLocation', 121],
    ['annualIncome', 41],
    ['salary', 41],
  ])('bounds the length of %s', async (field, length) => {
    await expect(validate({ [field]: 'a'.repeat(length) })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each([
    ['employment', 'company', 161],
    ['employment', 'salary', 41],
    ['business', 'businessName', 161],
    ['business', 'businessIncome', 41],
  ])('bounds the length of %s.%s', async (block, field, length) => {
    await expect(validate({ [block]: { [field]: 'a'.repeat(length) } })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each(['contactPhone', 'contactEmail', 'dateOfBirth', 'gender', 'city', 'displayName'])(
    'refuses the top-level field %s inside biodata',
    async (field) => {
      await expect(validate({ [field]: 'x' })).rejects.toBeInstanceOf(BadRequestException);
    },
  );
});
