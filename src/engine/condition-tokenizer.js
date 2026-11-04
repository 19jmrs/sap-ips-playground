import { interpolate } from './environment.js';
import { pathMethodName } from './path-methods.js';
import { NEGATIVE_LOOKAHEAD_MESSAGE, fail, own, scanFilterBody, skipQuoted, unescapeQuoted } from './util.js';

// Token kinds: 'value' (literal or resolved ${variable} / %property%), 'path' ($ / @ reference),
// 'word' (identifier or keyword operator) and 'op' (punctuation and symbolic operators).
// Each scanner returns { token, next }. The parser matches operators by kind, so a quoted
// string can never act as punctuation or as an operator.
//
// Context interpolation happens here, per token, never over the raw condition text:
//   - inside a string literal: ${variable} / %property% are replaced by their text;
//   - outside literals: ${variable} / %property% become one typed value token;
//   - regex literals are left untouched, so `%` or `${` in a pattern is just pattern text;
//   - in a path reference only the text outside `[?(...)]` filters is interpolated, because
//     filter bodies are tokenized again when the filter runs.

const operatorPattern = /^(===|!==|==|!=|=~|<=|>=|&&|\|\||[!<>()[\],])/;
const numberPattern = /^-?\d+(?:\.\d+)?/;
const wordPattern = /^[A-Za-z_][\w.-]*/;
const variablePattern = /^\$\{([^}]+)\}/;
const propertyPattern = /^%([^%\s]+)%/;
const wordLiterals = { true: true, false: false, null: null };

// Validation (editor) mode: `env = { validate: true }` makes the tokenizer purely syntactic. Nothing is looked
// up and nothing is interpolated: a `${variable}` / `%property%` outside a literal becomes a value token with
// `placeholder: true`, and tokens carry `from` / `to` offsets into the scanned text. Failures carry `offset`
// and `length` (see `located`) so a caller can point at the offending text.

// Attaches the failing text range to an error without changing its message. The first location wins, so an
// inner (more precise) location is never overwritten by an outer scanner.
export function located(error, offset, length, kind) {
  error.offset ??= offset;
  if (length !== undefined) error.length ??= length;
  if (kind !== undefined) error.kind ??= kind;
  return error;
}

// The validation result shape shared by every validate* export:
// { domain, kind, message, offset?, length? }, `domain` and `kind` defaulting to the caller's own.
export function validationFailure(error, domain, kind) {
  return {
    domain: error.domain ?? domain,
    kind: error.kind ?? kind,
    message: error instanceof Error ? error.message : String(error),
    offset: error.offset,
    length: error.length,
  };
}

function interpolateText(text, env) {
  return env.validate ? text : String(interpolate(text, env));
}

function scanString(text, start, env) {
  const end = skipQuoted(text, start);
  if (end > text.length || text[end - 1] !== text[start]) fail('Unclosed condition string');
  const value = interpolateText(unescapeQuoted(text.slice(start + 1, end - 1)), env);
  return { token: { kind: 'value', value }, next: end };
}

function scanRegex(text, start) {
  let source = '';
  let i = start + 1;
  let closed = false;
  while (i < text.length) {
    if (text[i] === '/') {
      i++;
      closed = true;
      break;
    }
    // Keep the backslash and the escaped character together so `\/` does not end the literal.
    if (text[i] === '\\') source += text[i++];
    source += text[i++];
  }
  if (!closed) fail('Unclosed condition regex');
  let flags = '';
  while (/[imsu]/.test(text[i] ?? ' ') && i < text.length) flags += text[i++];
  try {
    if (source.includes('(?!')) fail(NEGATIVE_LOOKAHEAD_MESSAGE);
    return { token: { kind: 'value', value: new RegExp(source, flags) }, next: i };
  } catch (error) {
    throw located(error, start, i - start, 'regex');
  }
}

function scanContextValue(text, start, env) {
  const rest = text.slice(start);
  const variable = rest.match(variablePattern);
  if (variable) {
    const name = variable[1];
    const next = start + variable[0].length;
    if (env.validate) return { token: { kind: 'value', value: undefined, placeholder: true }, next };
    if (!own(env.variables, name)) fail(`Missing context variable: ${name}`);
    return { token: { kind: 'value', value: env.variables[name] }, next };
  }
  const property = rest.match(propertyPattern);
  if (property) {
    const name = property[1];
    const next = start + property[0].length;
    if (env.validate) return { token: { kind: 'value', value: undefined, placeholder: true }, next };
    if (!own(env.properties, name)) fail(`Missing context property: ${name}`);
    return { token: { kind: 'value', value: env.properties[name] }, next };
  }
  return null;
}

