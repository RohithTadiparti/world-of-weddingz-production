import { assembleWeddingFacts } from './wedding-facts';

describe('the facts a wedding already holds', () => {
  const rows = {
    plans: [
      { userId: 'bride', weddingDate: null },
      { userId: 'groom', weddingDate: '2027-02-14' },
    ],
    events: [
      { userId: 'bride', name: 'Mehendi', eventDate: '2027-02-12', venue: null, city: 'Hyderabad', expectedGuests: 80 },
      { userId: 'groom', name: 'Baraat', eventDate: '2027-02-14', venue: 'Palace', city: 'Jaipur', expectedGuests: 400 },
    ],
    bookings: [
      {
        userId: 'groom',
        providerId: 'venue-1',
        eventDate: null,
        serviceAnswers: { event_date: '2027-02-14' },
      },
    ],
    vendors: [{ id: 'venue-1', name: 'Rambagh', city: 'Jaipur', categories: ['venue'] }],
  };

  it('reads only the account’s own wedding when it has no fixed partner', () => {
    const facts = assembleWeddingFacts(['bride'], new Map(), rows).get('bride');
    expect(facts).toEqual({
      weddingDate: null,
      events: [{ name: 'Mehendi', eventDate: '2027-02-12', venue: null, city: 'Hyderabad', expectedGuests: 80 }],
      vendorBookings: [],
    });
  });

  it('shares the fixed partner’s plan, functions and bookings with the couple', () => {
    const facts = assembleWeddingFacts(['bride'], new Map([['bride', 'groom']]), rows).get('bride');
    expect(facts?.weddingDate).toBe('2027-02-14');
    expect(facts?.events.map((e) => e.name)).toEqual(['Mehendi', 'Baraat']);
    expect(facts?.vendorBookings).toEqual([
      { eventDate: '2027-02-14', venue: 'Rambagh', city: 'Jaipur', isVenue: true },
    ]);
  });

  it('keeps the account’s own plan date over the partner’s', () => {
    const own = {
      ...rows,
      plans: [
        { userId: 'bride', weddingDate: '2027-03-01' },
        { userId: 'groom', weddingDate: '2027-02-14' },
      ],
    };
    expect(
      assembleWeddingFacts(['bride'], new Map([['bride', 'groom']]), own).get('bride')?.weddingDate,
    ).toBe('2027-03-01');
  });
});
