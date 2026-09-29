/**
 * A small strict, hand-written recursive-descent JSON parser.
 *
 * We do not rely on the native `JSON.parse` error message for locating
 * syntax errors, because its wording and whether it reports a numeric
 * "position" at all varies across JS engines and even across error
 * kinds on the same engine. This parser instead tracks the exact
 * character index of the first problem itself, which `validate.js`
 * turns into a stable line/column.
 */

export class JsonSyntaxError extends Error {
  constructor(message, index) {
    super(message);
    this.name = 'JsonSyntaxError';
    this.index = index;
  }
}

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);

/**
 * Scan raw JSON-like text for the first CLOSING bracket (`]` or `}`) that
 * has no matching OPENING bracket of the same kind anywhere in the
 * currently active nesting. This is unambiguous: if a `]` shows up and no
 * `[` is open anywhere, that `]` cannot possibly be closing anything —
 * there is no guessing involved, unlike inferring a cause from whatever
 * downstream token the recursive-descent parser happened to choke on.
 *
 * String contents are skipped (respecting `\"` escapes) so brackets inside
 * string literals are never mistaken for structural ones.
 *
 * Also computes `insertAt`: the position where the value that should have
 * been wrapped in the missing bracket actually begins — the position right
 * after the nearest enclosing object's most recent property colon (and any
 * following whitespace), or 0 at the document root. This is best-effort:
 * it is `null` when the unmatched closer sits directly inside an array
 * (no colon to anchor the guess to), so callers must not attempt a
 * positional insertion in that case.
 *
 * A closing bracket whose type IS open somewhere in the stack, just not at
 * the top (e.g. `{"a":[1,2}`, missing a CLOSING `]`, not an opening `[`),
 * is a different bug shape entirely and is intentionally not reported
 * here — the ordinary recursive-descent parser already produces a
 * reasonable message for that case.
 *
 * @param {string} text
 * @returns {{ index: number, closer: '}'|']', missingOpener: '{'|'[', insertAt: number|null } | null}
 */
export function detectUnmatchedCloser(text) {
  const frames = [];
  const rootValueStart = 0;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];
    if (ch === '"') {
      i += 1;
      while (i < len && text[i] !== '"') {
        if (text[i] === '\\') i += 1;
        i += 1;
      }
      i += 1; // consume closing quote (or overshoot on an unterminated string)
      continue;
    }
    if (ch === '{' || ch === '[') {
      frames.push({ type: ch, lastValueStart: null });
      i += 1;
      continue;
    }
    if (ch === '}' || ch === ']') {
      const wantOpen = ch === '}' ? '{' : '[';
      const hasOpenAnywhere = frames.some((frame) => frame.type === wantOpen);
      if (!hasOpenAnywhere) {
        const top = frames[frames.length - 1];
        const insertAt = top ? top.lastValueStart : rootValueStart;
        return { index: i, closer: ch, missingOpener: wantOpen, insertAt };
      }
      if (frames[frames.length - 1].type === wantOpen) {
        frames.pop();
      } else {
        // The closer matches an opener further down the stack: treat
        // every frame from there up (including it) as closed, so
        // scanning can keep going meaningfully past this point.
        for (let j = frames.length - 1; j >= 0; j -= 1) {
          if (frames[j].type === wantOpen) {
            frames.length = j;
            break;
          }
        }
      }
      i += 1;
      continue;
    }
    if (ch === ':') {
      const top = frames[frames.length - 1];
      if (top && top.type === '{') {
        let j = i + 1;
        while (j < len && WHITESPACE.has(text[j])) j += 1;
        top.lastValueStart = j;
      }
      i += 1;
      continue;
    }
    i += 1;
  }
  return null;
}

/**
 * @param {string} text
 * @returns {*} the parsed JSON value
 * @throws {JsonSyntaxError}
 */
