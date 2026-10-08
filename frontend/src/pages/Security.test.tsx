import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const { useQueryMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false, reset: vi.fn() }),
}));
vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  apiMessage: (_error: unknown, fallback: string) => fallback,
}));
vi.mock('../store/auth', () => ({
  useAuth: (select: (state: { user: object }) => unknown) =>
    select({
      user: {
        email: 'officer@example.com',
        isVerified: true,
        mfaEnabled: false,
        role: 'in_person',
        permissions: [],
      },
    }),
  usePermissions: () => [],
}));

import Security from './Security';

describe('Security', () => {
  it('serves a new-password pattern a valid password can satisfy', () => {
    useQueryMock.mockReturnValue({ data: [] });
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <Security />
      </MemoryRouter>,
    );
    // A `\\d` in the served attribute is "a literal backslash, then the letter
    // d" as far as the browser's regex is concerned, so every password was
    // refused client-side with "please match the requested format".
    expect(markup).toContain('pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{8,}"');
    expect(markup).not.toContain('\\\\d');
  });
});
