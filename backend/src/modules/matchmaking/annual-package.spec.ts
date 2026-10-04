import { OccupationStatus } from '../../common/enums';
import { annualPackage } from './matchmaking.service';

describe('annualPackage', () => {
  it('reads the salary for somebody employed', () => {
    expect(
      annualPackage({ occupationStatus: OccupationStatus.EMPLOYED, employment: { salary: '1200000' }, business: {} }),
    ).toBe(1200000);
  });

  it('adds up the business income for somebody self-employed', () => {
    expect(
      annualPackage({
        occupationStatus: OccupationStatus.SELF_EMPLOYED,
        employment: {},
        business: {
          businessName: 'Shop',
          entries: [
            { businessName: 'Shop', businessIncome: '500000' },
            { businessName: 'Farm', businessIncome: '300000' },
            { businessName: 'Studio' },
          ],
        },
      }),
    ).toBe(800000);
    // A single business saved before businesses became a list.
    expect(
      annualPackage({
        occupationStatus: OccupationStatus.SELF_EMPLOYED,
        employment: {},
        business: { businessName: 'Shop', businessIncome: '700000' },
      }),
    ).toBe(700000);
  });

  it('has no figure when nothing numeric was given', () => {
    expect(annualPackage({ occupationStatus: OccupationStatus.EMPLOYED, employment: { salary: 'lots' }, business: {} })).toBeNull();
    expect(annualPackage({ occupationStatus: OccupationStatus.SELF_EMPLOYED, employment: {}, business: {} })).toBeNull();
    expect(annualPackage({ occupationStatus: OccupationStatus.STUDENT, employment: {}, business: {} })).toBeNull();
  });
});