export function parseJsonStrict(text) {
  let i = 0;
  const len = text.length;

  function fail(message, at = i) {
    throw new JsonSyntaxError(message, at);
  }

  function skipWs() {
    while (i < len && WHITESPACE.has(text[i])) i += 1;
  }

  function parseValue() {
    skipWs();
    if (i >= len) fail('Unexpected end of JSON input');
    const ch = text[i];
    if (ch === '{') return parseObject();
    if (ch === '[') return parseArray();
    if (ch === '"') return parseString();
    if (ch === '-' || (ch >= '0' && ch <= '9')) return parseNumber();
    if (text.startsWith('true', i)) {
      i += 4;
      return true;
    }
    if (text.startsWith('false', i)) {
      i += 5;
      return false;
    }
    if (text.startsWith('null', i)) {
      i += 4;
      return null;
    }
    fail(`Unexpected token '${ch}'`);
    return undefined; // unreachable, keeps linters happy
  }

  function parseObject() {
    const obj = {};
    i += 1; // consume '{'
    skipWs();
    if (text[i] === '}') {
      i += 1;
      return obj;
    }
    for (;;) {
      skipWs();
      if (text[i] !== '"') fail("Expected a double-quoted property key");
      const key = parseString();
      skipWs();
      if (text[i] !== ':') fail("Expected ':' after property key");
      i += 1;
      const value = parseValue();
      obj[key] = value;
      skipWs();
      if (text[i] === ',') {
        i += 1;
        skipWs();
        if (text[i] === '}') fail('Trailing comma is not allowed in an object');
        continue;
      }
      if (text[i] === '}') {
        i += 1;
        break;
      }
      fail("Expected ',' or '}'");
    }
    return obj;
  }

  function parseArray() {
    const arr = [];
    i += 1; // consume '['
    skipWs();
    if (text[i] === ']') {
      i += 1;
      return arr;
    }
    for (;;) {
      const value = parseValue();
      arr.push(value);
      skipWs();
      if (text[i] === ',') {
        i += 1;
        skipWs();
        if (text[i] === ']') fail('Trailing comma is not allowed in an array');
        continue;
      }
      if (text[i] === ']') {
        i += 1;
        break;
      }
      fail("Expected ',' or ']'");
    }
    return arr;
  }

  function parseString() {
    const start = i;
    i += 1; // consume opening quote
    let result = '';
    for (;;) {
      if (i >= len) fail('Unterminated string', start);
      const ch = text[i];
      if (ch === '"') {
        i += 1;
        break;
      }
      if (ch === '\\') {
        i += 1;
        const esc = text[i];
        switch (esc) {
          case '"':
            result += '"';
            break;
          case '\\':
            result += '\\';
            break;
          case '/':
            result += '/';
            break;
          case 'b':
            result += '\b';
            break;
          case 'f':
            result += '\f';
            break;
          case 'n':
            result += '\n';
            break;
          case 'r':
            result += '\r';
            break;
          case 't':
            result += '\t';
            break;
          case 'u': {
            const hex = text.slice(i + 1, i + 5);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('Invalid unicode escape sequence', i - 1);
            result += String.fromCharCode(parseInt(hex, 16));
            i += 4;
            break;
          }
          default:
            fail(`Invalid escape character '${esc}'`, i - 1);
        }
        i += 1;
      } else if (ch.charCodeAt(0) < 0x20) {
        fail('Unescaped control character in string');
      } else {
        result += ch;
        i += 1;
      }
    }
    return result;
  }

  function parseNumber() {
    const start = i;
    if (text[i] === '-') i += 1;
    if (text[i] === '0') {
      i += 1;
    } else if (text[i] >= '1' && text[i] <= '9') {
      while (text[i] >= '0' && text[i] <= '9') i += 1;
    } else {
      fail('Invalid number', start);
    }
    if (text[i] === '.') {
      i += 1;
      if (!(text[i] >= '0' && text[i] <= '9')) fail('Invalid number', start);
      while (text[i] >= '0' && text[i] <= '9') i += 1;
    }
    if (text[i] === 'e' || text[i] === 'E') {
      i += 1;
      if (text[i] === '+' || text[i] === '-') i += 1;
      if (!(text[i] >= '0' && text[i] <= '9')) fail('Invalid number', start);
      while (text[i] >= '0' && text[i] <= '9') i += 1;
    }
    return Number(text.slice(start, i));
  }

  try {
    skipWs();
    const value = parseValue();
    skipWs();
    if (i < len) fail('Unexpected trailing characters after JSON value');
    return value;
  } catch (err) {
    // An unmatched closing bracket is determinate evidence of the real
    // cause, even when the recursive-descent parse above already failed
    // earlier for an unrelated-looking (but actually downstream) reason.
    // Prefer it over whatever symptom the ordinary parse produced.
    const unmatched = detectUnmatchedCloser(text);
    if (unmatched) {
      throw new JsonSyntaxError(
        `Unmatched '${unmatched.closer}': missing opening '${unmatched.missingOpener}'`,
        unmatched.index
      );
    }
    throw err;
  }
}
