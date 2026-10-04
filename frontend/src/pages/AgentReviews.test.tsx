import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const { useQueryMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({ useQuery: useQueryMock }));
vi.mock('../lib/api', () => ({
  api: { get: vi.fn() },
  apiMessage: (_error: unknown, fallback: string) => fallback,
}));

import AgentReviews from './AgentReviews';

describe('AgentReviews', () => {
  it('keeps the page shell visible while reviews are loading', () => {
    useQueryMock.mockReturnValue({ isLoading: true, isError: false, data: undefined });

    const markup = renderToStaticMarkup(<AgentReviews />);

    expect(markup).toContain('My Reviews');
    expect(markup).toContain('Loading');
  });

  it('shows a recoverable error when reviews cannot be loaded', () => {
    useQueryMock.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error('request failed'),
      data: undefined,
      refetch: vi.fn(),
    });

    const markup = renderToStaticMarkup(<AgentReviews />);

    expect(markup).toContain('Could not load your reviews');
    expect(markup).toContain('Try again');
  });
});
