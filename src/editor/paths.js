// Payload shape index for JSONPath completion and hover. Pure and bounded: it samples array members, caps depth,
// key counts and total work, and is memoised per payload object.

const MAX_DEPTH = 8;
const MAX_SAMPLES = 20;
const MAX_KEYS = 200;
const MAX_VISITS = 20000;
const PREVIEW_LENGTH = 80;
export const ENVELOPE_KEYS = ['Resources', 'resources', 'users', 'groups', 'value', 'results', 'entities'];
const IDENTIFIER = /^[A-Za-z_$][\w$-]*$/;
const PATH_METHODS = ['length', 'size', 'first', 'last', 'min', 'max', 'sum', 'avg'];

export const typeOf = (value) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);

function newNode() {
  return {
    types: new Set(),
    seen: 0,
    samples: 0,
    children: new Map(),
    item: null,
    preview: undefined,
    truncated: false,
  };
}

function absorb(node, value, state, depth) {
  if (state.visits++ > MAX_VISITS) {
    node.truncated = true;
    return;
  }
  node.types.add(typeOf(value));
  node.seen++;
  if (value === null || typeof value !== 'object') {
    if (node.preview === undefined && value !== null) node.preview = value;
    return;
  }
  if (depth >= MAX_DEPTH) {
    node.truncated = true;
    return;
  }
  if (Array.isArray(value)) {
    node.item ??= newNode();
    for (let i = 0; i < Math.min(value.length, MAX_SAMPLES); i++) absorb(node.item, value[i], state, depth + 1);
    return;
  }
  node.samples++;
  let count = 0;
  for (const key of Object.keys(value)) {
    if (count++ >= MAX_KEYS) {
      node.truncated = true;
      break;
    }
    let child = node.children.get(key);
    if (!child) {
      child = newNode();
      node.children.set(key, child);
    }
    absorb(child, value[key], state, depth + 1);
  }
}

// The members a batch envelope holds (root array, Resources/users/..., d.results); null for a single entity.
export function entityMembers(payload) {
  if (Array.isArray(payload)) return { members: payload, base: '$[*]' };
  if (!payload || typeof payload !== 'object') return null;
  for (const key of ENVELOPE_KEYS)
    if (Array.isArray(payload[key])) return { members: payload[key], base: `$.${key}[*]` };
  if (Array.isArray(payload.d?.results)) return { members: payload.d.results, base: '$.d.results[*]' };
  return null;
}

const shapes = new WeakMap();

// { root, entity, base }: `entity` is the merged shape of the batch members (paths relative to one entity).
export function shapeOf(payload) {
  if (!payload || typeof payload !== 'object') return { root: newNode(), entity: null, base: null };
  let shape = shapes.get(payload);
  if (shape) return shape;
  const root = newNode();
  absorb(root, payload, { visits: 0 }, 0);
  const envelope = entityMembers(payload);
  let entity = null;
  if (envelope) {
    entity = newNode();
    const state = { visits: 0 };
    for (let i = 0; i < Math.min(envelope.members.length, MAX_SAMPLES); i++)
      absorb(entity, envelope.members[i], state, 0);
  }
  shape = { root, entity, base: envelope?.base ?? null };
  shapes.set(payload, shape);
  return shape;
}

export const isOptional = (parent, child) => child.seen < parent.samples;

export function describeNode(node) {
  const types = [...node.types].filter((type) => type !== 'null');
  const label = types.length ? types.join(' | ') : 'null';
  return node.types.has('null') && types.length ? `${label} | null` : label;
}

