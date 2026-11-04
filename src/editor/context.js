// Document-kind detection and structural classification shared by completion and hover.
import { entityTypes } from '../engine/catalog.js';
import { propMap } from './json.js';

// JsonEditor receives no explicit document kind, so the Runtime context editor is recognised by its title.
export function documentKind({ title = '', transformation = false, expressionMode = false } = {}) {
  if (expressionMode) return 'expression';
  if (transformation) return 'transformation';
  if (/runtime context/i.test(title)) return 'context';
  return 'data';
}

export function nodeAtPath(root, path) {
  let node = root;
  for (const step of path) {
    if (!node) return null;
    if (node.type === 'object') node = propMap(node).get(step)?.value ?? null;
    else if (node.type === 'array') node = node.items[step] ?? null;
    else return null;
  }
  return node;
}

// Names the structural role of the object/array found at `path`.
// Transformation roles: root, section, mappings, mapping, functions, function, valueMappings, valueMappingEntry,
// sourcePaths, scope, other. Context roles: contextRoot, variables, properties, resolutions, other.
export function classify(kind, path) {
  if (kind === 'context') {
    if (!path.length) return 'contextRoot';
    if (path.length === 1 && ['variables', 'properties', 'resolutions'].includes(path[0])) return path[0];
    return 'other';
  }
  if (!path.length) return 'root';
  const sectioned = entityTypes.includes(path[0]);
  const rel = sectioned ? path.slice(1) : path;
  if (!rel.length) return 'section';
  if (rel[0] !== 'mappings') return 'other';
  if (rel.length === 1) return 'mappings';
  if (rel.length === 2) return 'mapping';
  const lists = { functions: ['functions', 'function'], valueMappings: ['valueMappings', 'valueMappingEntry'] };
  const list = Object.hasOwn(lists, rel[2]) ? lists[rel[2]] : null;
  if (list && rel.length === 3) return list[0];
  if (list && rel.length === 4) return list[1];
  if ((rel[2] === 'sourcePaths' || rel[2] === 'scope') && rel.length === 3) return rel[2];
  return 'other';
}

// The mapping object and (when classified as a function) the function name that surround `path`.
export function surroundings(root, path) {
  const role = classify('transformation', path);
  const mapping =
    role === 'function' ? nodeAtPath(root, path.slice(0, -2)) : role === 'mapping' ? nodeAtPath(root, path) : null;
  let name = null;
  const node = role === 'function' ? nodeAtPath(root, path) : null;
  if (node?.type === 'object') {
    const props = propMap(node);
    const named = (props.get('function') ?? props.get('type'))?.value;
    name = named?.type === 'string' ? named.value : null;
  }
  return { role, mapping, functionName: name };
}
