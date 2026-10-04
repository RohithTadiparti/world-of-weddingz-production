import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import HeightInput from './HeightInput';

describe('HeightInput form validation', () => {
  it('renders required feet and inches inputs from canonical centimeters', () => {
    const html = renderToStaticMarkup(createElement(HeightInput, { value: 168, onChange: vi.fn(), required: true }));
    expect(html).toContain('aria-label="Height in feet"');
    expect(html).toContain('value="5"');
    expect(html).toContain('aria-label="Height in inches"');
    expect(html).toContain('value="6"');
    // Text boxes: the browser enforces the range through `pattern`, not min/max.
    expect(html).toContain('pattern="[3-8]"');
    expect(html).toContain('pattern="[0-9]|1[01]"');
  });
});
