// Small helpers shared across the evaluator. No dependencies, so any module may import them.

export function fail(message) {
  throw new Error(message);
}

// The one text for a ${variable} / sourceVariable that is not in the environment. It says where such a value can come
// from, because the usual cause is a variable that another stage (or nobody) set.
export function missingVariableMessage(name) {
  const scope =
    name === 'entityIdSourceSystem'
      ? 'in a source → target run a source mapping with targetVariable also sets it for the target stage'
      : 'a variable set by the source stage is not visible to the target stage';
  return `Missing context variable: ${name}. Supply it under "variables" in the runtime context, or set it earlier in the same stage with targetVariable (${scope}).`;
}

export function own(object, key) {
  return object != null && Object.hasOwn(object, key);
}

export function clone(value) {
  return value === null || typeof value !== 'object' ? value : structuredClone(value);
}

// Structural, order-independent JSON equality. Arrays compare in order, objects by key set.
// `undefined` (a missing path) equals only `undefined`, never `null`.
export function equal(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((item, i) => equal(item, b[i]));
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]));
}

// Keys that would let user-supplied names reach Object.prototype.
export const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const simpleEscapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' };

// Decodes the body of a quoted string literal (quotes already stripped).
export function unescapeQuoted(raw) {
  return raw.replace(/\\(u[0-9a-fA-F]{4}|[\s\S])/g, (_, escape) => {
    if (escape.length === 5) return String.fromCharCode(parseInt(escape.slice(1), 16));
    return simpleEscapes[escape] ?? escape;
  });
}

// Characters that end a dot-notation property name inside a path or a filter condition.
export const pathNamePattern = /[^.[\]()\s!,<>=&|'"*~^]+/y;

// Returns the index after the quoted literal starting at `start`.
export function skipQuoted(text, start) {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length && text[i] !== quote) i += text[i] === '\\' ? 2 : 1;
  return i + 1;
}

function skipRegexLiteral(text, start) {
  let i = start + 1;
  while (i < text.length && text[i] !== '/') i += text[i] === '\\' ? 2 : 1;
  return i + 1;
}

// Walks a filter condition starting at its opening `(`; returns the index of the matching `)`
// or -1 when unterminated. String and regex literals are skipped; `onReference(index)` is
// called at each `@`/`$` outside literals and returns the index to continue from.
export function scanFilterBody(text, start, onReference) {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const char = text[i];
    if (char === '"' || char === "'") {
      i = skipQuoted(text, i);
    } else if (char === '/' && text.slice(start, i).trimEnd().endsWith('=~')) {
      i = skipRegexLiteral(text, i);
    } else if (onReference && (char === '@' || char === '$')) {
      i = onReference(i);
    } else {
      if (char === '(') depth++;
      if (char === ')' && --depth === 0) return i;
      i++;
    }
  }
  return -1;
}

function skipSpaceBefore(text, start, chars) {
  let i = start;
  while (/\s/.test(text[i] ?? '')) i++;
  return chars.includes(text[i]) ? i : start;
}

// Collects the property names of one `$`/`@` reference whose tail starts at `start`.
// Returns the index where the reference ends.
function collectReference(text, start, names) {
  let i = start;
  while (i < text.length) {
    i = skipSpaceBefore(text, i, '[.');
    if (text[i] === '.') {
      i += text[i + 1] === '.' ? 2 : 1;
      pathNamePattern.lastIndex = i;
      const name = pathNamePattern.exec(text);
      if (name) {
        names.push(name[0]);
        i += name[0].length;
      }
    } else if (text[i] === '[') {
      i = collectBracket(text, i, names);
    } else {
      break;
    }
  }
  return i;
}

function collectBracket(text, open, names) {
  let i = skipSpaceBefore(text, open + 1, '?');
  if (text[i] === '?') {
    const close = scanFilterBody(text, i + 1, (at) => collectReference(text, at + 1, names));
    return close < 0 ? text.length : close + 2;
  }
  while (i < text.length && text[i] !== ']') {
    if (text[i] === '"' || text[i] === "'") {
      const end = skipQuoted(text, i);
      names.push(unescapeQuoted(text.slice(i + 1, end - 1)));
      i = end;
    } else {
      i++;
    }
  }
  return i + 1;
}

// Rejects a JSONPath/target path when a property SEGMENT is a prototype-reaching key.
// Names that merely contain such a word (`constructorName`) and string literals inside
// filters are legitimate.
export function assertSafePath(path, where = 'path') {
  const names = [];
  collectReference(path, 1, names);
  const unsafe = names.find((name) => forbidden.has(name));
  if (unsafe !== undefined) fail(`Unsafe property in ${where}: ${unsafe}`);
}

export function propertyKey(value, where) {
  if (typeof value !== 'string' || forbidden.has(value)) fail(`Invalid or unsafe ${where}`);
  return value;
}

export function checkKeys(object, allowedKeys, where) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) fail(`${where} must be an object`);
  for (const key of Object.keys(object)) {
    if (!allowedKeys.includes(key)) fail(`Unsupported ${where} property: ${key}`);
  }
}

export const NEGATIVE_LOOKAHEAD_MESSAGE = 'Negative lookahead is rejected by the documented IPS regex validation';
