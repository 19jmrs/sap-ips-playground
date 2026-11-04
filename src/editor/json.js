// Tolerant, position-aware JSON parser for editor services. Unlike JSON.parse it never throws:
// partial documents produce a tree whose nodes carry exact source ranges and an `incomplete` flag.

const MAX_DEPTH = 200;
const WHITESPACE = /\s/;
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/;
const WORD = /^[A-Za-z_][\w$-]*/;
const ESCAPES = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\', '/': '/' };

class Parser {
  constructor(text) {
    this.text = text;
    this.pos = 0;
    this.errors = [];
  }

  error(from, to, message) {
    this.errors.push({ from, to: Math.max(to, from + 1), message });
  }

  skipSpace() {
    while (this.pos < this.text.length && WHITESPACE.test(this.text[this.pos])) this.pos++;
  }

  parseValue(depth) {
    this.skipSpace();
    const { text } = this;
    const start = this.pos;
    if (start >= text.length) return null;
    const c = text[start];
    if (depth > MAX_DEPTH) {
      this.pos = text.length;
      this.error(start, text.length, 'Nesting is too deep to analyse');
      return { type: 'invalid', from: start, to: text.length };
    }
    if (c === '{') return this.parseObject(depth);
    if (c === '[') return this.parseArray(depth);
    if (c === '"') return this.parseString();
    const number = text.slice(start, start + 64).match(NUMBER);
    if (number) {
      this.pos += number[0].length;
      return { type: 'number', from: start, to: this.pos, value: Number(number[0]) };
    }
    const word = text.slice(start, start + 16).match(WORD);
    if (word) {
      this.pos += word[0].length;
      if (word[0] === 'true' || word[0] === 'false')
        return { type: 'boolean', from: start, to: this.pos, value: word[0] === 'true' };
      if (word[0] === 'null') return { type: 'null', from: start, to: this.pos, value: null };
      this.error(start, this.pos, `Unexpected "${word[0]}"`);
      return { type: 'invalid', from: start, to: this.pos };
    }
    if (c === ',' || c === '}' || c === ']' || c === ':') return null;
    this.pos++;
    this.error(start, this.pos, `Unexpected "${c}"`);
    return { type: 'invalid', from: start, to: this.pos };
  }

  parseString() {
    const { text } = this;
    const from = this.pos;
    let value = '';
    let map = null;
    const offsets = [];
    let i = from + 1;
    let closed = false;
    while (i < text.length) {
      const c = text[i];
      if (c === '"') {
        closed = true;
        i++;
        break;
      }
      if (c === '\n' || c === '\r') break;
      if (c === '\\') {
        map = true;
        const e = text[i + 1];
        if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
          offsets.push(i);
          value += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
          i += 6;
          continue;
        }
        offsets.push(i);
        value += ESCAPES[e] ?? e ?? '';
        i += e === undefined ? 1 : 2;
        continue;
      }
      offsets.push(i);
      value += c;
      i++;
    }
    this.pos = i;
    if (!closed) this.error(from, i, 'Unterminated string');
    offsets.push(closed ? i - 1 : i);
    return { type: 'string', from, to: i, value, closed, offsets: map ? offsets : null };
  }

  parseKey() {
    const { text } = this;
    if (text[this.pos] === '"') return this.parseString();
    // Unquoted identifier while typing: surface it as an unclosed key so completion can replace it.
    const from = this.pos;
    const word = text.slice(from, from + 128).match(/^[\w$-]+/);
    const to = from + (word ? word[0].length : 1);
    this.pos = to;
    this.error(from, to, 'Property names must be quoted');
    return {
      type: 'string',
      from,
      to,
      value: word ? word[0] : text[from],
      closed: false,
      unquoted: true,
      offsets: null,
    };
  }

  parseObject(depth) {
    const node = { type: 'object', from: this.pos, to: this.pos, props: [], closed: false, incomplete: false };
    this.pos++;
    for (;;) {
      this.skipSpace();
      if (this.pos >= this.text.length) break;
      const c = this.text[this.pos];
      if (c === '}') {
        this.pos++;
        node.closed = true;
        break;
      }
      if (c === ',') {
        this.error(this.pos, this.pos + 1, 'Unexpected ","');
        this.pos++;
        continue;
      }
      if (c === ']' || c === ':') {
        this.error(this.pos, this.pos + 1, `Unexpected "${c}"`);
        this.pos++;
        continue;
      }
      const key = this.parseKey();
      const prop = { key, value: null, colon: null, from: key.from, to: key.to };
      node.props.push(prop);
      if (!key.closed) node.incomplete = true;
      this.skipSpace();
      if (this.text[this.pos] === ':') {
        prop.colon = this.pos;
        this.pos++;
        prop.to = this.pos;
        prop.value = this.parseValue(depth + 1);
        if (prop.value) prop.to = prop.value.to;
        else node.incomplete = true;
      } else {
        node.incomplete = true;
        if (this.pos < this.text.length && this.text[this.pos] !== ',' && this.text[this.pos] !== '}')
          this.error(this.pos, this.pos + 1, 'Expected ":" after property name');
      }
      if (prop.value && (prop.value.incomplete || prop.value.type === 'invalid')) node.incomplete = true;
      this.skipSpace();
      prop.limit = this.pos;
      if (this.text[this.pos] === ',') this.pos++;
    }
    if (!node.closed) {
      node.incomplete = true;
      this.error(node.from, node.from + 1, 'Unclosed object');
    }
    node.to = this.pos;
    return node;
  }

  parseArray(depth) {
    const node = { type: 'array', from: this.pos, to: this.pos, items: [], closed: false, incomplete: false };
    this.pos++;
    for (;;) {
      this.skipSpace();
      if (this.pos >= this.text.length) break;
      const c = this.text[this.pos];
      if (c === ']') {
        this.pos++;
        node.closed = true;
        break;
      }
      if (c === ',' || c === '}' || c === ':') {
        this.error(this.pos, this.pos + 1, `Unexpected "${c}"`);
        this.pos++;
        continue;
      }
      const item = this.parseValue(depth + 1);
      if (!item) break;
      node.items.push(item);
      if (item.incomplete || item.type === 'invalid') node.incomplete = true;
      this.skipSpace();
      if (this.text[this.pos] === ',') this.pos++;
    }
    if (!node.closed) {
      node.incomplete = true;
      this.error(node.from, node.from + 1, 'Unclosed array');
    }
    node.to = this.pos;
    return node;
  }
}

