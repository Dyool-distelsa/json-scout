const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Render a JSONPath-like string from an array of path segments.
 * The first segment is the root marker ('$'); subsequent segments are
 * either object keys (strings) or array indices (numbers).
 * @param {Array<string|number>} segments
 * @returns {string}
 */
export function pathToString(segments) {
  let result = String(segments[0]);
  for (let i = 1; i < segments.length; i += 1) {
    const seg = segments[i];
    if (typeof seg === 'number') {
      result += `[${seg}]`;
    } else if (IDENTIFIER_RE.test(seg)) {
      result += `.${seg}`;
    } else {
      result += `[${JSON.stringify(seg)}]`;
    }
  }
  return result;
}

function buildNode(value, key, segments) {
  const type = typeOf(value);
  const node = { key, type, path: pathToString(segments) };

  if (type === 'object' || type === 'array') {
    // Children are built lazily on first access (and memoized after
    // that), so constructing a node for a huge document does not walk
    // its entire subtree up front. Consumers such as `renderTreeNode`
    // can inspect `node.children` one level at a time, only paying for
    // grandchildren once a node is actually expanded.
    let cachedChildren = null;
    Object.defineProperty(node, 'children', {
      enumerable: true,
      configurable: true,
      get() {
        if (cachedChildren === null) {
          cachedChildren =
            type === 'object'
              ? Object.keys(value).map((childKey) =>
                  buildNode(value[childKey], childKey, [...segments, childKey])
                )
              : value.map((item, index) => buildNode(item, String(index), [...segments, index]));
        }
        return cachedChildren;
      },
    });
  } else {
    node.value = value;
  }

  return node;
}

/**
 * Build a collapsible tree representation of a parsed JSON value.
 * Each node carries its key, type, JSONPath-style path, and either a
 * `value` (leaves) or `children` (objects/arrays).
 * @param {*} value - an already-parsed JSON value
 * @param {string} [rootKey]
 * @returns {object}
 */
export function buildTree(value, rootKey = '$') {
  return buildNode(value, rootKey, [rootKey]);
}
