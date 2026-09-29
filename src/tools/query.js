import { JSONPath } from 'jsonpath-plus';

/**
 * Run a JSONPath query against an already-parsed JSON value.
 * @param {*} data - parsed JSON value to query
 * @param {string} expression - a JSONPath expression, e.g. "$.store.book[*].author"
 * @returns {Array<{ path: string, value: * }>}
 * @throws {Error} if the expression is empty or malformed
 */
export function queryJson(data, expression) {
  if (!expression || typeof expression !== 'string' || expression.trim() === '') {
    throw new Error('JSONPath expression must be a non-empty string');
  }

  const matches = JSONPath({
    path: expression,
    json: data,
    resultType: 'all',
    // jsonpath-plus defaults to a safe, non-`eval` filter evaluator; do not
    // opt into eval mode here (that is the historical CVE surface).
  });

  return matches.map((match) => ({ path: match.path, value: match.value }));
}
