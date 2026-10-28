// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { markdownOutline, markdownStats, renderMarkdown } from './markdown.js';

describe('renderMarkdown', () => {
  it('renders GitHub-flavored Markdown', () => {
    const html = renderMarkdown('# Title\n\n- [x] done\n\n| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('<table>');
  });

  it('strips scripts and event handlers from raw HTML', () => {
    const html = renderMarkdown('<img src="x" onerror="alert(1)"><script>alert(2)</script>');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<script');
  });

  it('drops javascript: links', () => {
    expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('javascript:');
  });
});

describe('markdownOutline', () => {
  it('lists ATX and setext headings with their lines', () => {
    const text = '# One\n\ntext\n\nTwo\n---\n\n### Three **bold** ###\n\nFour\n====';
    expect(markdownOutline(text)).toEqual([
      { level: 1, text: 'One', line: 1 },
      { level: 2, text: 'Two', line: 5 },
      { level: 3, text: 'Three bold', line: 8 },
      { level: 1, text: 'Four', line: 10 },
    ]);
  });

  it('ignores headings inside fenced code', () => {
    const text = '# Real\n```sh\n# comment\n```\n~~~\n## also code\n~~~\n## After';
    expect(markdownOutline(text).map((h) => h.text)).toEqual(['Real', 'After']);
  });

  it('keeps link text and drops empty headings', () => {
    expect(markdownOutline('## [Docs](https://x.y)\n#\n')).toEqual([{ level: 2, text: 'Docs', line: 1 }]);
  });

  it('does not take a list item over a rule for a heading', () => {
    expect(markdownOutline('- item\n---')).toEqual([]);
  });
});

describe('markdownStats', () => {
  it('counts words and lines', () => {
    expect(markdownStats('')).toEqual({ words: 0, lines: 0 });
    expect(markdownStats("# Hola mundo\n\nit's año-2026")).toEqual({ words: 4, lines: 3 });
  });
});
