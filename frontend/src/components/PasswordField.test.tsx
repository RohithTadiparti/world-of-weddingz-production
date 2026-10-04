import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import PasswordField from './PasswordField';

describe('PasswordField', () => {
  it('renders a masked required field with an accessible show-password control', () => {
    const html = renderToStaticMarkup(
      createElement(PasswordField, {
        label: 'Current password',
        value: 'Secret123',
        onChange: vi.fn(),
        autoComplete: 'current-password',
        required: true,
      }),
    );

    expect(html).toContain('type="password"');
    expect(html).toContain('required=""');
    expect(html).toContain('aria-label="Show password"');
  });
});
