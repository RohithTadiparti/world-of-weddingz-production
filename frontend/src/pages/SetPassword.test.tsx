import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../store/auth', () => ({
  useAuth: (select: (state: { user: { email: string } }) => unknown) =>
    select({ user: { email: 'officer@example.com' } }),
}));

import SetPassword from './SetPassword';

describe('SetPassword', () => {
  it('serves a new-password pattern a valid password can satisfy', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <SetPassword />
      </MemoryRouter>,
    );
    // A `\\d` in the served attribute is "a literal backslash, then the letter
    // d" as far as the browser's regex is concerned, so every password was
    // refused client-side with "please match the requested format".
    expect(markup).toContain('pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{8,}"');
    expect(markup).not.toContain('\\\\d');
  });
});
