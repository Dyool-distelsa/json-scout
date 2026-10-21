/**
 * Pure helpers behind the Files panel's right-click actions (duplicate,
 * rename, new file, bulk format/minify/sort). The DOM and disk glue lives
 * in main.js; these are unit tested.
 */

/** Characters Windows refuses in a file or folder name. */
const INVALID_NAME = /[\\/:*?"<>|]/;

/**
 * What right-clicking a folder in the Files panel offers.
 * @returns {Array<{ kind: string, label: string } | { kind: 'separator' }>}
 */
export function folderChoices() {
  return [
    { kind: 'new-file', label: 'New JSON file…' },
    { kind: 'new-markdown', label: 'New Markdown file…' },
    { kind: 'rename', label: 'Rename…' },
    { kind: 'separator' },
    { kind: 'format', label: 'Format all JSON files' },
    { kind: 'minify', label: 'Minify all JSON files' },
    { kind: 'sort', label: 'Sort keys in all JSON files' },
  ];
}

/** The folder holding `path`, keeping its own separator style. */
export function parentDir(path) {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return index === -1 ? '' : path.slice(0, index);
}

/** `name` joined onto `dir` with the separator `dir` already uses. */
export function joinPath(dir, name) {
  const sep = dir.includes('\\') ? '\\' : '/';
  return dir.endsWith(sep) ? dir + name : `${dir}${sep}${name}`;
}

/** The last segment of `path`. */
export function entryName(path) {
  return path.slice(parentDir(path).length).replace(/^[\\/]/, '');
}

/**
 * A free name for a copy of `name`: "a copy.json", then "a copy 2.json", ...
 * @param {string} name
 * @param {string[]} taken names already in the folder (compared case-insensitively)
 */
export function duplicateName(name, taken) {
  const lower = new Set(taken.map((n) => n.toLowerCase()));
  const ext = /\.(json|md|markdown)$/i.exec(name)?.[0] ?? '';
  const dot = name.length - ext.length;
  const stem = name.slice(0, dot);
  for (let n = 1; ; n += 1) {
    const candidate = `${stem} copy${n === 1 ? '' : ` ${n}`}${ext}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}

/** `name` with a `.json` extension added when it has none. */
export function withJsonExtension(name) {
  return name.toLowerCase().endsWith('.json') ? name : `${name}.json`;
}

/** `name` with a `.md` extension added when it has no Markdown one. */
export function withMarkdownExtension(name) {
  return /\.(md|markdown)$/i.test(name) ? name : `${name}.md`;
}

/**
 * The name a renamed file ends up with: a JSON or Markdown extension typed by
 * the user is kept, otherwise the file keeps the extension it had.
 * @param {string} name typed name
 * @param {string} current the file's present name
 */
export function withKeptExtension(name, current) {
  if (/\.(json|md|markdown)$/i.test(name)) return name;
  return /\.(md|markdown)$/i.test(current) ? withMarkdownExtension(name) : withJsonExtension(name);
}

/**
 * Why `name` cannot be used for an entry in a folder, or null when it can.
 * @param {string} name already trimmed
 * @param {string[]} taken other names in that folder (case-insensitive)
 * @param {string} [current] the entry's present name, which is always allowed
 *   back (a case-only change included)
 */
export function nameProblem(name, taken, current) {
  if (!name) return 'Enter a name.';
  if (INVALID_NAME.test(name)) return 'A name cannot contain \\ / : * ? " < > |';
  if (name === '.' || name === '..' || /[. ]$/.test(name)) return 'A name cannot end with a dot or a space.';
  const lower = name.toLowerCase();
  if (current !== undefined && lower === current.toLowerCase()) return null;
  if (taken.some((n) => n.toLowerCase() === lower)) return `"${name}" already exists here.`;
  return null;
}

/**
 * The folder at `path` in the tree, or null.
 * @param {import('./sidebar.js').TreeDir} dir
 * @param {string} path
 */
export function findDir(dir, path) {
  if (dir.path === path) return dir;
  for (const child of dir.dirs) {
    const found = findDir(child, path);
    if (found) return found;
  }
  return null;
}

/**
 * Every file (JSON or Markdown) under `dir`, at any depth.
 * @param {import('./sidebar.js').TreeDir} dir
 * @returns {string[]}
 */
export function filesUnder(dir) {
  return [...dir.files.map((f) => f.path), ...dir.dirs.flatMap(filesUnder)];
}

/**
 * The names already used in `dir` (its subfolders and JSON files). Files
 * that are not JSON are not in the tree; the disk still refuses those.
 * @param {import('./sidebar.js').TreeDir} dir
 */
export function namesIn(dir) {
  return [...dir.dirs.map((d) => d.name), ...dir.files.map((f) => f.name)];
}

const OP_WORDS = {
  format: ['Format', 'formatted'],
  minify: ['Minify', 'minified'],
  sort: ['Sort keys in', 'sorted'],
};

/** Title of the confirmation for a bulk operation. */
export function bulkTitle(op, count, folder) {
  return `${OP_WORDS[op][0]} ${count} JSON file${count === 1 ? '' : 's'} in ${folder}?`;
}

/**
 * One-line summary of a `transform_json_files` report.
 * @param {string} op
 * @param {{ changed: number, unchanged: number, failed: Array<{ path: string }> }} report
 * @param {number} skipped files left out because they have unsaved edits
 */
export function bulkSummary(op, report, skipped = 0) {
  const parts = [`${report.changed} ${OP_WORDS[op][1]}`];
  if (report.unchanged) parts.push(`${report.unchanged} already done`);
  if (report.failed.length) parts.push(`${report.failed.length} not valid JSON`);
  if (skipped) parts.push(`${skipped} skipped (unsaved edits)`);
  return parts.join(', ');
}
