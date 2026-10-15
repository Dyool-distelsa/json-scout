/**
 * MongoDB-style queries over a parsed JSON value, for the Query panel:
 *
 *   { age: { $gt: 30 }, "address.city": "Lima" }
 *   { tags: { $in: ["a", "b"] } }, { name: 1, age: 1 }
 *   { $or: [{ status: "A" }, { qty: { $lt: 30 } }] }.sort({ qty: -1 }).limit(10)
 *
 * The "collection" is the root array, or, when the root is not an array,
 * every object in the document at any depth. Input may use the shell's
 * relaxed syntax: unquoted keys, single quotes, /regex/flags and trailing
 * commas. Matching follows MongoDB: a dotted path walks into arrays, and a
 * condition on an array field matches when any element does.
 */

/** Whether `expression` should be read as a Mongo query rather than JSONPath. */
export function isMongoQuery(expression) {
  const trimmed = expression.trim();
  return trimmed.startsWith('{') || /^(db\.[\w$]+\.)?find\s*\(/.test(trimmed);
}

/**
 * @param {*} data parsed JSON
 * @param {string} expression
 * @returns {{ results: Array<{ path: string, value: * }>, count: number }}
 *   `count` is the number of matches before skip/limit
 */
export function mongoFind(data, expression) {
  const { filter, projection, sort, skip, limit, countOnly } = parseMongoExpression(expression);
  let docs = collection(data).filter(({ value }) => matches(value, filter));
  const count = docs.length;
  if (countOnly) return { results: [{ path: 'count()', value: count }], count };
  if (sort) docs = sortDocs(docs, sort);
  if (skip) docs = docs.slice(skip);
  if (limit) docs = docs.slice(0, limit);
  const results = projection ? docs.map((d) => ({ path: d.path, value: project(d.value, projection) })) : docs;
  return { results, count };
}

// --- Parsing ---------------------------------------------------------------

/**
 * Split `{filter}, {projection}` plus `.sort()/.skip()/.limit()/.count()`
 * calls; `find(...)` / `db.coll.find(...)` wrappers are accepted.
 */
export function parseMongoExpression(expression) {
  const parser = relaxedParser(expression.trim().replace(/^db\.[\w$]+\./, ''));
  let args;
  if (parser.peekWord('find')) {
    parser.word('find');
    args = parser.args();
  } else {
    args = [parser.value()];
    if (parser.tryChar(',')) args.push(parser.value());
  }
  const [filter = {}, projection] = args;
  if (!isPlainObject(filter)) throw new Error('The filter must be an object, like { name: "x" }');
  if (projection !== undefined && !isPlainObject(projection)) throw new Error('The projection must be an object, like { name: 1 }');

  const query = { filter, projection: projection && Object.keys(projection).length ? projection : null, sort: null, skip: 0, limit: 0, countOnly: false };
  while (parser.tryChar('.')) {
    const name = parser.identifier();
    const [arg] = parser.args();
    if (name === 'sort') {
      if (!isPlainObject(arg)) throw new Error('sort() takes an object, like { age: -1 }');
      query.sort = arg;
    } else if (name === 'skip' || name === 'limit') {
      if (!Number.isInteger(arg) || arg < 0) throw new Error(`${name}() takes a whole number`);
      query[name] = arg;
    } else if (name === 'count' || name === 'countDocuments') {
      query.countOnly = true;
    } else {
      throw new Error(`Unsupported method .${name}()`);
    }
  }
  parser.end();
  return query;
}

/** A small parser for the shell's relaxed object syntax. */
function relaxedParser(text) {
  let i = 0;
  const fail = (message) => {
    throw new Error(`${message} at position ${i + 1}`);
  };
  const ws = () => {
    while (i < text.length && /\s/.test(text[i])) i += 1;
  };
  const tryChar = (ch) => {
    ws();
    if (text[i] === ch) {
      i += 1;
      return true;
    }
    return false;
  };
  const expect = (ch) => {
    if (!tryChar(ch)) fail(`Expected '${ch}'`);
  };
  const identifier = () => {
    ws();
    const match = /^[A-Za-z_$][\w$.]*/.exec(text.slice(i));
    if (!match) fail('Expected a name');
    i += match[0].length;
    return match[0];
  };
  const string = () => {
    const quote = text[i];
    i += 1;
    let out = '';
    while (i < text.length && text[i] !== quote) {
      if (text[i] === '\\') {
        i += 1;
        const esc = text[i];
        const map = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' };
        if (esc === 'u') {
          out += String.fromCharCode(parseInt(text.slice(i + 1, i + 5), 16));
          i += 4;
        } else out += map[esc] ?? esc;
      } else out += text[i];
      i += 1;
    }
    if (i >= text.length) fail('Unterminated string');
    i += 1;
    return out;
  };
  const regex = () => {
    i += 1;
    let source = '';
    let inClass = false;
    while (i < text.length && (text[i] !== '/' || inClass)) {
      if (text[i] === '\\') {
        source += text[i] + (text[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (text[i] === '[') inClass = true;
      else if (text[i] === ']') inClass = false;
      source += text[i];
      i += 1;
    }
    if (i >= text.length) fail('Unterminated regular expression');
    i += 1;
    const flags = /^[gimsuy]*/.exec(text.slice(i))[0];
    i += flags.length;
    return new RegExp(source, flags.replace('g', ''));
  };
  const value = () => {
    ws();
    const ch = text[i];
    if (ch === '{') {
      i += 1;
      const obj = {};
      while (!tryChar('}')) {
        ws();
        const key = text[i] === '"' || text[i] === "'" ? string() : identifier();
        expect(':');
        obj[key] = value();
        if (!tryChar(',')) {
          expect('}');
          break;
        }
      }
      return obj;
    }
    if (ch === '[') {
      i += 1;
      const arr = [];
      while (!tryChar(']')) {
        arr.push(value());
        if (!tryChar(',')) {
          expect(']');
          break;
        }
      }
      return arr;
    }
    if (ch === '"' || ch === "'") return string();
    if (ch === '/') return regex();
    const number = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(text.slice(i));
    if (number) {
      i += number[0].length;
      return Number(number[0]);
    }
    const word = /^[A-Za-z_$][\w$]*/.exec(text.slice(i));
    if (word) {
      i += word[0].length;
      if (word[0] === 'true') return true;
      if (word[0] === 'false') return false;
      if (word[0] === 'null') return null;
      if (word[0] === 'undefined') return undefined;
      // ObjectId("..."), ISODate("..."), NumberLong(1), ... unwrap to their argument.
      if (/^(ObjectId|ISODate|NumberLong|NumberInt|NumberDecimal|Date)$/.test(word[0])) {
        const [inner] = args();
        return inner;
      }
      i -= word[0].length;
      fail(`Unexpected '${word[0]}'`);
    }
    fail(ch === undefined ? 'Unexpected end of query' : `Unexpected '${ch}'`);
    return undefined;
  };
  const args = () => {
    expect('(');
    const list = [];
    while (!tryChar(')')) {
      list.push(value());
      if (!tryChar(',')) {
        expect(')');
        break;
      }
    }
    return list;
  };
  return {
    value,
    args,
    identifier,
    tryChar,
    peekWord: (w) => {
      ws();
      return text.startsWith(w, i) && !/[\w$]/.test(text[i + w.length] ?? '');
    },
    word: (w) => {
      ws();
      i += w.length;
    },
    end: () => {
      ws();
      if (tryChar(';')) ws();
      if (i < text.length) fail(`Unexpected '${text[i]}'`);
    },
  };
}

// --- Collection ------------------------------------------------------------

/** The documents a query runs over, each with its JSONPath. */
function collection(data) {
  if (Array.isArray(data)) return data.map((value, index) => ({ path: `$[${index}]`, value }));
  const docs = [];
  const visit = (value, path) => {
    if (Array.isArray(value)) value.forEach((item, index) => visit(item, `${path}[${index}]`));
    else if (isPlainObject(value)) {
      docs.push({ path, value });
      for (const key of Object.keys(value)) visit(value[key], `${path}${keySegment(key)}`);
    }
  };
  visit(data, '$');
  return docs;
}

function keySegment(key) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

// --- Matching --------------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof RegExp);
}

/** Values at a dotted path; arrays along the way fan out, like MongoDB. */
function valuesAt(doc, path) {
  let current = [doc];
  for (const part of path.split('.')) {
    const next = [];
    for (const value of current) {
      if (Array.isArray(value)) {
        if (/^\d+$/.test(part) && Number(part) < value.length) next.push(value[Number(part)]);
        for (const item of value) if (isPlainObject(item) && part in item) next.push(item[part]);
      } else if (isPlainObject(value) && part in value) {
        next.push(value[part]);
      }
    }
    current = next;
  }
  return current;
}

export function matches(doc, filter) {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$and') return condition.every((f) => matches(doc, f));
    if (key === '$or') return condition.some((f) => matches(doc, f));
    if (key === '$nor') return !condition.some((f) => matches(doc, f));
    if (key.startsWith('$')) throw new Error(`Unsupported operator ${key}`);
    return matchField(valuesAt(doc, key), condition);
  });
}

function isOperatorObject(condition) {
  return isPlainObject(condition) && Object.keys(condition).length > 0 && Object.keys(condition).every((k) => k.startsWith('$'));
}

/** Each value plus, for an array, its elements (a condition can hit either). */
function expand(values) {
  return values.flatMap((v) => (Array.isArray(v) ? [v, ...v] : [v]));
}

function matchField(values, condition) {
  if (condition instanceof RegExp) return expand(values).some((v) => typeof v === 'string' && condition.test(v));
  if (!isOperatorObject(condition)) return expand(values).some((v) => equals(v, condition)) || (condition === null && values.length === 0);
  const options = condition.$options ?? '';
  return Object.entries(condition).every(([op, arg]) => {
    if (op === '$options') return true;
    switch (op) {
      case '$eq':
        return expand(values).some((v) => equals(v, arg)) || (arg === null && values.length === 0);
      case '$ne':
        return !matchField(values, arg);
      case '$gt':
      case '$gte':
      case '$lt':
      case '$lte':
        return expand(values).some((v) => compareOp(op, v, arg));
      case '$in':
        return arg.some((a) => matchField(values, a));
      case '$nin':
        return !arg.some((a) => matchField(values, a));
      case '$exists':
        return arg ? values.length > 0 : values.length === 0;
      case '$regex': {
        const re = arg instanceof RegExp ? new RegExp(arg.source, arg.flags + options.replace(/[^imsu]/g, '')) : new RegExp(arg, options);
        return expand(values).some((v) => typeof v === 'string' && re.test(v));
      }
      case '$size':
        return values.some((v) => Array.isArray(v) && v.length === arg);
      case '$all':
        return values.some((v) => Array.isArray(v) && arg.every((a) => v.some((item) => equals(item, a))));
      case '$elemMatch':
        return values.some(
          (v) => Array.isArray(v) && v.some((item) => (isOperatorObject(arg) ? matchField([item], arg) : isPlainObject(item) && matches(item, arg)))
        );
      case '$type':
        return expand(values).some((v) => typeName(v) === arg || (arg === 'number' && typeof v === 'number'));
      case '$not':
        return !matchField(values, arg);
      default:
        throw new Error(`Unsupported operator ${op}`);
    }
  });
}

function typeName(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'double';
  if (typeof v === 'boolean') return 'bool';
  return typeof v;
}

function compareOp(op, a, b) {
  const comparable = (typeof a === 'number' && typeof b === 'number') || (typeof a === 'string' && typeof b === 'string');
  if (!comparable) return false;
  if (op === '$gt') return a > b;
  if (op === '$gte') return a >= b;
  if (op === '$lt') return a < b;
  return a <= b;
}

function equals(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k, idx) => k === kb[idx] && equals(a[k], b[k]));
}

