import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import DOMPurify from 'dompurify';
import { MarkdownPreview } from '../plugins/editor/web-src/editor/MarkdownPreview';

afterEach(cleanup);

describe('editor Markdown preview security', () => {
  it('uses the reviewed sanitizer release instead of silently rebuilding with an older lock', () => {
    expect(DOMPurify.version).toBe('3.4.14');
  });

  it('preserves Markdown and literal code while removing executable HTML and attributes', () => {
    const { container } = render(<MarkdownPreview source={'# Report\n\n```html\n<img src=x onerror=alert(1)>\n```\n\n<script>alert(1)</script>\n<img src="x" onerror="alert(1)">\n<a href="javascript:alert(1)">unsafe link</a>\n<a href="https://example.com/report">safe link</a>'} />);
    expect(container.querySelector('h1')?.textContent).toBe('Report');
    expect(container.querySelector('pre code')?.textContent).toBe('<img src=x onerror=alert(1)>\n');
    expect(container.querySelector('script, [onerror], [onclick]')).toBeNull();
    const links = container.querySelectorAll('a');
    expect(links[0].hasAttribute('href')).toBe(false);
    expect(links[1].getAttribute('href')).toBe('https://example.com/report');
  });

  it('removes active content across SVG and MathML document contexts', () => {
    const { container } = render(<MarkdownPreview source={'<svg><a xlink:href="javascript:alert(1)"><text>SVG</text></a><script>alert(1)</script></svg><math><mtext><img src="x" onerror="alert(1)"></mtext></math>'} />);
    expect(container.querySelector('script, [onerror], [onclick]')).toBeNull();
    for (const element of container.querySelectorAll('*')) {
      for (const attribute of element.attributes) {
        expect(attribute.value).not.toMatch(/^\s*javascript:/i);
      }
    }
  });
});
