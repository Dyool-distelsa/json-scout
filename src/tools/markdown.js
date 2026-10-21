import { Marked } from 'marked';
import DOMPurify from 'dompurify';

const marked = new Marked({ gfm: true, breaks: false });

/**
 * Render Markdown to sanitized HTML for the preview pane. Raw HTML in the
 * document is kept but scripts, event handlers and the like are stripped,
 * since the preview lives inside the app window.
 * @param {string} text
 * @returns {string}
 */
export function renderMarkdown(text) {
  const html = marked.parse(String(text ?? ''), { async: false });
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}

/**
 * The ATX (`# Title`) and setext (`Title` over `===`/`---`) headings of a
 * Markdown document, skipping fenced code blocks.
 * @param {string} text
 * @returns {{ level: number, text: string, line: number }[]} `line` is 1-based
 */
export function markdownOutline(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const headings = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const atx = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+\s*)?$/.exec(line);
    if (atx) {
      headings.push({ level: atx[1].length, text: plainHeading(atx[2]), line: i + 1 });
      continue;
    }
    const next = lines[i + 1];
    if (next !== undefined && line.trim() !== '' && !/^\s{0,3}[-*+>]\s/.test(line)) {
      const setext = /^\s{0,3}(=+|-+)\s*$/.exec(next);
      if (setext) {
        headings.push({ level: setext[1][0] === '=' ? 1 : 2, text: plainHeading(line.trim()), line: i + 1 });
        i++;
      }
    }
  }
  return headings.filter((h) => h.text !== '');
}

/** Heading text without the inline Markdown marks people see as formatting. */
function plainHeading(text) {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .trim();
}

/**
 * Word, line and heading counts for the status bar.
 * @param {string} text
 */
export function markdownStats(text) {
  const source = String(text ?? '');
  const words = source.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)?.length ?? 0;
  const lines = source === '' ? 0 : source.split(/\r?\n/).length;
  return { words, lines };
}