// --- Sort and projection ---------------------------------------------------

const TYPE_ORDER = { undefined: 0, null: 1, number: 2, string: 3, object: 4, array: 5, boolean: 6 };

function sortKey(doc, path) {
  const [first] = valuesAt(doc, path);
  return first;
}

function compareValues(a, b) {
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
  if (ta !== tb) return (TYPE_ORDER[ta] ?? 9) - (TYPE_ORDER[tb] ?? 9);
  if (ta === 'number' || ta === 'string' || ta === 'boolean') return a < b ? -1 : a > b ? 1 : 0;
  return 0;
}

function sortDocs(docs, sort) {
  const keys = Object.entries(sort);
  return [...docs].sort((x, y) => {
    for (const [path, direction] of keys) {
      const order = compareValues(sortKey(x.value, path), sortKey(y.value, path));
      if (order !== 0) return direction < 0 ? -order : order;
    }
    return 0;
  });
}

function project(doc, projection) {
  if (!isPlainObject(doc)) return doc;
  const entries = Object.entries(projection);
  const including = entries.some(([key, on]) => on && key !== '_id');
  if (including) {
    const out = {};
    if (projection._id !== 0 && projection._id !== false && '_id' in doc) out._id = doc._id;
    for (const [path, on] of entries) {
      if (!on || path === '_id') continue;
      const [value] = valuesAt(doc, path);
      if (value !== undefined) setPath(out, path, value);
    }
    return out;
  }
  const out = structuredClone(doc);
  for (const [path] of entries) deletePath(out, path);
  return out;
}

function setPath(target, path, value) {
  const parts = path.split('.');
  let node = target;
  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(node[part])) node[part] = {};
    node = node[part];
  }
  node[parts[parts.length - 1]] = value;
}

function deletePath(target, path) {
  const parts = path.split('.');
  let node = target;
  for (const part of parts.slice(0, -1)) {
    if (!isPlainObject(node?.[part])) return;
    node = node[part];
  }
  delete node[parts[parts.length - 1]];
}
