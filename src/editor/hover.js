// Hover documentation. Pure: text + offset in, { from, to, text } out. Texts are factual and link-free.
import { contextOperations, entityTypes, functionParameters, parameterEnums } from '../engine/catalog.js';
import { classify, surroundings } from './context.js';
import { decodedIndex, locate, parseJson, stringOffset } from './json.js';
import { pathTokenRanges, resolvePath } from './paths.js';
import {
  commonFunctionKeyDocs,
  conditionFunctions,
  contextKeyDocs,
  documentKeys,
  describeParameter,
  enumValueDocs,
  functionDocs,
  get,
  knownProperties,
  knownVariables,
  mappingKeyDocs,
  mappingKeyTypes,
  parameterSignature,
  sectionKeys,
  symbolOperators,
  wordOperators,
} from './vocab.js';

const SOURCE_PATH_KEYS = new Set(['sourcePath', 'subId']);

function describePath(path, payload, prefer) {
  const found = resolvePath(payload, path, { prefer });
  if (!found) return null;
  if (!found.resolved) {
    return `${path}\nNo value at this path in the current payload (${found.sampled} sampled).`;
  }
  const where =
    found.scope === 'entity'
      ? `entity-relative: present in ${found.present} of ${found.sampled} sampled entit${found.sampled === 1 ? 'y' : 'ies'}`
      : 'from the payload root';
  const shape = found.count > 1 ? `${found.count} values, first is ${found.type}` : found.type;
  return `${path}\n${shape} · ${where}\nPreview: ${found.preview}`;
}

const titled = (title, doc) => (doc ? `${title}\n${doc}` : null);

function keyHelp(kind, role, key, surround) {
  if (kind === 'context') {
    if (role === 'contextRoot') return titled(key, get(contextKeyDocs, key));
    if (role === 'variables')
      return titled(key, get(knownVariables, key) && `Documented variable: ${knownVariables[key]}`);
    if (role === 'properties')
      return titled(key, get(knownProperties, key) && `System property: ${knownProperties[key]}`);
    return null;
  }
  switch (role) {
    case 'root':
      return titled(key, get(documentKeys, key) ?? get(sectionKeys, key));
    case 'section':
      return titled(key, get(sectionKeys, key));
    case 'mapping':
      return titled(`${key} (${get(mappingKeyTypes, key)})`, get(mappingKeyDocs, key));
    case 'valueMappingEntry':
      return key === 'key'
        ? 'key (array)\nOne value per sourcePath entry, compared as JSON.'
        : key === 'mappedValue'
          ? 'mappedValue (any JSON value)\nWritten to targetPath when the tuple matches.'
          : null;
    case 'function': {
      const fn = surround.functionName;
      if ((get(functionParameters, fn) ?? []).includes(key)) return parameterHelp(fn, key);
      return titled(key, get(commonFunctionKeyDocs, key));
    }
    default:
      return null;
  }
}

function parameterHelp(fn, key) {
  const info = describeParameter(fn, key);
  const lines = [`${key} (${info.type}, ${info.required ? 'required' : 'optional'}) · ${fn}`];
  if (info.doc) lines.push(info.doc);
  if (info.values) lines.push(`Allowed: ${info.values.join(', ')}`);
  return lines.join('\n');
}

function enumHelp(value, allowed) {
  const doc = get(enumValueDocs, value);
  if (!doc && !allowed) return null;
  return `${value}${allowed ? ` · one of ${allowed.join(', ')}` : ''}${doc ? `\n${doc}` : ''}`;
}

function stringValueHelp(kind, role, key, value, surround) {
  if (kind === 'context')
    return role === 'contextRoot' && key === 'operation' ? enumHelp(value, contextOperations) : null;
  if (role === 'function') {
    if ((key === 'function' || key === 'type') && get(functionDocs, value))
      return `${parameterSignature(value)}\n${functionDocs[value]}`;
    const allowed = get(get(parameterEnums, surround.functionName) ?? {}, key);
    if (allowed) return enumHelp(value, allowed);
    if (key === 'entityType') return enumHelp(value, entityTypes);
  }
  if (role === 'mapping' && key === 'type') return enumHelp(value, null);
  if ((role === 'mapping' && key === 'scope') || role === 'scope') return enumHelp(value, contextOperations);
  if (role === 'mapping' && (key === 'targetVariable' || key === 'sourceVariable'))
    return titled(value, get(knownVariables, value));
  return null;
}

// Help for the word, operator or path under `idx` in a condition/JSONPath text.
function conditionHelp(value, idx, payload, prefer) {
  for (const range of pathTokenRanges(value)) {
    if (idx < range.from || idx > range.to) continue;
    const path = '$' + value.slice(range.from + 1, range.to);
    const text = value[range.from] === '$' ? describePath(path, payload, prefer) : null;
    return text ? { from: range.from, to: range.to, text } : null;
  }
  const word = [...value.matchAll(/[A-Za-z_][\w]*/g)].find((m) => idx >= m.index && idx <= m.index + m[0].length);
  if (word) {
    const name = word[0];
    const lower = name.toLowerCase();
    const info = get(conditionFunctions, name);
    if (info) return { from: word.index, to: word.index + name.length, text: `${info.signature}\n${info.doc}` };
    if (get(wordOperators, lower))
      return { from: word.index, to: word.index + name.length, text: `${lower}\n${wordOperators[lower]}` };
    return null;
  }
  for (const operator of Object.keys(symbolOperators).sort((a, b) => b.length - a.length)) {
    let at = value.indexOf(operator);
    while (at >= 0) {
      if (idx >= at && idx <= at + operator.length)
        return { from: at, to: at + operator.length, text: `${operator}\n${symbolOperators[operator]}` };
      at = value.indexOf(operator, at + 1);
    }
  }
  return null;
}

/**
 * @param {'transformation'|'context'|'expression'|'data'} kind
 * @returns {null | { from: number, to: number, text: string }}
 */
export function hoverAt(kind, text, pos, { payload } = {}) {
  if (kind === 'expression') return conditionHelp(text, pos, payload, 'payload');
  if (kind !== 'transformation' && kind !== 'context') return null;
  const { root } = parseJson(text);
  if (!root) return null;
  const at = locate(root, pos);
  if (!at.container || !at.node) return null;
  const role = classify(kind, at.path);
  const surround = kind === 'transformation' ? surroundings(root, at.path) : { functionName: null };
  const node = at.node;
  if (at.where === 'key' && at.container.type === 'object') {
    const help = keyHelp(kind, role, node.value, surround);
    return help ? { from: node.from, to: node.to, text: help } : null;
  }
  if (node.type !== 'string' || (at.where !== 'value' && at.where !== 'item')) return null;
  const key = at.container.type === 'object' ? at.prop.key.value : null;
  const direct = stringValueHelp(kind, role, key, node.value, surround);
  if (direct) return { from: node.from, to: node.to, text: direct };
  if (kind !== 'transformation') return null;
  const isPath = SOURCE_PATH_KEYS.has(key) || role === 'sourcePaths';
  if (isPath || key === 'condition') {
    const idx = decodedIndex(node, pos);
    const hit = conditionHelp(node.value, idx, payload, 'entity');
    if (hit) return { from: stringOffset(node, hit.from), to: stringOffset(node, hit.to), text: hit.text };
  }
  return null;
}