export function previewOf(value) {
  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text === undefined) return '';
  return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH - 1)}…` : text;
}

// ---- path parsing --------------------------------------------------------------------------------------------

// Parses `$.a[*].b['c d'][0]` into steps. Stops at the first thing it does not understand and reports where.
// Result: { steps, end } where `end` is the index just after the last parsed step. With `complete`, a trailing
// `.name` counts as a step; otherwise it is left as the partial word being typed.
export function parsePath(text, { complete = false } = {}) {
  const steps = [];
  let i = 1;
  while (i < text.length) {
    const rest = text.slice(i);
    let match = rest.match(/^\.([A-Za-z_$][\w$-]*)(?=[.[]|$)/);
    if (match && (complete || i + match[0].length < text.length)) {
      steps.push({ kind: 'key', name: match[1] });
      i += match[0].length;
      continue;
    }
    if (match) break;
    if ((match = rest.match(/^\[(\d+)\]/))) {
      steps.push({ kind: 'index', index: Number(match[1]) });
    } else if ((match = rest.match(/^\[\*\]/))) {
      steps.push({ kind: 'wild' });
    } else if ((match = rest.match(/^\[\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*\]/))) {
      steps.push({ kind: 'key', name: (match[1] ?? match[2]).replace(/\\(.)/g, '$1') });
    } else if ((match = rest.match(/^\[\?\(/))) {
      const close = findFilterEnd(text, i);
      if (close < 0) break;
      steps.push({ kind: 'wild', filter: true });
      i = close;
      continue;
    } else {
      break;
    }
    i += match[0].length;
  }
  return { steps, end: i };
}

// Index just after the `)]` closing the filter that starts at `start`, or -1 when unclosed.
function findFilterEnd(text, start) {
  let depth = 1;
  let quote = null;
  for (let j = start + 3; j < text.length; j++) {
    const c = text[j];
    if (quote) {
      if (c === '\\') j++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return text[j + 1] === ']' ? j + 2 : -1;
  }
  return -1;
}

function walk(node, steps) {
  let current = node;
  for (const step of steps) {
    if (!current) return null;
    current = step.kind === 'key' ? (current.children.get(step.name) ?? null) : current.item;
  }
  return current;
}

// ---- completion ----------------------------------------------------------------------------------------------

// `$`/`@` path tokens in condition or path text, split the way the evaluator splits them.
// A token still open at the end of `text` has `open: true`.
export function pathTokenRanges(text) {
  const tokens = [];
  let start = -1;
  let bracket = 0;
  let quote = null;
  let literal = null;
  const close = (to) => {
    tokens.push({ from: start, to, open: false });
    start = -1;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (start < 0) {
      if (literal) {
        if (c === '\\') i++;
        else if (c === literal) literal = null;
      } else if (c === '"' || c === "'") literal = c;
      else if (c === '$' || c === '@') {
        start = i;
        bracket = 0;
        quote = null;
      }
      continue;
    }
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '[') bracket++;
    else if (c === ']') bracket--;
    else if (bracket <= 0) {
      if (c === '(' && /\.(length|size|first|last|min|max|sum|avg)$/.test(text.slice(start, i)) && text[i + 1] === ')')
        i++;
      else if (/[\s()!,<>=&|]/.test(c)) close(i);
    }
  }
  if (start >= 0) tokens.push({ from: start, to: text.length, open: true });
  return tokens;
}

// Start of the path token the cursor (end of `typed`) is inside, or -1.
export function pathTokenStart(typed) {
  const last = pathTokenRanges(typed).at(-1);
  return last?.open ? last.from : -1;
}

function rootsOf(shape) {
  const roots = [];
  if (shape.entity) roots.push({ node: shape.entity, relative: true });
  roots.push({ node: shape.root, relative: false });
  return roots;
}

function nodesAt(text, roots) {
  const { steps, end } = parsePath(text, { complete: true });
  if (end < text.length) return [];
  return roots.map((root) => ({ node: walk(root.node, steps), relative: root.relative })).filter((hit) => hit.node);
}

// The shape node a complete path addresses (entity-relative first), or null.
export function resolveNode(shape, path) {
  return nodesAt(path, rootsOf(shape))[0]?.node ?? null;
}

// Finds the path under completion in `typed` (decoded text before the cursor) and the node(s) it addresses.
// `member` is the node `@` refers to outside filters (a function condition's current member), when known.
// Returns { from, kind: 'dot'|'bracket'|'end', partial, parents: [{ node, base, relative }] } or null.
export function locatePathCompletion(typed, shape, { member = null } = {}) {
  const start = pathTokenStart(typed);
  if (start < 0) return null;
  const text = typed.slice(start);
  const rootsFor = (marker) => (marker === '@' ? (member ? [{ node: member, relative: false }] : []) : rootsOf(shape));
  const filterAt = text.lastIndexOf('[?(');
  if (filterAt >= 0 && findFilterEnd(text, filterAt) < 0) {
    // Inside an unclosed filter: `@` is a member of the array selected before the filter.
    const inner = text.slice(filterAt + 3);
    const token = inner.match(/[@$][^\s()!,<>=&|]*$/);
    if (!token) return null;
    const roots =
      token[0][0] === '@'
        ? nodesAt(text.slice(0, filterAt), rootsFor(text[0]))
            .map((hit) => ({ node: hit.node.item, relative: hit.relative }))
            .filter((hit) => hit.node)
        : rootsOf(shape);
    return finish(token[0], start + filterAt + 3 + token.index, roots);
  }
  return finish(text, start, rootsFor(text[0]));
}

function finish(text, from, roots) {
  const { steps, end } = parsePath(text);
  const rest = text.slice(end);
  let kind;
  let partial;
  if (rest === '') {
    kind = 'end';
    partial = '';
  } else if (/^\.[\w$-]*$/.test(rest)) {
    kind = 'dot';
    partial = rest.slice(1);
  } else if (/^\[\s*(?:'[^']*|"[^"]*|\*|\d*)?$/.test(rest)) {
    kind = 'bracket';
    partial = rest.replace(/^\[\s*['"]?/, '');
  } else return null;
  const parents = [];
  for (const root of roots) {
    const node = walk(root.node, steps);
    if (node) parents.push({ node, base: text.slice(0, end), relative: root.relative });
  }
  return { from: from + end, kind, partial, parents };
}

export function accessorFor(key) {
  if (IDENTIFIER.test(key)) return `.${key}`;
  if (!key.includes("'")) return `['${key}']`;
  if (!key.includes('"')) return `["${key}"]`;
  return null;
}

// Options for the located completion: { label, insert, detail, path, optional, relative }.
export function pathOptions(found) {
  const seen = new Set();
  const options = [];
  const wanted = found.partial.toLowerCase();
  for (const parent of found.parents) {
    const { node } = parent;
    if (node.item && !node.children.size) {
      for (const accessor of ['[*]', '[0]']) {
        if (found.kind === 'dot' && found.partial) continue;
        if (found.kind === 'bracket' && !accessor.slice(1).startsWith(found.partial)) continue;
        const path = parent.base + accessor;
        if (seen.has(path)) continue;
        seen.add(path);
        options.push({
          label: accessor,
          insert: accessor,
          detail: accessor === '[*]' ? 'each array member' : 'first array member',
          path,
          optional: false,
          relative: parent.relative,
        });
      }
      continue;
    }
    for (const [key, child] of node.children) {
      if (!key.toLowerCase().startsWith(wanted)) continue;
      const accessor = found.kind === 'bracket' ? quotedAccessor(key) : accessorFor(key);
      if (!accessor) continue;
      const path = parent.base + accessor;
      if (seen.has(path)) continue;
      seen.add(path);
      options.push({
        label: key,
        insert: accessor,
        detail: describeNode(child) + (isOptional(node, child) ? ' · optional' : ''),
        path,
        optional: isOptional(node, child),
        relative: parent.relative,
      });
    }
  }
  if (found.kind === 'dot' && found.partial && found.parents.length) {
    for (const method of PATH_METHODS) {
      if (!method.startsWith(wanted)) continue;
      options.push({
        label: `${method}()`,
        insert: `.${method}()`,
        detail: 'path method',
        path: `${found.parents[0].base}.${method}()`,
        optional: false,
        relative: false,
        method: true,
      });
    }
  }
  return options;
}

function quotedAccessor(key) {
  if (!key.includes("'")) return `['${key}']`;
  if (!key.includes('"')) return `["${key}"]`;
  return null;
}

// ---- hover: resolve a simple path against the real payload -------------------------------------------------

function collect(roots, steps) {
  let current = roots;
  for (const step of steps) {
    const next = [];
    for (const value of current) {
      if (step.kind === 'key') {
        if (value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, step.name))
          next.push(value[step.name]);
      } else if (Array.isArray(value)) {
        if (step.kind === 'wild') next.push(...value);
        else if (step.index < value.length) next.push(value[step.index]);
      }
      if (next.length > 200) break;
    }
    current = next;
  }
  return current;
}

// Resolves `$...` against the payload (and the entities of a batch envelope). Returns null when the path uses
// syntax this resolver does not model (filters, recursive descent, slices, methods).
export function resolvePath(payload, path, { prefer = 'entity' } = {}) {
  const { steps, end } = parsePath(path, { complete: true });
  if (end < path.length || steps.some((step) => step.filter)) return null;
  const envelope = entityMembers(payload);
  const attempts = [];
  const members = envelope ? envelope.members.slice(0, MAX_SAMPLES) : null;
  const entityAttempt = () => {
    if (!members) return null;
    const found = members.map((member) => collect([member], steps)).filter((values) => values.length);
    return found.length ? { scope: 'entity', values: found[0], present: found.length, sampled: members.length } : null;
  };
  const payloadAttempt = () => {
    const values = collect([payload], steps);
    return values.length ? { scope: 'payload', values, present: 1, sampled: 1 } : null;
  };
  attempts.push(...(prefer === 'entity' ? [entityAttempt, payloadAttempt] : [payloadAttempt, entityAttempt]));
  for (const attempt of attempts) {
    const result = attempt();
    if (!result) continue;
    const first = result.values[0];
    return {
      resolved: true,
      scope: result.scope,
      type: typeOf(first),
      count: result.values.length,
      present: result.present,
      sampled: result.sampled,
      preview: previewOf(result.values.length > 1 ? result.values.slice(0, 3) : first),
    };
  }
  return { resolved: false, sampled: members?.length ?? 1 };
}
