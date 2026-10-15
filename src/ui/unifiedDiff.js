/**
 * A line diff in the shape `git diff` prints: hunks of removed and added lines
 * with a few unchanged lines of context around them.
 */

/** Above this many cells (old × new changed lines) the LCS table is too costly. */
const MAX_LCS_CELLS = 4_000_000;

/** @param {string} text */
function splitLines(text) {
  if (text === '') return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * The edit script between two line lists: common prefix and suffix are kept
 * as context, the middle is aligned with a longest common subsequence.
 * @returns {{ type: ' '|'-'|'+', text: string }[]}
 */
function editScript(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const ops = a.slice(0, start).map((text) => ({ type: ' ', text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;

  if (n * m > MAX_LCS_CELLS) {
    for (const text of midA) ops.push({ type: '-', text });
    for (const text of midB) ops.push({ type: '+', text });
  } else {
    // lcs[i][j]: length of the LCS of midA[i..] and midB[j..].
    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        ops.push({ type: ' ', text: midA[i++] });
        j++;
      } else if (i < n && (j === m || lcs[i + 1][j] >= lcs[i][j + 1])) {
        // On a tie the removal goes first, as git prints them.
        ops.push({ type: '-', text: midA[i++] });
      } else {
        ops.push({ type: '+', text: midB[j++] });
      }
    }
  }
  for (const text of a.slice(endA)) ops.push({ type: ' ', text });
  return ops;
}

/**
 * @typedef {{ type: ' '|'-'|'+', text: string, oldLine: number|null, newLine: number|null }} DiffLine
 * @typedef {{ oldStart: number, oldCount: number, newStart: number, newCount: number, lines: DiffLine[] }} Hunk
 */

/**
 * @param {string} oldText
 * @param {string} newText
 * @param {{ context?: number }} [options]
 * @returns {{ hunks: Hunk[], added: number, removed: number }}
 */
export function unifiedDiff(oldText, newText, { context = 3 } = {}) {
  const ops = editScript(splitLines(oldText), splitLines(newText));
  let oldLine = 1;
  let newLine = 1;
  const lines = ops.map(({ type, text }) => ({
    type,
    text,
    oldLine: type === '+' ? null : oldLine++,
    newLine: type === '-' ? null : newLine++,
  }));

  const hunks = [];
  let added = 0;
  let removed = 0;
  let index = 0;
  while (index < lines.length) {
    if (lines[index].type === ' ') {
      index++;
      continue;
    }
    const from = Math.max(0, index - context);
    // Extend over changes until a run of more than 2×context unchanged lines.
    let to = index;
    let last = index;
    while (to < lines.length) {
      if (lines[to].type !== ' ') last = to;
      else if (to - last > 2 * context) break;
      to++;
    }
    const end = Math.min(lines.length, last + context + 1);
    const slice = lines.slice(from, end);
    for (const line of slice) {
      if (line.type === '+') added++;
      if (line.type === '-') removed++;
    }
    const oldCount = slice.filter((l) => l.type !== '+').length;
    const newCount = slice.filter((l) => l.type !== '-').length;
    const firstOld = slice.find((l) => l.oldLine !== null)?.oldLine ?? oldLineBefore(lines, from);
    const firstNew = slice.find((l) => l.newLine !== null)?.newLine ?? newLineBefore(lines, from);
    hunks.push({
      oldStart: oldCount === 0 ? firstOld - 1 : firstOld,
      oldCount,
      newStart: newCount === 0 ? firstNew - 1 : firstNew,
      newCount,
      lines: slice,
    });
    index = end;
  }
  return { hunks, added, removed };
}

function oldLineBefore(lines, index) {
  for (let i = index - 1; i >= 0; i--) if (lines[i].oldLine !== null) return lines[i].oldLine + 1;
  return 1;
}

function newLineBefore(lines, index) {
  for (let i = index - 1; i >= 0; i--) if (lines[i].newLine !== null) return lines[i].newLine + 1;
  return 1;
}

/** @param {Hunk} hunk */
export function hunkHeader(hunk) {
  const range = (start, count) => (count === 1 ? `${start}` : `${start},${count}`);
  return `@@ -${range(hunk.oldStart, hunk.oldCount)} +${range(hunk.newStart, hunk.newCount)} @@`;
}
