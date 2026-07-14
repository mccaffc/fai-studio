import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('Studio shell branding', () => {
  it('uses the official acronym lockup and removes the old tagline', () => {
    expect(html).toContain('./fai-acronym-white.svg');
    expect(html).toContain('class="product-name">Studio</span>');
    expect(html).not.toContain('seeded · deterministic · brand-locked');
  });
});
