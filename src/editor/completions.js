// Context-aware completion. `completionsAt` is pure: it takes document text and a cursor offset and returns the
// replacement range plus options, already filtered by what has been typed.
import {
  commonFunctionKeys,
  contextOperations,
  entityTypes,
  functionParameters,
  mappingKeys,
  mappingTypes,
  parameterEnums,
  supportedFunctions,
} from '../engine/catalog.js';
import { classify, surroundings } from './context.js';
import { decodedIndex, locate, parseJson, propMap, stringContent, stringOffset } from './json.js';
import { locatePathCompletion, pathOptions, pathTokenStart, resolveNode, shapeOf } from './paths.js';
import {
  booleanMappingKeys,
  commonFunctionKeyDocs,
  conditionFunctions,
  contextKeyDocs,
  documentKeys,
  enumValueDocs,
  functionDocs,
  knownProperties,
  knownVariables,
  mappingKeyDocs,
  mappingTypeDocs,
  parameterDocs,
  parameterSignature,
  pathMethods,
  sectionKeys,
  symbolOperators,
  get,
  wordOperators,
} from './vocab.js';

const STRING_ENUM_KEYS = new Set([
  'type',
  'function',
  'scope',
  'outputFormat',
  'algorithm',
  'separator',
  'entityType',
  'operation',
]);
const BOOLEAN_KEYS = new Set([...booleanMappingKeys, 'applyOnElements', 'skipPadding', 'ignore']);
const PATH_KEYS = new Set(['sourcePath', 'targetPath', 'subId']);
const SOURCE_KEYS = ['sourcePath', 'sourceVariable', 'constant'];
const MAPPING_KEYS_BY_TYPE = {
  remove: ['targetPath', 'type', 'optional', 'ignore', 'condition', 'scope'],
  rename: ['targetPath', 'constant', 'type', 'optional', 'ignore', 'condition', 'scope'],
  valueMapping: [
    'sourcePaths',
    'valueMappings',
    'targetPath',
    'type',
    'optional',
    'ignore',
    'condition',
    'scope',
    'defaultValue',
  ],
};

const option = (label, insert, type, detail, info, boost = 0) => ({ label, insert, type, detail, info, boost });
const escapeJson = (text) => JSON.stringify(text).slice(1, -1);

// Keep options whose label starts with what has been typed (case-insensitive), highest boost first.
function narrow(options, partial) {
  const wanted = partial.toLowerCase();
  return options.filter((item) => item.label.toLowerCase().startsWith(wanted)).sort((a, b) => b.boost - a.boost);
}

function functionNames(names) {
  const given = names
    .map((fn) => (typeof fn === 'string' ? fn : (fn?.name ?? fn?.function)))
    .filter((name) => typeof name === 'string' && name);
  return given.length ? given : supportedFunctions;
}

function declaredVariables(root) {
  const names = new Set();
  const visit = (node, depth) => {
    if (!node || depth > 8) return;
    if (node.type === 'array') node.items.forEach((item) => visit(item, depth + 1));
    if (node.type !== 'object') return;
    for (const prop of node.props) {
      if (prop.key.value === 'targetVariable' && prop.value?.type === 'string' && prop.value.value)
        names.add(prop.value.value);
      else visit(prop.value, depth + 1);
    }
  };
  visit(root, 0);
  return [...names];
}

function variableOptions(ctx, { assign = false } = {}) {
  const options = Object.entries(knownVariables).map(([name, info]) =>
    option(name, name, 'variable', 'documented variable', info, 1),
  );
  if (!assign)
    for (const name of ctx.declared)
      if (!(name in knownVariables))
        options.push(option(name, name, 'variable', 'set by targetVariable', undefined, 2));
  return options;
}

function propertyOptions() {
  return Object.entries(knownProperties).map(([name, info]) => option(name, name, 'variable', 'system property', info));
}

// ---- condition / path text ---------------------------------------------------------------------------------

