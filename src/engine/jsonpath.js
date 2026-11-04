import { located, validationFailure } from './condition-tokenizer.js';
import { evaluateCondition, validateCondition } from './conditions.js';
import { applyPathMethod, pathMethodCall, pathMethodNames } from './path-methods.js';
import { filterBodies, leadingPlaceholderLength, maskPlaceholders } from './path-text.js';
import {
  assertSafePath,
  fail,
  forbidden,
  own,
  pathNamePattern,
  scanFilterBody,
  skipQuoted,
  unescapeQuoted,
} from './util.js';

// NOTE: this module and conditions.js import each other (a filter holds a condition,
// a condition holds paths). Both only call the other inside function bodies, never at
// load time, so ES module evaluation order cannot matter.

// Evaluator for the Jayway JsonPath dialect that the SAP documentation cites. It is written
// against Jayway's token sources (PropertyPathToken, ArrayIndexToken, ArraySliceToken,
// PredicatePathToken, ScanPathToken) rather than a JavaScript JSONPath library, because
// libraries disagree with Jayway on negative indices, name unions, slices and filters on
// objects. Supported segments:
//   .name  ['a']  ['a','b']  .*  [*]  [0]  [-1]  [0,2]  [1:3]  [:2]  [-2:]  [?(condition)]
// each optionally preceded by `..` (recursive descent). Anything else is an explicit error.
//
// Result shape (the same rule as Jayway): a path is "definite" when every segment names at
// most one node; a definite path yields one value (undefined when nothing matches), any other
// path yields an array. Evidence level: Jayway source (primary), not SAP-verified.

const functionHint = `Unsupported JSONPath function; supported: ${pathMethodNames.join(', ')}`;

// `kind` classifies the failure for validateJsonPath: 'syntax', 'filter' or 'function'.
function invalid(message, kind = 'syntax') {
  const error = new Error(`Unsupported or invalid JSONPath: ${message}`);
  error.kind = kind;
  throw error;
}

function skipSpace(text, start) {
  let i = start;
  while (/\s/.test(text[i] ?? '')) i++;
  return i;
}

function parseFilterBracket(path, open) {
  const opening = skipSpace(path, skipSpace(path, open + 1) + 1);
  if (path[opening] !== '(') return invalid('a filter must be written [?(condition)]', 'filter');
  const closing = scanFilterBody(path, opening);
  if (closing < 0) return invalid('unclosed filter', 'filter');
  const end = skipSpace(path, closing + 1);
  if (path[end] !== ']') return invalid('malformed filter, expected )] after the condition', 'filter');
  return { segment: { kind: 'filter', condition: path.slice(opening + 1, closing) }, end: end + 1 };
}

function parseQuotedNames(content) {
  const names = [];
  let i = 0;
  while (i < content.length) {
    if (content[i] !== '"' && content[i] !== "'") return invalid(`unexpected text in [${content}]`);
    const end = skipQuoted(content, i);
    if (content[end - 1] !== content[i] || end > content.length) return invalid(`unclosed string in [${content}]`);
    names.push(unescapeQuoted(content.slice(i + 1, end - 1)));
    i = skipSpace(content, end);
    if (i < content.length) {
      if (content[i] !== ',') return invalid(`unexpected text in [${content}]`);
      i = skipSpace(content, i + 1);
    }
  }
  return names;
}

