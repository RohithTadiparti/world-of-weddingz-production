import { describe, expect, it } from 'vitest';
import {
  BUSINESS_NAME_MAX,
  COMPLIANCE_DOCUMENT_HELP,
  COMPLIANCE_DOCUMENT_TYPES,
  MAX_COMPLIANCE_DOCUMENTS,
  MAX_PORTFOLIO_IMAGES,
  REGISTERED_ADDRESS_MAX,
  REGISTRATION_NUMBER_MAX,
  addPortfolioImages,
  businessNameError,
  complianceFileProblem,
  orderedPortfolio,
  profileImageOf,
  registrationFieldErrors,
  removePortfolioImage,
  titleCaseCity,
  usernameRequired,
  validateUsername,
} from './vendor-listing-rules';

describe('titleCaseCity', () => {
  it.each([
    ['hyderabad', 'Hyderabad'],
    ['HYDERABAD', 'Hyderabad'],
    ['  new   delhi ', 'New Delhi'],
    ['navi-mumbai', 'Navi-Mumbai'],
    ['navi - mumbai', 'Navi-Mumbai'],
    ['', ''],
  ])('%p becomes %p', (input, expected) => {
    expect(titleCaseCity(input)).toBe(expected);
  });
});

describe('businessNameError', () => {
  it('allows 50 characters and refuses 51', () => {
    expect(BUSINESS_NAME_MAX).toBe(50);
    expect(businessNameError('a'.repeat(50))).toBeUndefined();
    expect(businessNameError('a'.repeat(51))).toBe('Business name can be at most 50 characters.');
  });

  it('still requires a name, and a real one', () => {
    expect(businessNameError('  ')).toBe('Business name is required.');
    expect(businessNameError('A')).toBe('Business name must be at least 2 characters.');
    expect(businessNameError('***')).toBe('Please enter a valid business name.');
  });
});

describe('registrationFieldErrors', () => {
  const ok = { tradingSince: '2018-06-01', registrationNumber: '', registeredAddress: '12 Road' };

  it('requires the trading-since date', () => {
    expect(registrationFieldErrors({ ...ok, tradingSince: '' })).toEqual({
      tradingSince: 'Trading since is required',
    });
    expect(registrationFieldErrors(ok)).toEqual({});
  });

  it('limits the registration number and the registered address', () => {
    expect(REGISTRATION_NUMBER_MAX).toBe(30);
    expect(REGISTERED_ADDRESS_MAX).toBe(100);
    expect(
      registrationFieldErrors({
        ...ok,
        registrationNumber: 'R'.repeat(31),
        registeredAddress: 'x'.repeat(101),
      }),
    ).toEqual({
      registrationNumber: 'Registration number can be at most 30 characters',
      registeredAddress: 'Registered address can be at most 100 characters',
    });
    expect(
      registrationFieldErrors({
        ...ok,
        registrationNumber: 'R'.repeat(30),
        registeredAddress: 'x'.repeat(100),
      }),
    ).toEqual({});
  });
});

describe('portfolio', () => {
  const images = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `img-${from + i}`);

  it('adds several images at once, up to 10', () => {
    expect(MAX_PORTFOLIO_IMAGES).toBe(10);
    expect(addPortfolioImages(images(2), ['img-2', 'img-3'])).toEqual({
      portfolio: images(4),
      dropped: 0,
    });
    expect(addPortfolioImages(images(8), images(4, 8))).toEqual({
      portfolio: images(10),
      dropped: 2,
    });
    expect(addPortfolioImages(images(2), ['img-1'])).toEqual({ portfolio: images(2), dropped: 0 });
  });

  it('uses the chosen profile picture while it is in the portfolio, else the first image', () => {
    expect(profileImageOf(['a', 'b'], 'b')).toBe('b');
    expect(profileImageOf(['a', 'b'], 'gone')).toBe('a');
    expect(profileImageOf([], 'a')).toBeNull();
  });

  it('shows the profile picture apart from the rest of the portfolio', () => {
    expect(orderedPortfolio(['a', 'b', 'c'], 'b')).toEqual({ profile: 'b', rest: ['a', 'c'] });
    expect(orderedPortfolio([], null)).toEqual({ profile: null, rest: [] });
  });

  it('moves the profile picture on when its image is removed', () => {
    expect(removePortfolioImage(['a', 'b'], 'a', 'a')).toEqual({ portfolio: ['b'], profileImage: 'b' });
    expect(removePortfolioImage(['a', 'b'], 'b', 'a')).toEqual({ portfolio: ['a'], profileImage: 'a' });
    expect(removePortfolioImage(['a'], 'a', 'a')).toEqual({ portfolio: [], profileImage: null });
  });
});

describe('compliance documents', () => {
  const MB = 1024 * 1024;

  it('accepts PDF, JPG, JPEG and PNG up to 10 MB', () => {
    expect(MAX_COMPLIANCE_DOCUMENTS).toBe(3);
    for (const name of ['gst.pdf', 'pan.JPG', 'aadhaar.jpeg', 'reg.png']) {
      expect(complianceFileProblem({ name, size: 2 * MB, type: '' })).toBeNull();
    }
    expect(complianceFileProblem({ name: 'gst.pdf', size: 10 * MB, type: 'application/pdf' })).toBeNull();
  });

  it('refuses other formats and anything over 10 MB', () => {
    expect(complianceFileProblem({ name: 'scan.heic', size: MB, type: 'image/heic' })).toBe(
      'Upload a PDF, JPG, JPEG or PNG file.',
    );
    expect(complianceFileProblem({ name: 'gst.pdf', size: 10 * MB + 1, type: 'application/pdf' })).toBe(
      'That file is over 10 MB. Choose a smaller one.',
    );
  });

  it('names the four accepted documents', () => {
    expect(COMPLIANCE_DOCUMENT_TYPES.map((t) => t.label)).toEqual([
      'GST Certificate',
      'PAN Card',
      'Aadhaar Card',
      'Business Registration Certificate',
    ]);
    expect(COMPLIANCE_DOCUMENT_HELP).toContain(
      'GST Certificate, PAN Card, Aadhaar Card, or Business Registration Certificate',
    );
  });
});

describe('username at registration', () => {
  it('is optional for a vendor and required for the other personas', () => {
    expect(usernameRequired('vendor')).toBe(false);
    expect(usernameRequired('individual')).toBe(true);
    expect(usernameRequired('agent')).toBe(true);
    expect(usernameRequired('planner')).toBe(true);
  });

  it('lets a vendor leave it blank but checks one that is typed', () => {
    expect(validateUsername('', 'vendor')).toBeUndefined();
    expect(validateUsername('x', 'vendor')).toBe(
      'Use 3-40 lowercase letters, numbers, dots, underscores or hyphens',
    );
    expect(validateUsername('', 'individual')).toBe(
      'Use 3-40 lowercase letters, numbers, dots, underscores or hyphens',
    );
    expect(validateUsername('asha_rao', 'individual')).toBeUndefined();
  });
});
