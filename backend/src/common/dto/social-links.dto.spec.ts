import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SocialLinksDto } from './social-links.dto';
import { UpsertPlannerProfileDto } from '../../modules/wedding-planners/dto/wedding-planner.dto';

async function website(value: unknown) {
  const dto = plainToInstance(SocialLinksDto, { website: value });
  const errors = await validate(dto);
  return { value: dto.website, errors: errors.map((e) => e.property) };
}

describe('SocialLinksDto website', () => {
  it.each([
    ['www.everafter.in', 'https://www.everafter.in'],
    ['everafter.in', 'https://everafter.in'],
    ['http://everafter.in/about', 'https://everafter.in/about'],
    ['  https://everafter.in  ', 'https://everafter.in'],
  ])('accepts the stored value %p as %p', async (input, expected) => {
    await expect(website(input)).resolves.toEqual({ value: expected, errors: [] });
  });

  it('clears a blank one', async () => {
    await expect(website('  ')).resolves.toEqual({ value: null, errors: [] });
  });

  it('still refuses what is not a website at all', async () => {
    expect((await website('not a website')).errors).toEqual(['website']);
    expect((await website('ftp://everafter.in')).errors).toEqual(['website']);
  });

  it('lets a planner with an old bare-domain website save their profile', async () => {
    const dto = plainToInstance(UpsertPlannerProfileDto, {
      agencyName: 'Everafter Weddings',
      website: 'www.everafter.in',
    });
    const errors = await validate(dto, { skipMissingProperties: true });
    expect(errors.map((e) => e.property)).not.toContain('website');
    expect(dto.website).toBe('https://www.everafter.in');
  });
});