function parseBracketContent(content) {
  if (content === '*') return { kind: 'wildcard' };
  if (/^["']/.test(content)) return { kind: 'names', names: parseQuotedNames(content) };
  if (/^-?\d+(?:\s*,\s*-?\d+)*$/.test(content)) return { kind: 'indexes', indexes: content.split(',').map(Number) };
  const slice = content.match(/^(-?\d+)?\s*:\s*(-?\d+)?$/);
  if (slice && (slice[1] !== undefined || slice[2] !== undefined)) {
    const from = slice[1] === undefined ? undefined : Number(slice[1]);
    const to = slice[2] === undefined ? undefined : Number(slice[2]);
    // Jayway resolves a two-sided slice with bounds of different sign in a way that depends on
    // its version, so it is rejected instead of guessed.
    if (from !== undefined && to !== undefined && from < 0 !== to < 0) {
      return invalid(`slice [${content}] mixes negative and non-negative bounds`);
    }
    return { kind: 'slice', from, to };
  }
  if (/^[^:]*:[^:]*:/.test(content)) return invalid(`slice [${content}]: steps are not part of the Jayway dialect`);
  return invalid(`unsupported bracket expression [${content}]`);
}

function parseBracket(path, open) {
  const inside = skipSpace(path, open + 1);
  if (path[inside] === '?') return parseFilterBracket(path, open);
  let i = inside;
  while (i < path.length && path[i] !== ']') i = path[i] === '"' || path[i] === "'" ? skipQuoted(path, i) : i + 1;
  if (path[i] !== ']') return invalid('unclosed [');
  return { segment: parseBracketContent(path.slice(inside, i).trim()), end: i + 1 };
}

function parseSegment(path, start) {
  const recursive = path.startsWith('..', start);
  const afterDots = start + (recursive ? 2 : path[start] === '.' ? 1 : 0);
  if (path[afterDots] === '[' && (recursive || afterDots === start)) {
    const { segment, end } = parseBracket(path, afterDots);
    return { segment: { ...segment, recursive }, end };
  }
  if (afterDots === start) return invalid(`unexpected "${path[start]}" at position ${start}`);
  if (path[afterDots] === '*') return { segment: { kind: 'wildcard', recursive }, end: afterDots + 1 };
  pathNamePattern.lastIndex = afterDots;
  const name = pathNamePattern.exec(path);
  if (!name) return invalid(`expected a property name at position ${afterDots}`);
  const end = afterDots + name[0].length;
  if (path[end] === '(') throw Object.assign(new Error(functionHint), { kind: 'function' });
  return { segment: { kind: 'names', names: [name[0]], recursive }, end };
}

// A segment is definite when it selects at most one node. A multi-name segment at the very
// end merges into one object (Jayway's multi-property leaf), so it is definite there too.
function markDefiniteness(segments) {
  let upstreamDefinite = true;
  segments.forEach((segment, position) => {
    const leaf = position === segments.length - 1;
    const single =
      !segment.recursive &&
      ((segment.kind === 'names' && (segment.names.length === 1 || leaf)) ||
        (segment.kind === 'indexes' && segment.indexes.length === 1));
    segment.definite = single;
    segment.upstreamDefinite = upstreamDefinite;
    segment.leaf = leaf;
    upstreamDefinite &&= single;
  });
}

// `start` is where the first segment begins: 1 after the root `$`, or later when validation has masked a
// leading placeholder. A failure is located at the start of the segment being parsed.
function parsePath(path, start = 1) {
  const segments = [];
  let i = start;
  while (i < path.length) {
    try {
      const { segment, end } = parseSegment(path, i);
      if (segment.kind === 'filter' && segment.recursive) {
        invalid('recursive descent directly followed by a filter ..[?()] is not supported', 'filter');
      }
      segments.push(segment);
      i = end;
    } catch (error) {
      throw located(error, i);
    }
  }
  markDefiniteness(segments);
  return segments;
}

function containersOf(node, found = []) {
  if (node === null || typeof node !== 'object') return found;
  found.push(node);
  for (const child of Array.isArray(node) ? node : Object.values(node)) containersOf(child, found);
  return found;
}

function indexRange(from, to) {
  return Array.from({ length: Math.max(0, to - from) }, (_, offset) => from + offset);
}

// Index selection of ArraySliceToken: [from:], [:to] and [from:to].
function sliceIndexes(length, { from, to }) {
  if (to === undefined) return indexRange(Math.max(0, from < 0 ? length + from : from), length);
  if (from === undefined) return indexRange(0, Math.min(length, to < 0 ? length + to : to));
  const end = Math.min(length, to);
  return indexRange(from, end).map((index) => (index < 0 ? length + index : index));
}

function describeType(value) {
  if (value === null) return 'null';
  return typeof value;
}

// `state.missing` records what Jayway's REQUIRE_PROPERTIES evaluation (the one behind a filter existence test) would
// reject as PathNotFound: a name that is absent from an object when it ends the path or follows only definite
// segments, a name or index applied to a non-container after only definite segments. Recursive descent never
// rejects. Absent names and non-containers further down an indefinite path are skipped silently.
function selectNames(segment, node, state) {
  const isObject = node !== null && typeof node === 'object' && !Array.isArray(node);
  if (!isObject) {
    if (segment.upstreamDefinite && !segment.recursive) state.missing = true;
    return [];
  }
  const present = segment.names.filter((name) => own(node, name));
  if (!segment.recursive && present.length < segment.names.length && (segment.leaf || segment.upstreamDefinite)) {
    state.missing = true;
  }
  if (segment.names.length === 1) return present.map((name) => node[name]);
  if (segment.leaf) return [Object.fromEntries(present.map((name) => [name, node[name]]))];
  return present.map((name) => node[name]);
}

function selectIndexes(segment, node, state) {
  if (!Array.isArray(node)) {
    if (segment.upstreamDefinite && !segment.recursive) state.missing = true;
    return [];
  }
  const indexes = segment.kind === 'slice' ? sliceIndexes(node.length, segment) : segment.indexes;
  return indexes
    .map((index) => (index < 0 ? node.length + index : index))
    .filter((index) => index >= 0 && index < node.length)
    .map((index) => node[index]);
}

function selectFiltered(segment, node, env) {
  const filterEnv = { ...env, filterMode: true, inPathFilter: true };
  const accepts = (candidate) => evaluateCondition(segment.condition, candidate, filterEnv);
  if (Array.isArray(node)) return node.filter(accepts);
  if (node !== null && typeof node === 'object') return accepts(node) ? [node] : [];
  if (segment.upstreamDefinite) fail(`A JSONPath filter cannot be applied to a ${describeType(node)} value`);
  return [];
}

function selectFrom(segment, node, env, state) {
  switch (segment.kind) {
    case 'names':
      return selectNames(segment, node, state);
    case 'wildcard':
      if (Array.isArray(node)) return node;
      return node !== null && typeof node === 'object' ? Object.values(node) : [];
    case 'filter':
      return selectFiltered(segment, node, env);
    default:
      return selectIndexes(segment, node, state);
  }
}

function select(data, segments, env, state) {
  let nodes = [data];
  for (const segment of segments) {
    const scope = segment.recursive ? nodes.flatMap((node) => containersOf(node)) : nodes;
    nodes = scope.flatMap((node) => selectFrom(segment, node, env, state));
  }
  return nodes;
}

// `found` is what a filter existence test `[?(@.x)]` asks, as in Jayway: evaluation raised no PathNotFound (see
// selectNames) and a definite path produced a value (null counts). An indefinite path exists even when it selected
// nothing, e.g. `@.items[?(@.k == 9)]` over an existing array.
export function resolvePath(data, path, env = { variables: {}, properties: {} }) {
  if (typeof path !== 'string' || !path.startsWith('$')) fail('JSONPath must start with $');
  assertSafePath(path, 'JSONPath');

  const method = path.match(pathMethodCall);
  if (method) {
    const base = resolvePath(data, path.slice(0, -method[0].length), env);
    const result = applyPathMethod(method[1], base.value);
    return { value: result, found: base.found && result !== undefined };
  }

  // `$` inside a filter means the document root, which is the data this call started from.
  const scoped = env.rootData === undefined ? { ...env, rootData: data } : env;
  const segments = parsePath(path);
  const state = { missing: false };
  const nodes = select(data, segments, scoped, state);
  const definite = segments.every((segment) => segment.definite);
  return {
    value: definite ? nodes[0] : nodes,
    found: !state.missing && (!definite || nodes.length > 0),
  };
}

export function readPath(data, path, env) {
  return resolvePath(data, path, env).value;
}

// ---- validation ---------------------------------------------------------------------------------------------

function problem(message, kind, offset, length) {
  return located(new Error(message), offset, length, kind);
}

// Where a prototype-reaching property name sits in `text` (the names assertSafePath rejects), if it can be found.
export function unsafeName(text, start) {
  for (const name of forbidden) {
    const found = new RegExp(`(?<![\\w$-])${name}(?![\\w$-])`).exec(text.slice(start));
    if (found) return { offset: start + found.index, length: name.length };
  }
  return null;
}

function checkJsonPath(text) {
  if (typeof text !== 'string') throw problem('JSONPath must be a string', 'start', 0, 1);
  const lead = leadingPlaceholderLength(text);
  if (!lead && !text.startsWith('$')) {
    throw problem('JSONPath must start with $', 'start', 0, Math.min(Math.max(text.length, 1), 8));
  }

  // Same order as the evaluator: placeholders outside filters are resolved, then the path is checked.
  const bodies = filterBodies(text);
  const filler = maskPlaceholders(text, bodies);
  let path = lead ? '$' + filler.slice(1) : filler;
  const first = lead || 1;

  try {
    assertSafePath('$' + path.slice(first), 'JSONPath');
  } catch (error) {
    const found = unsafeName(path, first);
    throw found ? located(error, found.offset, found.length, 'unsafe') : located(error, 0, text.length, 'unsafe');
  }

  for (let method = path.match(pathMethodCall); method; method = path.match(pathMethodCall)) {
    path = path.slice(0, -method[0].length);
  }
  parsePath(path, first);

  for (const [start, end] of bodies) {
    const result = validateCondition(text.slice(start + 1, end - 1), { inFilter: true });
    if (result.ok) continue;
    const { message, offset, length, kind, domain } = result.error;
    const error = Object.assign(new Error(message), { domain, kind });
    throw offset === undefined ? located(error, start, end - start) : located(error, start + 1 + offset, length);
  }
}

// How much text a located failure covers when the parser only knows where the failing segment starts.
function segmentLength(text, offset, kind) {
  const rest = text.slice(offset);
  if (kind === 'filter') return rest.length;
  if (rest[0] === '[') return rest.indexOf(']') < 0 ? rest.length : rest.indexOf(']') + 1;
  const dots = rest.match(/^\.*/)[0].length;
  const next = rest.slice(dots).search(/[.[]/);
  return next < 0 ? rest.length : dots + Math.max(next, 1);
}

// Parse-only check of a JSONPath string as the evaluator would read it (sourcePath, sourcePaths, subId, an
// expression), without data. `${variable}` / `%property%` outside filters are masked with same-length filler;
// a path that starts with one is checked from the end of that placeholder. Checks, in the evaluator's order:
// the `$` root, prototype-reaching property names, trailing path methods, every segment, then the condition in
// each `[?(...)]` filter (parse only, offsets relative to `text`).
// Returns { ok: true } or { ok: false, error: { domain: 'jsonpath', kind, message, offset?, length? } } with kind
// 'start' | 'unsafe' | 'filter' | 'function' | 'syntax'; errors found inside a filter condition keep that
// condition's domain and kind. Not judged: anything that depends on the data (a method such as min() on
// non-numbers, a filter applied to a non-container) -- and a method's own result.
export function validateJsonPath(text) {
  try {
    checkJsonPath(text);
    return { ok: true };
  } catch (error) {
    const failure = validationFailure(error, 'jsonpath', 'syntax');
    if (failure.offset !== undefined && failure.length === undefined) {
      failure.length = segmentLength(text, failure.offset, failure.kind);
    }
    return { ok: false, error: failure };
  }
}
