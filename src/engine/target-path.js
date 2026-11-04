import { located, validationFailure } from './condition-tokenizer.js';
import { IpsError, failWith, within } from './errors.js';
import { readPath, unsafeName } from './jsonpath.js';
import { filterBodies, leadingPlaceholderLength, maskPlaceholders } from './path-text.js';
import { assertSafePath, clone, forbidden } from './util.js';

// Target paths are written, not queried, so only definite paths plus `[*]` wildcards and
// the `[?(@.attribute)]` projection are understood. Anything else fails explicitly. The project's
// own JSONPath evaluator (jsonpath.js) reads the existing array a wildcard or projection merges
// into; writes and removals walk the parsed tokens themselves because they need parents, not values.

const tokenPattern = /^(?:\.([A-Za-z_$][\w$-]*)|\[(\d+)\]|\[['"]([^'"]+)['"]\]|(\[\*\]))/;
const ALL = Symbol('wildcard');

function unsupportedError(path) {
  return new IpsError(
    'UNSUPPORTED',
    `Unsupported target JSONPath: ${path}. Use definite paths, [*] or [?(@.attribute)] projection.`,
  );
}

// `start` is where the first segment begins: 1 after the root `$`; validation passes a later index when a
// leading placeholder stands in for the root. A failure carries the failing range (see `located`).
function scanTokens(path, allowWildcard, start = 1) {
  if (typeof path !== 'string' || !path.startsWith('$')) failWith('PATH_ERROR', 'Target JSONPath must start with $');
  const tokens = [];
  let i = start;
  while (i < path.length) {
    const part = path.slice(i).match(tokenPattern);
    if (!part || (part[4] && !allowWildcard)) throw located(unsupportedError(path), i, path.length - i);
    const key = part[4] ? ALL : (part[1] ?? (part[2] !== undefined ? Number(part[2]) : part[3]));
    if (forbidden.has(key)) {
      const unsafe = new IpsError('PATH_ERROR', `Unsafe target property: ${key}`);
      throw located(unsafe, i, part[0].length, 'unsafe');
    }
    tokens.push(key);
    i += part[0].length;
  }
  return tokens;
}

// Splits `$.a[0]['b']` into ['a', 0, 'b']. Wildcards are not definite and are rejected.
export function pathTokens(path) {
  return scanTokens(path, false);
}

function containerFor(nextToken) {
  return typeof nextToken === 'number' ? [] : {};
}

// A token must address the kind of container it lands in: a name on an array or an index on an
// object would write a property JSON cannot carry, and an index past the end would leave holes.
function checkSlot(node, key) {
  if (Array.isArray(node)) {
    if (typeof key !== 'number') failWith('PATH_ERROR', `Cannot write property "${key}" on an array in the target`);
    if (key > node.length) {
      failWith('PATH_ERROR', `Target index ${key} is beyond the array length ${node.length}; gaps are not created`);
    }
  } else if (typeof key === 'number') {
    failWith('PATH_ERROR', `Cannot write index [${key}] on an object in the target`);
  }
}

// Sets the value at the token path, creating missing parents. Returns the root.
export function writeAt(root, tokens, value) {
  if (!tokens.length) return clone(value);
  if (root === null || typeof root !== 'object') root = containerFor(tokens[0]);

  let node = root;
  for (let i = 0; i < tokens.length - 1; i++) {
    const key = tokens[i];
    checkSlot(node, key);
    if (node[key] === null || typeof node[key] !== 'object') node[key] = containerFor(tokens[i + 1]);
    node = node[key];
  }
  const key = tokens.at(-1);
  checkSlot(node, key);
  node[key] = clone(value);
  return root;
}

function removeKey(node, key) {
  if (Array.isArray(node)) {
    if (typeof key === 'number') node.splice(key, 1);
  } else if (typeof key === 'string') {
    delete node[key];
  }
}

// Removes everything the token path selects; paths that select nothing change nothing and
// never create the parents they walk through.
function removeFrom(node, tokens, at) {
  if (node === null || typeof node !== 'object') return;
  const key = tokens[at];
  const last = at === tokens.length - 1;

  if (key === ALL) {
    if (last) {
      if (Array.isArray(node)) node.length = 0;
      else for (const name of Object.keys(node)) delete node[name];
    } else {
      for (const child of Array.isArray(node) ? node : Object.values(node)) removeFrom(child, tokens, at + 1);
    }
  } else if (last) {
    removeKey(node, key);
  } else if (Array.isArray(node) ? typeof key === 'number' : typeof key === 'string') {
    removeFrom(node[key], tokens, at + 1);
  }
}

function removePath(root, path) {
  const tokens = scanTokens(path, true);
  if (!tokens.length) return {};
  removeFrom(root, tokens, 0);
  return root;
}

function readExisting(root, base) {
  return within('PATH_ERROR', () => readPath(root, base)) ?? [];
}

function writeWildcard(root, base, tail, value) {
  const existing = readExisting(root, base);
  const values = Array.isArray(value) ? value : [value];
  // The base path is tokenised (and may fail) before any member is written.
  const tokens = pathTokens(base);
  const merged = values.map((item, i) => writePath(clone(existing[i] ?? {}), '$' + tail, item));
  return writeAt(root, tokens, merged);
}

function writeProjection(root, base, attribute, tail, value) {
  if (forbidden.has(attribute)) failWith('PATH_ERROR', 'Unsafe projection property');
  const existing = readExisting(root, base);
  if (!Array.isArray(existing)) failWith('PATH_ERROR', 'Projected target must be an array');
  const items = Array.isArray(value) ? value : [value];
  const projected = items.map((item, i) =>
    writeAt(clone(existing[i] ?? {}), pathTokens('$.' + attribute + tail), item),
  );
  return writeAt(root, pathTokens(base), projected);
}

