/**
 * Shared low-level helpers used across the tools layer for consistent
 * BOM handling and error-position reporting.
 */

const BOM = '﻿';

/**
 * Strip a single leading UTF-8 BOM character, if present.
 * @param {string} text
 * @returns {string}
 */
export function stripBOM(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  return text.charCodeAt(0) === 0xfeff ? text.slice(BOM.length) : text;
}

/**
 * Convert a 0-based character index into a 1-based { line, column } pair.
 * Treats "\r\n" as a single newline boundary so CRLF files do not get an
 * off-by-one column on the line following a CRLF.
 * @param {string} text
 * @param {number} index
 * @returns {{ line: number, column: number }}
 */
export function getLineColumn(text, index) {
  const clamped = Math.max(0, Math.min(index, text.length));
  let line = 1;
  let column = 1;
  let i = 0;
  while (i < clamped) {
    const ch = text[i];
    if (ch === '\r' && text[i + 1] === '\n') {
      line += 1;
      column = 1;
      i += 2;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      line += 1;
      column = 1;
      i += 1;
      continue;
    }
    column += 1;
    i += 1;
  }
  return { line, column };
}

/**
 * Best-effort extraction of a position (or line/column) from a native
 * JSON.parse SyntaxError message. Different JS engines phrase these
 * differently, so this covers the common shapes we might see.
 * @param {string} message
 * @returns {number|{line:number,column:number}|null}
 */
export function extractErrorPosition(message) {
  if (typeof message !== 'string') return null;

  const lineColMatch = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  if (lineColMatch) {
    return { line: Number(lineColMatch[1]), column: Number(lineColMatch[2]) };
  }

  const posMatch = message.match(/position\s+(\d+)/i);
  if (posMatch) {
    return Number(posMatch[1]);
  }

  return null;
}

/**
 * Compute the UTF-8 byte length of a string without allocating a byte
 * buffer (unlike `new TextEncoder().encode(text).length`, which builds
 * the full encoded buffer just to read `.length`). Walks UTF-16 code
 * units directly: 1 byte for ASCII, 2 for U+0080-U+07FF, 3 for
 * U+0800-U+FFFF (including unpaired surrogates, which UTF-8 encodes as
 * a 3-byte replacement character, matching TextEncoder's behavior), and
 * 4 for astral-plane characters formed by a valid surrogate pair.
 * @param {string} text
 * @returns {number}
 */
export function utf8ByteLength(text) {
  let bytes = 0;
  const len = text.length;
  for (let i = 0; i < len; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1; // consumed the low surrogate as part of this code point
      } else {
        bytes += 3; // unpaired high surrogate
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB'];

/**
 * Format a byte count as a human-readable string, picking the largest unit
 * in which the value is still >= 1 and promoting at 1024 — the single byte
 * formatter shared by the status bar, the Stats panel and the Minify toast.
 *
 * Two failure modes this deliberately avoids: a huge raw byte count (e.g.
 * "8472913 B" instead of "8.08 MB"), and a sub-1 value in an oversized unit
 * (e.g. "0.00 MB" instead of "1.02 KB"). Bytes are whole numbers, so the B
 * step renders with no decimals; every other step renders with 2.
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  if (unitIndex === 0) {
    return `${value} B`;
  }

  let rounded = Number(value.toFixed(2));
  // Rounding a value like 1023.9999 up to 1024.00 would defeat the "largest
  // unit" rule (it would read >= 1024 in its own unit) — promote once more
  // when that happens instead of ever printing e.g. "1024.00 MB".
  if (rounded >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    unitIndex += 1;
    rounded = Number((rounded / 1024).toFixed(2));
  }

  return `${rounded.toFixed(2)} ${BYTE_UNITS[unitIndex]}`;
}

/**
 * Pure arithmetic for the Minify success toast: how much a document shrank,
 * as both a byte delta and a percentage. Compare UTF-8 byte lengths (see
 * `utf8ByteLength`), not string lengths, when calling this.
 *
 * Handles the edge cases honestly instead of producing nonsense: a
 * zero-byte document never divides by zero (`savedPercent` is 0, not NaN),
 * and a document that did not shrink (already minified, or `afterBytes >=
 * beforeBytes`) reports `shrank: false` with `savedPercent` at exactly 0
 * (never -0).
 * @param {number} beforeBytes
 * @param {number} afterBytes
 * @returns {{ beforeBytes: number, afterBytes: number, savedBytes: number, savedPercent: number, shrank: boolean }}
 */
/**
 * Percentage a positive byte change represents of `beforeBytes`, shared by
 * `computeMinifySaving` and `computeFormatGrowth` so the two near-identical
 * shrink/grow calculations do not duplicate the same division-by-zero and
 * sign handling. Returns 0 (never NaN, never -0) whenever there is no
 * document to compare against or the change is not in the direction being
 * measured (a shrink passed to the growth side, or vice versa).
 * @param {number} beforeBytes
 * @param {number} changeBytes a delta already oriented in the direction of interest (positive means "more" in that direction)
 * @returns {number}
 */
function computeChangePercent(beforeBytes, changeBytes) {
  return beforeBytes > 0 && changeBytes > 0 ? (changeBytes / beforeBytes) * 100 : 0;
}

export function computeMinifySaving(beforeBytes, afterBytes) {
  const savedBytes = beforeBytes - afterBytes;
  const shrank = beforeBytes > 0 && savedBytes > 0;
  const savedPercent = computeChangePercent(beforeBytes, savedBytes);
  return { beforeBytes, afterBytes, savedBytes, savedPercent, shrank };
}

/**
 * Pure arithmetic for the Format success toast: how much a document grew,
 * as both a byte delta and a percentage. Mirrors `computeMinifySaving`
 * (which measures shrinkage) but for the opposite direction, since
 * formatting/pretty-printing typically adds whitespace rather than
 * removing it. Compare UTF-8 byte lengths (see `utf8ByteLength`), not
 * string lengths, when calling this.
 *
 * Handles the edge cases honestly: a zero-byte document never divides by
 * zero (`grownPercent` is 0, not NaN), and a document that did not grow
 * (already formatted with the same indent, or one that happened to shrink)
 * reports `grew: false` with `grownPercent` at exactly 0 (never -0).
 * `grownBytes` itself may be negative (formatting shrank the document);
 * only `grownPercent`, which is presentational, is clamped to 0 in that
 * case.
 * @param {number} beforeBytes
 * @param {number} afterBytes
 * @returns {{ beforeBytes: number, afterBytes: number, grownBytes: number, grownPercent: number, grew: boolean }}
 */
export function computeFormatGrowth(beforeBytes, afterBytes) {
  const grownBytes = afterBytes - beforeBytes;
  const grew = beforeBytes > 0 && grownBytes > 0;
  const grownPercent = computeChangePercent(beforeBytes, grownBytes);
  return { beforeBytes, afterBytes, grownBytes, grownPercent, grew };
}