// Index of the `(` that opens a `[?(` filter whose `[` is at `open`, or -1.
function filterOpening(text, open) {
  const match = /^\[\s*\?\s*\(/.exec(text.slice(open, open + 32));
  return match ? open + match[0].length - 1 : -1;
}

// Tokenizes a filter body once. In validation mode a failure moves from body-relative to text-relative offsets;
// every nesting level shifts it once.
function tokenizeFilterBody(text, opening, closing, env) {
  try {
    return tokenize(text.slice(opening + 1, closing), env);
  } catch (error) {
    if (env.validate && error.offset !== undefined) error.offset += opening + 1;
    throw error;
  }
}

// A `$...` or `@...` reference runs until whitespace or an operator, except inside
// brackets, quotes, filters and a trailing path method call such as `.length()`.
function scanReference(text, start, env) {
  const filters = [];
  let bracketDepth = 0;
  let i = start + 1;
  while (i < text.length) {
    const char = text[i];
    if (char === '"' || char === "'") {
      i = skipQuoted(text, i);
    } else if (char === '[' && filterOpening(text, i) >= 0) {
      const opening = filterOpening(text, i);
      const closing = scanFilterBody(text, opening);
      if (closing < 0) {
        const unclosed = located(new Error('Unclosed JSONPath filter'), i, text.length - i, 'filter');
        throw Object.assign(unclosed, { domain: 'jsonpath' });
      }
      // The body is tokenized again per candidate; doing it once now surfaces missing
      // context and syntax errors even when no candidate exists.
      tokenizeFilterBody(text, opening, closing, env);
      filters.push([opening, closing + 1]);
      bracketDepth++;
      i = closing + 1;
    } else if (char === '[') {
      bracketDepth++;
      i++;
    } else if (char === ']') {
      // An unmatched `]` closes an array literal such as `[$.a, $.b]`; it is not part of the path.
      if (!bracketDepth) break;
      bracketDepth--;
      i++;
    } else if (bracketDepth) {
      i++;
    } else if (char === '(' && pathMethodName.test(text.slice(start, i)) && text[i + 1] === ')') {
      i += 2;
    } else if (/[\s()!,<>=&|]/.test(char)) {
      break;
    } else {
      i++;
    }
  }
  let path = '';
  let from = start + 1;
  for (const [opening, closing] of filters) {
    path += interpolateText(text.slice(from, opening), env) + text.slice(opening, closing);
    from = closing;
  }
  path += interpolateText(text.slice(from, i), env);
  return { token: { kind: 'path', value: '$' + path, reference: text[start] }, next: i };
}

function scanOperatorNumberOrWord(text, start) {
  const rest = text.slice(start);

  const operator = rest.match(operatorPattern);
  if (operator) return { token: { kind: 'op', value: operator[0] }, next: start + operator[0].length };

  const number = rest.match(numberPattern);
  if (number) return { token: { kind: 'value', value: Number(number[0]) }, next: start + number[0].length };

  const word = rest.match(wordPattern);
  if (word) {
    const name = word[0];
    const isLiteral = Object.hasOwn(wordLiterals, name);
    const token = { kind: isLiteral ? 'value' : 'word', value: isLiteral ? wordLiterals[name] : name };
    return { token, next: start + name.length };
  }

  if (rest[0] === '{') fail('Object literals are not supported in conditions; compare paths or use arrays');
  return fail(`Unsupported condition syntax at: ${rest.slice(0, 24)}`);
}

// Scans the token that starts at `start`; in validation mode a failure is located at that token.
function scanToken(text, start, env) {
  const char = text[start];
  try {
    let scanned = null;
    if (char === '"' || char === "'") scanned = scanString(text, start, env);
    else if (char === '/') scanned = scanRegex(text, start);
    else if (char === '$' || char === '%') scanned = scanContextValue(text, start, env);
    if (!scanned && (char === '$' || char === '@')) scanned = scanReference(text, start, env);
    return scanned ?? scanOperatorNumberOrWord(text, start);
  } catch (error) {
    if (!env.validate) throw error;
    const runsToEnd = char === '"' || char === "'" || char === '/';
    throw located(error, start, runsToEnd ? text.length - start : 1);
  }
}

export function tokenize(text, env) {
  const tokens = [];
  let i = 0;
  while (i < text.length) {
    if (/\s/.test(text[i])) {
      i++;
      continue;
    }
    const scanned = scanToken(text, i, env);
    tokens.push(env.validate ? { ...scanned.token, from: i, to: scanned.next } : scanned.token);
    i = scanned.next;
  }
  return tokens;
}