// How a set/valueMapping write reads its path: the last `[*]` splits it into a base and a tail, else a
// `[?(@.attribute)]` projection does, else it is a plain token path.
function planWrite(path) {
  const wildcard = path.match(/^(.*)\[\*\](.*)$/);
  if (wildcard) return { kind: 'wildcard', base: wildcard[1], tail: wildcard[2] };
  const projection = path.match(/^(.*)\[\?\(@\.([\w$-]+)\)\](.*)$/);
  if (projection) return { kind: 'projection', base: projection[1], attribute: projection[2], tail: projection[3] };
  return { kind: 'tokens' };
}

function nestedWildcardError(path) {
  return new IpsError('UNSUPPORTED', `Nested [*] wildcards are not supported in a target path: ${path}`);
}

export function writePath(root, path, value, remove = false) {
  assertSafePath(path, 'targetPath');
  if (remove) {
    if (/\[\?\(/.test(path)) failWith('UNSUPPORTED', 'Remove on projected paths is unsupported');
    return removePath(root, path);
  }

  const plan = planWrite(path);
  if (plan.kind === 'wildcard') {
    if (plan.base.includes('[*]')) throw nestedWildcardError(path);
    return writeWildcard(root, plan.base, plan.tail, value);
  }
  if (plan.kind === 'projection') return writeProjection(root, plan.base, plan.attribute, plan.tail, value);
  return writeAt(root, pathTokens(path), value);
}

// ---- validation ---------------------------------------------------------------------------------------------

// Scans `path` like the writer does; `place` maps a failure's offset in `path` to an offset in the checked text.
function checkTokens(path, allowWildcard, start, place) {
  try {
    return scanTokens(path, allowWildcard, start);
  } catch (error) {
    if (error.offset !== undefined) {
      const at = place(error.offset);
      error.length = Math.min(error.length, Math.max(1, path.length - error.offset));
      error.offset = at;
    }
    throw error;
  }
}

function checkSet(path, shift, start) {
  const place = (offset) => offset + shift;
  const plan = planWrite(path);
  if (plan.kind === 'tokens') return void checkTokens(path, false, start, place);

  if (plan.kind === 'wildcard') {
    const { base, tail } = plan;
    if (base.includes('[*]')) throw located(nestedWildcardError(path), shift + base.length, 3);
    checkTokens(base, false, start, place);
    return checkSet('$' + tail, shift + base.length + 2, 1);
  }

  const { base, attribute, tail } = plan;
  const attributeAt = shift + base.length + '[?(@.'.length;
  if (forbidden.has(attribute)) {
    throw located(new IpsError('PATH_ERROR', 'Unsafe projection property'), attributeAt, attribute.length, 'unsafe');
  }
  const prefix = 2 + attribute.length;
  const tailAt = attributeAt + attribute.length + ')]'.length;
  checkTokens('$.' + attribute + tail, false, 1, (offset) =>
    offset < prefix ? attributeAt + offset - 2 : tailAt + offset - prefix,
  );
  return void checkTokens(base, false, start, place);
}

function checkRemove(path, start) {
  const projection = path.indexOf('[?(');
  if (projection >= 0) {
    const error = new IpsError('UNSUPPORTED', 'Remove on projected paths is unsupported');
    throw located(error, projection, path.length - projection);
  }
  checkTokens(path, true, start, (offset) => offset);
}

function checkRename(path, start) {
  const tokens = checkTokens(path, false, start, (offset) => offset);
  if (!tokens.length) {
    throw located(new IpsError('INVALID_CONFIG', 'rename cannot rename the document root'), 0, path.length);
  }
}

function checkTargetPath(text, kind) {
  if (typeof text !== 'string') throw located(new Error('Target JSONPath must be a string'), 0, 1, 'start');
  const lead = leadingPlaceholderLength(text);
  if (!lead && !text.startsWith('$')) {
    throw located(new Error('Target JSONPath must start with $'), 0, Math.min(Math.max(text.length, 1), 8), 'start');
  }

  // Same order as the evaluator: placeholders outside filters are resolved, then the path is checked.
  const filler = maskPlaceholders(text, filterBodies(text));
  const path = lead ? '$' + filler.slice(1) : filler;
  const first = lead || 1;

  try {
    assertSafePath('$' + path.slice(first), 'targetPath');
  } catch (error) {
    const found = unsafeName(path, first);
    throw found ? located(error, found.offset, found.length, 'unsafe') : located(error, 0, text.length, 'unsafe');
  }
  if (kind === 'remove') checkRemove(path, first);
  else if (kind === 'rename') checkRename(path, first);
  else checkSet(path, 0, first);
}

// Parse-only check of a targetPath exactly as the writer would split it, without a document. `kind` is the
// mapping that uses it: 'set' (also valueMapping), 'remove' or 'rename'. `${variable}` / `%property%` outside
// filters are masked with same-length filler; a path that starts with one is checked from the end of that
// placeholder. Returns { ok: true } or { ok: false, error: { domain: 'target', kind, message, offset?, length? } }
// with kind 'start' | 'unsafe' | 'path'. Not judged: what the document already holds (writing a name into an
// array, an index past its end).
export function validateTargetPath(text, kind = 'set') {
  try {
    checkTargetPath(text, kind);
    return { ok: true };
  } catch (error) {
    const failure = validationFailure(error, 'target', 'path');
    if (failure.offset !== undefined && failure.length !== undefined) {
      failure.length = Math.max(1, Math.min(failure.length, text.length - failure.offset));
    }
    return { ok: false, error: failure };
  }
}
