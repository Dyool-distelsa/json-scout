import { JSONPath } from 'jsonpath-plus';

/**
 * Turn the user's input into a JSONPath expression. Anything that does not
 * start with `$` or `@` is a key path to look for at any depth, so `author`
 * means `$..author` and `meta.id` means `$..meta.id`.
 * @param {string} expression
 * @returns {string}
 */
export function normalizeQuery(expression) {
  const trimmed = expression.trim();
  if (trimmed.startsWith('$') || trimmed.startsWith('@')) return trimmed;
  return `$..${trimmed.replace(/^\.+/, '')}`;
}

/**
 * Run a JSONPath query against an already-parsed JSON value.
 * @param {*} data - parsed JSON value to query
 * @param {string} expression - a JSONPath expression, e.g. "$.store.book[*].author",
 *   or a bare key path such as "author" (searched at any depth)
 * @returns {Array<{ path: string, value: * }>}
 * @throws {Error} if the expression is empty or malformed
 */
export function queryJson(data, expression) {
  if (!expression || typeof expression !== 'string' || expression.trim() === '') {
    throw new Error('JSONPath expression must be a non-empty string');
  }

  const matches = JSONPath({
    path: normalizeQuery(expression),
    json: data,
    resultType: 'all',
    // A filter such as `$..[?(@.a.b == 1)]` visits nodes that have no `a`;
    // without this the first such node aborts the whole query.
    ignoreEvalErrors: true,
    // jsonpath-plus defaults to a safe, non-`eval` filter evaluator; do not
    // opt into eval mode here (that is the historical CVE surface).
  });

  return matches.map((match) => ({ path: match.path, value: match.value }));
}