export function parseJson(text) {
  const parser = new Parser(text);
  const root = parser.parseValue(0);
  parser.skipSpace();
  if (root && parser.pos < text.length) parser.error(parser.pos, text.length, 'Unexpected content after the document');
  return { root, errors: parser.errors };
}

// Document offset of the decoded character `index` inside a string node (index === value.length is the closing quote).
export function stringOffset(node, index) {
  if (node.offsets) return node.offsets[Math.min(index, node.offsets.length - 1)];
  return node.from + 1 + index;
}

// Number of decoded characters of a string node that precede document offset `pos`.
export function decodedIndex(node, pos) {
  if (!node.offsets) return Math.max(0, Math.min(pos - node.from - 1, node.value.length));
  let index = 0;
  while (index < node.value.length && node.offsets[index] < pos) index++;
  return index;
}

// Range of the string's content (between the quotes); an unclosed string extends to its end.
export function stringContent(node) {
  return { from: node.from + 1, to: node.closed ? node.to - 1 : node.to };
}

// Last occurrence wins, matching JSON.parse.
export function propMap(object) {
  const map = new Map();
  for (const prop of object.props) map.set(prop.key.value, prop);
  return map;
}

export function toValue(node, budget = { left: 20000 }) {
  if (!node || budget.left-- <= 0) return undefined;
  switch (node.type) {
    case 'object': {
      const out = {};
      for (const prop of node.props) {
        if (prop.value && prop.key.value !== '__proto__') out[prop.key.value] = toValue(prop.value, budget);
      }
      return out;
    }
    case 'array':
      return node.items.map((item) => toValue(item, budget));
    case 'invalid':
      return undefined;
    default:
      return node.value;
  }
}

// A value is "under" the cursor when the cursor is inside it (strings: between the quotes; others: touching).
function touches(node, pos) {
  if (node.type === 'string' && node.closed) return pos > node.from && pos < node.to;
  if ((node.type === 'object' || node.type === 'array') && node.closed) return pos >= node.from && pos < node.to;
  return pos >= node.from && pos <= node.to;
}

// Describes what surrounds `pos`: the containing object/array chain, and whether the cursor edits a key, a value or a gap.
export function locate(root, pos) {
  const path = [];
  const result = { path, container: null, where: 'outside', prop: null, node: null, index: null };
  let node = root;
  if (!node || pos < node.from) return result;
  for (;;) {
    if (node.type === 'object') {
      if (pos <= node.from || (node.closed && pos >= node.to)) return result;
      result.container = node;
      result.prop = null;
      result.node = null;
      const prop = node.props.find((p) => pos >= p.from && pos <= p.limit);
      if (!prop) {
        result.where = 'key';
        return result;
      }
      result.prop = prop;
      const key = prop.key;
      if (pos <= key.to) {
        const inside = pos > key.from && (key.closed ? pos < key.to : true);
        result.where = inside ? 'key' : pos === key.from ? 'key' : 'afterKey';
        result.node = inside ? key : null;
        return result;
      }
      if (prop.colon === null || pos <= prop.colon) {
        result.where = 'afterKey';
        return result;
      }
      const value = prop.value;
      if (!value || pos < value.from) {
        result.where = 'value';
        return result;
      }
      if (!touches(value, pos)) {
        result.where = 'afterValue';
        return result;
      }
      if ((value.type === 'object' || value.type === 'array') && pos > value.from) {
        path.push(key.value);
        node = value;
        continue;
      }
      result.where = 'value';
      result.node = value;
      return result;
    }
    if (node.type === 'array') {
      if (pos <= node.from || (node.closed && pos >= node.to)) return result;
      result.container = node;
      result.prop = null;
      result.node = null;
      const index = node.items.findIndex((item) => pos >= item.from && pos <= item.to);
      result.index = index < 0 ? node.items.length : index;
      if (index < 0) {
        result.where = 'item';
        return result;
      }
      const item = node.items[index];
      if (!touches(item, pos)) {
        result.where = 'afterValue';
        return result;
      }
      if ((item.type === 'object' || item.type === 'array') && pos > item.from) {
        path.push(index);
        node = item;
        continue;
      }
      result.where = 'item';
      result.node = item;
      return result;
    }
    return result;
  }
}
