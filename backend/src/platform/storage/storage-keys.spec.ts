import { buildKey, isSafeKey, parseKey, refKey, safeName, toRef } from './storage-keys';

const USER = '5b1d6c2e-1f7a-4c1e-9a53-0d2f3c4b5a61';
const BOOKING = '9c0e1d2f-3a4b-4c5d-8e6f-7a8b9c0d1e2f';

describe('storage keys', () => {
  describe('buildKey', () => {
    it.each([
      [{ owner: 'users', id: USER, area: 'profile' }, `users/${USER}/profile/`],
      [{ owner: 'users', id: USER, area: 'albums' }, `users/${USER}/albums/`],
      [{ owner: 'users', id: USER, area: 'attachments' }, `users/${USER}/attachments/`],
      [{ owner: 'users', id: USER, area: 'biodata' }, `users/${USER}/biodata/`],
      [{ owner: 'vendors', id: USER, area: 'portfolio' }, `vendors/${USER}/portfolio/`],
      [{ owner: 'bookings', id: BOOKING, area: 'deliveries' }, `bookings/${BOOKING}/deliveries/`],
      [{ owner: 'bookings', id: BOOKING, area: 'references' }, `bookings/${BOOKING}/references/`],
    ] as const)('files %o under its owner', (scope, prefix) => {
      const key = buildKey(scope, 'photo.jpg', 1767000000000, 'abcdef0123456789');
      expect(key).toBe(`${prefix}1767000000000-abcdef0123456789-photo.jpg`);
      expect(parseKey(key)).toEqual(scope);
    });

    it('mints a different key for the same file every time', () => {
      const scope = { owner: 'users', id: USER, area: 'profile' } as const;
      expect(buildKey(scope, 'a.jpg')).not.toBe(buildKey(scope, 'a.jpg'));
    });

    it('refuses an area its owner does not have, and an id that could escape', () => {
      expect(() =>
        buildKey({ owner: 'users', id: USER, area: 'deliveries' } as never, 'a.jpg'),
      ).toThrow();
      expect(() => buildKey({ owner: 'users', id: '../x', area: 'profile' }, 'a.jpg')).toThrow();
    });
  });

  /*
   * The names people actually upload.
   *
   * "It is not taking all types of images" turned out to be about the name
   * rather than the image: a filename with a space in it was refused outright,
   * and a space that reached the key would have produced a URL some clients
   * encode and others truncate. What lands in the key is safe to put in a link.
   */
  describe('the filename a real device produces', () => {
    it.each([
      ['WhatsApp Image 2026-08-26 at 5.28.11 PM.jpeg', 'jpeg'],
      ['pic (1).png', 'png'],
      ["Ravi's wedding.jpg", 'jpg'],
      ['IMG_20260826.jfif', 'jfif'],
      ['snap.avif', 'avif'],
      ['photo.HEIC', 'heic'],
    ])('folds %s into a key that is safe in a URL', (filename, extension) => {
      const key = buildKey({ owner: 'users', id: USER, area: 'profile' }, filename);
      expect(key).toMatch(/^users\/[0-9a-f-]+\/profile\/\d+-[0-9a-f]{16}-[A-Za-z0-9.-]+$/);
      expect(key.endsWith(`.${extension}`)).toBe(true);
      expect(encodeURI(key)).toBe(key);
      expect(isSafeKey(key)).toBe(true);
    });

    it('keeps a name that is already safe recognisable', () => {
      expect(safeName('passport-photo.png')).toBe('passport-photo.png');
    });

    it('does not produce an empty name from a filename with nothing usable in it', () => {
      expect(safeName('___.jpg')).toBe('file.jpg');
    });
  });

  describe('parseKey', () => {
    it.each([
      `users/${USER}/profile`, // no file
      `users/${USER}/secrets/a.jpg`, // no such area
      `bookings/${BOOKING}/../x/a.jpg`,
      `uploads/${USER}/a.jpg`, // the old flat layout names no owner area
      'users//profile/a.jpg',
      '/users/x/profile/a.jpg',
    ])('reads nothing from %s', (key) => {
      expect(parseKey(key)).toBeNull();
    });
  });

  describe('references', () => {
    it('round-trips a key', () => {
      const key = `bookings/${BOOKING}/deliveries/1-ab-a.jpg`;
      expect(refKey(toRef(key))).toBe(key);
    });

    it.each([
      'https://cdn.example.com/a.jpg',
      'media://../etc/passwd',
      'media://users/x/profile/a b.jpg',
      'media://',
      42,
      null,
    ])('is not fooled by %p', (value) => {
      expect(refKey(value)).toBeNull();
    });
  });
});
