import { routeBadgeCounts } from './navigation-counts';

describe('routeBadgeCounts', () => {
  it('keeps only positive action counts for the navigation', () => {
    expect(
      routeBadgeCounts({
        '/notifications': 3,
        '/bookings': 4,
        '/support': 0,
        '/security': 0,
        '/clients': 2,
      }),
    ).toEqual({
      '/notifications': 3,
      '/bookings': 4,
      '/clients': 2,
    });
  });
});
