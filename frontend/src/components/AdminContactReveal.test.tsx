import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({ api: { get: vi.fn() }, apiMessage: () => '' }));
vi.mock('../store/auth', () => ({ usePermissions: () => [] }));

import { ContactRevealButton } from './AdminContactReveal';

const state = (overrides: Record<string, unknown> = {}) =>
  ({
    canReveal: true,
    contact: null,
    error: '',
    busy: false,
    reveal: vi.fn(),
    hide: vi.fn(),
    ...overrides,
  }) as never;

describe('ContactRevealButton', () => {
  it('offers nothing to an administrator without the reveal permission', () => {
    expect(renderToStaticMarkup(<ContactRevealButton state={state({ canReveal: false })} />)).toBe('');
  });

  it('offers the audited reveal while the details are masked', () => {
    const html = renderToStaticMarkup(<ContactRevealButton state={state()} />);
    expect(html).toContain('Reveal contact details');
    expect(html).toContain('recorded in the audit log');
  });

  it('offers to hide them again once revealed', () => {
    const html = renderToStaticMarkup(
      <ContactRevealButton state={state({ contact: { id: 'u1', email: 'a@b.co', phone: null } })} />,
    );
    expect(html).toContain('Hide contact details');
    expect(html).not.toContain('Reveal contact details');
  });
});