function insideLiteral(before) {
  let quote = null;
  let regex = false;
  for (let i = 0; i < before.length; i++) {
    const c = before[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (regex) {
      if (c === '\\') i++;
      else if (c === '/') regex = false;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '/') regex = true;
  }
  return Boolean(quote) || regex;
}

// Name of the function call and argument index the cursor is in, from the text before it.
function callAt(before) {
  const stack = [];
  let quote = null;
  for (let i = 0; i < before.length; i++) {
    const c = before[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') stack.push({ name: before.slice(0, i).match(/([A-Za-z_]\w*)\s*$/)?.[1] ?? null, arg: 0 });
    else if (c === ')') stack.pop();
    else if (c === ',' && stack.length) stack.at(-1).arg++;
  }
  return stack.at(-1) ?? null;
}

// `before`/`after`: decoded text on each side of the cursor. Returns { from, to, options } in indices of that text.
function completeText(before, after, ctx, { pathOnly = false, member = null, explicit = false } = {}) {
  if (pathTokenStart(before) >= 0) {
    const found = locatePathCompletion(before, ctx.shape, { member });
    if (found) {
      let consumed = 0;
      if (found.kind === 'bracket') while (consumed < 2 && /['"\]]/.test(after[consumed] ?? '')) consumed++;
      const options = pathOptions(found).map((item) =>
        option(
          item.label,
          item.insert,
          item.method ? 'function' : 'property',
          item.detail,
          item.method ? get(pathMethods, item.label) : item.path,
          item.relative === ctx.preferEntity ? 2 : 0,
        ),
      );
      return { from: found.from, to: before.length + consumed, options: narrow(options, '') };
    }
  } else if (pathOnly && before.trim() === '') {
    const found = locatePathCompletion('$', ctx.shape);
    if (!found) return null;
    const options = pathOptions(found).map((item) =>
      option(
        item.path,
        '$' + item.insert,
        'property',
        item.detail,
        undefined,
        item.relative === ctx.preferEntity ? 2 : 0,
      ),
    );
    return { from: before.length, to: before.length, options };
  }
  if (insideLiteral(before)) return null;
  const variable = before.match(/\$\{([^}]*)$/);
  if (variable) {
    const close = after[0] === '}' ? 1 : 0;
    const options = variableOptions(ctx).map((item) => ({ ...item, insert: item.insert + (close ? '' : '}') }));
    return {
      from: before.length - variable[1].length,
      to: before.length + close,
      options: narrow(options, variable[1]),
    };
  }
  const property = explicit ? before.match(/%([^%\s]*)$/) : null;
  if (property) {
    const close = after[0] === '%' ? 1 : 0;
    const options = propertyOptions().map((item) => ({ ...item, insert: item.insert + (close ? '' : '%') }));
    return {
      from: before.length - property[1].length,
      to: before.length + close,
      options: narrow(options, property[1]),
    };
  }
  return null;
}

function completeCondition(before, after, ctx, extra = {}) {
  const placeholder = completeText(before, after, ctx, extra);
  if (placeholder) return placeholder;
  if (insideLiteral(before)) return null;
  const partial = before.match(/[A-Za-z_][\w.-]*$/)?.[0] ?? '';
  if (!partial && !extra.explicit) return null;
  const call = callAt(before);
  const options = [];
  if (call && /^isAttribute/.test(call.name ?? '') && call.arg === 1) options.push(...propertyOptions());
  for (const [name, info] of Object.entries(wordOperators))
    options.push(option(name, name, 'keyword', 'operator', info));
  for (const [name, spec] of Object.entries(conditionFunctions))
    options.push(option(name, `${name}(`, 'function', 'condition function', `${spec.signature}. ${spec.doc}`, 1));
  for (const literal of ['true', 'false', 'null']) options.push(option(literal, literal, 'constant', 'literal'));
  if (!partial)
    for (const [name, info] of Object.entries(symbolOperators))
      options.push(option(name, name, 'keyword', 'operator', info));
  let consumed = 0;
  while (/[\w.-]/.test(after[consumed] ?? '')) consumed++;
  return { from: before.length - partial.length, to: before.length + consumed, options: narrow(options, partial) };
}

// ---- JSON structure ---------------------------------------------------------------------------------------------

function mappingKeyCandidates(container) {
  const props = propMap(container);
  const typeNode = props.get('type')?.value;
  const type = typeNode?.type === 'string' ? typeNode.value : 'set';
  let allowed =
    MAPPING_KEYS_BY_TYPE[type] ?? mappingKeys.filter((key) => key !== 'sourcePaths' && key !== 'valueMappings');
  if (!MAPPING_KEYS_BY_TYPE[type] && SOURCE_KEYS.some((key) => props.has(key)))
    allowed = allowed.filter((key) => !SOURCE_KEYS.includes(key));
  const boosted = new Set(['sourcePath', 'targetPath', 'functions']);
  return allowed.map((name) => ({ name, doc: mappingKeyDocs[name], boost: boosted.has(name) ? 1 : 0 }));
}

function functionKeyCandidates(container, name) {
  const props = propMap(container);
  const out = [];
  if (!props.has('function') && !props.has('type'))
    out.push({ name: 'function', doc: commonFunctionKeyDocs.function, boost: 3 });
  if (name && Object.hasOwn(functionParameters, name))
    for (const key of functionParameters[name])
      out.push({ name: key, doc: parameterDocs[key], boost: 2, parameter: true });
  for (const key of commonFunctionKeys) {
    if (key === 'function' || key === 'type') continue;
    out.push({ name: key, doc: commonFunctionKeyDocs[key], boost: 0 });
  }
  return out;
}

function keyCandidates(kind, role, container, surround) {
  if (kind === 'context') {
    if (role === 'contextRoot') return Object.entries(contextKeyDocs).map(([name, doc]) => ({ name, doc, boost: 0 }));
    if (role === 'variables') return Object.entries(knownVariables).map(([name, doc]) => ({ name, doc, boost: 0 }));
    if (role === 'properties') return Object.entries(knownProperties).map(([name, doc]) => ({ name, doc, boost: 0 }));
    if (role === 'resolutions')
      return entityTypes.map((name) => ({ name, doc: 'Resolution table for this entity type.', boost: 0 }));
    return [];
  }
  switch (role) {
    case 'root': {
      const props = propMap(container);
      const sectioned = entityTypes.some((key) => props.has(key));
      const sections = entityTypes.map((name) => ({ name, doc: documentKeys[name], boost: 2 }));
      const flat = ['mappings', 'condition', 'ignore'].map((name) => ({ name, doc: sectionKeys[name], boost: 0 }));
      return sectioned || props.has('mappings') ? (sectioned ? sections : flat) : [...sections, ...flat];
    }
    case 'section':
      return ['mappings', 'condition', 'ignore'].map((name) => ({
        name,
        doc: sectionKeys[name],
        boost: name === 'mappings' ? 1 : 0,
      }));
    case 'mapping':
      return mappingKeyCandidates(container);
    case 'function':
      return functionKeyCandidates(container, surround.functionName);
    case 'valueMappingEntry':
      return [
        { name: 'key', doc: 'Array with one value per sourcePaths entry.', boost: 1 },
        { name: 'mappedValue', doc: 'Value written when the tuple matches.', boost: 1 },
      ];
    default:
      return [];
  }
}

function keyCompletions(kind, root, at) {
  const path = at.path;
  const role = classify(kind, path);
  const surround = kind === 'transformation' ? surroundings(root, path) : { functionName: null };
  const present = new Set(at.container.props.filter((prop) => prop !== at.prop).map((prop) => prop.key.value));
  const candidates = keyCandidates(kind, role, at.container, surround).filter((item) => !present.has(item.name));
  if (!candidates.length) return null;
  const keyNode = at.node;
  const partial = keyNode ? keyNode.value.slice(0, decodedIndex(keyNode, at.cursor)) : '';
  const withColon = !keyNode || at.prop?.colon === null || keyNode.unquoted;
  const options = candidates.map((item) => {
    const signature = surround.functionName && item.parameter ? parameterSignature(surround.functionName) : undefined;
    const insert = withColon ? `${JSON.stringify(item.name)}: ` : escapeJson(item.name);
    return option(
      item.name,
      insert,
      'property',
      signature ?? (item.parameter ? 'parameter' : 'key'),
      item.doc,
      item.boost,
    );
  });
  let from = at.cursor;
  let to = at.cursor;
  if (keyNode) {
    if (withColon) ({ from, to } = { from: keyNode.from, to: keyNode.to });
    else ({ from, to } = stringContent(keyNode));
  }
  return { from, to, options: narrow(options, partial) };
}

function enumOptions(values, docs = enumValueDocs) {
  return values.map((value) => option(value, value, 'enum', 'value', docs[value]));
}

// What a string value may be completed with, from the key it belongs to.
function stringValueKind(kind, role, key, surround) {
  if (kind === 'context') return role === 'contextRoot' && key === 'operation' ? { enum: contextOperations } : null;
  if (role === 'mapping') {
    if (key === 'type') return { enum: mappingTypes, docs: mappingTypeDocs };
    if (key === 'scope') return { enum: contextOperations };
    if (key === 'condition') return { condition: true };
    if (key === 'sourcePath' || key === 'targetPath') return { path: true };
    if (key === 'sourceVariable') return { variables: 'read' };
    if (key === 'targetVariable') return { variables: 'assign' };
  }
  if (role === 'section' && key === 'condition') return { condition: true };
  if (role === 'function') {
    if (key === 'function' || key === 'type') return { functions: true };
    if (key === 'condition') return { condition: true, member: true };
    if (PATH_KEYS.has(key)) return { path: true };
    if (key === 'entityType') return { enum: entityTypes };
    const values = get(get(parameterEnums, surround.functionName) ?? {}, key);
    if (values) return { enum: values };
  }
  if (role === 'scope') return { enum: contextOperations };
  if (role === 'sourcePaths') return { path: true };
  return {};
}

function memberFor(root, at, surround, shape) {
  const mappingProps = surround.mapping?.type === 'object' ? propMap(surround.mapping) : null;
  const sourcePath = mappingProps?.get('sourcePath')?.value;
  if (sourcePath?.type !== 'string') return null;
  const node = resolveNode(shape, sourcePath.value);
  if (!node) return null;
  const fnProps = at.container.type === 'object' ? propMap(at.container) : null;
  return fnProps?.get('applyOnElements')?.value?.value === true && node.item ? node.item : node;
}

function stringCompletions(kind, root, at, ctx) {
  const node = at.node;
  const path = at.path;
  const role = classify(kind, path);
  const surround = kind === 'transformation' ? surroundings(root, path) : { functionName: null };
  const key = at.container.type === 'object' ? at.prop?.key.value : null;
  const spec = stringValueKind(kind, role, key, surround);
  if (!spec) return null;
  const index = decodedIndex(node, at.cursor);
  const before = node.value.slice(0, index);
  const after = node.value.slice(index);
  let found = null;
  if (spec.enum) found = { from: 0, to: node.value.length, options: narrow(enumOptions(spec.enum, spec.docs), before) };
  else if (spec.functions) found = { from: 0, to: node.value.length, options: narrow(functionOptions(ctx), before) };
  else if (spec.variables)
    found = {
      from: 0,
      to: node.value.length,
      options: narrow(variableOptions(ctx, { assign: spec.variables === 'assign' }), before),
    };
  else if (spec.condition)
    found = completeCondition(before, after, ctx, {
      member: spec.member ? memberFor(root, at, surround, ctx.shape) : null,
      explicit: ctx.explicit,
    });
  else if (spec.path) found = completeText(before, after, ctx, { pathOnly: true });
  else found = completeText(before, after, ctx, { explicit: ctx.explicit });
  if (!found || !found.options.length) return null;
  const mapOffset = (i) => stringOffset(node, i);
  return {
    from: mapOffset(found.from),
    to: mapOffset(found.to),
    options: found.options.map((item) => ({ ...item, insert: escapeJson(item.insert) })),
  };
}

function functionOptions(ctx) {
  return ctx.functions.map((name) =>
    option(
      name,
      name,
      'function',
      'mapping function',
      `${parameterSignature(name)}. ${functionDocs[name] ?? ''}`.trim(),
      1,
    ),
  );
}

// A value that is not (yet) a string: booleans and quoted enum values.
function bareValueCompletions(kind, root, at, ctx) {
  const key = at.container.type === 'object' ? at.prop?.key.value : null;
  if (!key) return null;
  const role = classify(kind, at.path);
  const surround = kind === 'transformation' ? surroundings(root, at.path) : { functionName: null };
  const node = at.node;
  const from = node ? node.from : at.cursor;
  const to = node ? node.to : at.cursor;
  const partial = node ? ctx.text.slice(node.from, Math.min(at.cursor, node.to)) : '';
  if (BOOLEAN_KEYS.has(key) && (role === 'mapping' || role === 'function' || role === 'section')) {
    const options = ['true', 'false'].map((value) => option(value, value, 'constant', 'boolean'));
    return { from, to, options: narrow(options, partial) };
  }
  if (!STRING_ENUM_KEYS.has(key)) return null;
  const spec = stringValueKind(kind, role, key, surround);
  let options = null;
  if (spec?.enum) options = enumOptions(spec.enum, spec.docs);
  else if (spec?.functions) options = functionOptions(ctx);
  if (!options) return null;
  return {
    from,
    to,
    options: narrow(options, partial).map((item) => ({ ...item, insert: JSON.stringify(item.insert) })),
  };
}

function itemCompletions(kind, root, at, ctx) {
  const role = classify(kind, at.path);
  if (at.node && at.node.type !== 'string') return null;
  if (at.node?.type === 'string') return stringCompletions(kind, root, at, ctx);
  if (kind !== 'transformation') return null;
  const gap = { from: at.cursor, to: at.cursor };
  if (role === 'functions') {
    const options = ctx.functions.map((name) =>
      option(
        name,
        `{ "function": ${JSON.stringify(name)} }`,
        'function',
        'mapping function',
        `${parameterSignature(name)}. ${functionDocs[name] ?? ''}`.trim(),
        1,
      ),
    );
    return { ...gap, options };
  }
  if (role === 'scope')
    return {
      ...gap,
      options: enumOptions(contextOperations).map((item) => ({ ...item, insert: JSON.stringify(item.insert) })),
    };
  if (role === 'mappings')
    return {
      ...gap,
      options: [
        option(
          'mapping',
          '{ "sourcePath": "$.", "targetPath": "$." }',
          'property',
          'mapping template',
          'A set mapping that copies one value.',
        ),
      ],
    };
  return null;
}

// ---- entry point ------------------------------------------------------------------------------------------------

/**
 * @param {'transformation'|'context'|'expression'|'data'} kind
 * @param {string} text document text
 * @param {number} pos cursor offset
 * @param {{ payload?: unknown, functions?: Array<string|object>, explicit?: boolean }} config
 * @returns {null | { from: number, to: number, options: Array<{label: string, insert: string, type: string, detail?: string, info?: string, boost: number}> }}
 */
export function completionsAt(kind, text, pos, { payload, functions = [], explicit = false } = {}) {
  if (kind !== 'transformation' && kind !== 'context' && kind !== 'expression') return null;
  const ctx = {
    shape: shapeOf(payload),
    functions: functionNames(functions),
    preferEntity: kind === 'transformation',
    declared: [],
    explicit,
    text,
  };
  if (kind === 'expression') {
    const found = completeCondition(text.slice(0, pos), text.slice(pos), ctx, { explicit });
    return found?.options.length ? found : null;
  }
  const { root } = parseJson(text);
  if (!root) return null;
  const at = locate(root, pos);
  if (!at.container) return null;
  at.cursor = pos;
  ctx.declared = kind === 'transformation' ? declaredVariables(root) : [];
  let found = null;
  if (at.where === 'key' && at.container.type === 'object') found = keyCompletions(kind, root, at);
  else if (at.where === 'value' && at.container.type === 'object') {
    found =
      at.node?.type === 'string' ? stringCompletions(kind, root, at, ctx) : bareValueCompletions(kind, root, at, ctx);
  } else if (at.where === 'item') found = itemCompletions(kind, root, at, ctx);
  return found?.options.length ? found : null;
}
