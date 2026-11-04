// Static diagnostics for transformation documents, runtime context and expressions.
// Rules follow what the evaluator in src/engine accepts: "error" = the evaluator certainly fails when this part
// runs, "warning" = uncertain or likely unintended. Nothing here claims SAP validity.
import {
  commonFunctionKeys,
  contextOperations,
  entityTypes,
  functionParameters,
  mappingKeys,
  mappingTypeKeys,
  mappingTypes,
  parameterEnums,
  requiredParameters,
} from '../engine/catalog.js';
import { parseJson, propMap, stringOffset } from './json.js';
import {
  checkCondition,
  checkDatePattern,
  checkJsonPath,
  checkManipulateDate,
  checkRegex,
  checkTargetPath,
  isTemplated,
  maskPlaceholders,
  startsWithPlaceholder,
} from './syntax.js';
import { contextKeyDocs, get, sectionKeys } from './vocab.js';

const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const BOOLEAN_MAPPING_KEYS = ['optional', 'ignore', 'preserveArrayWithSingleElement', 'correlationAttribute'];
const STRING_MAPPING_KEYS = ['sourcePath', 'sourceVariable', 'targetPath', 'targetVariable'];
const PROPERTY_KEY_PARAMETERS = [
  'key',
  'sourceKey',
  'targetKey',
  'applyOnAttribute',
  'applyOnJsonAttribute',
  'assignToAttribute',
  'outputAttribute',
];
const PASSWORD_COUNTS = [
  'minimumNumberOfLowercaseLetters',
  'minimumNumberOfUppercaseLetters',
  'minimumNumberOfDigits',
  'minimumNumberOfSpecialSymbols',
];
const SOURCE_KEYS = ['sourcePath', 'sourceVariable', 'constant'];

const typeName = (node) => (node.type === 'invalid' ? 'invalid' : node.type);
const list = (values) => values.map((value) => `"${value}"`).join(', ');

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

export function closest(name, candidates) {
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const d = distance(name.toLowerCase(), candidate.toLowerCase());
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best !== null && bestDistance <= Math.max(2, Math.floor(name.length / 3)) ? best : null;
}

class Report {
  constructor() {
    this.items = [];
  }

  add(from, to, severity, code, message) {
    this.items.push({ from, to: Math.max(to, from + 1), severity, code, message });
  }

  node(node, severity, code, message) {
    this.add(node.from, node.to, severity, code, message);
  }

  // Marks a missing property on an object: points at the opening brace.
  brace(object, severity, code, message) {
    this.add(object.from, object.from + 1, severity, code, message);
  }

  // Issues from syntax.js are relative to the decoded string value; map them into the document.
  inString(node, issues) {
    for (const found of issues) {
      let from = stringOffset(node, found.from);
      let to = stringOffset(node, found.to);
      if (to <= from) {
        from = node.from;
        to = node.to;
      }
      this.add(from, to, found.severity, found.code, found.message);
    }
  }
}

function checkKeys(report, object, allowed, label) {
  const seen = new Map();
  for (const prop of object.props) {
    const name = prop.key.value;
    if (seen.has(name))
      report.node(
        seen.get(name).key,
        'warning',
        'duplicate-key',
        `Duplicate "${name}": only the last occurrence is used. Remove one of them.`,
      );
    seen.set(name, prop);
    if (allowed.includes(name) || !prop.key.closed) continue;
    const near = closest(name, allowed);
    const hint = near ? ` Did you mean "${near}"?` : ` Supported: ${list(allowed)}.`;
    report.node(prop.key, 'error', 'unknown-key', `Unsupported ${label} property "${name}".${hint}`);
  }
}

function expectBoolean(report, prop, label) {
  if (prop.value && prop.value.type !== 'boolean')
    report.node(prop.value, 'error', 'type-boolean', `${label} must be true or false (found ${typeName(prop.value)}).`);
}

function expectString(report, prop, label) {
  if (prop.value && prop.value.type !== 'string')
    report.node(prop.value, 'error', 'type-string', `${label} must be a string (found ${typeName(prop.value)}).`);
}

// Conditions: a blank string is rejected for mappings and sections only when `blankIsError`.
function checkConditionProp(report, prop, label, { blankIsError }) {
  const node = prop.value;
  if (!node) return;
  if (node.type !== 'string') {
    report.node(node, 'error', 'type-string', `${label} must be a string (found ${typeName(node)}).`);
    return;
  }
  if (!node.value.trim() && !blankIsError) return;
  report.inString(node, checkCondition(node.value));
}

// ---- transformation ------------------------------------------------------------------------------------------

export function analyzeTransformation(text) {
  const report = new Report();
  const { root } = parseJson(text);
  if (!root) return report.items;
  if (root.type !== 'object') {
    report.node(
      root,
      'error',
      'document-type',
      'A transformation must be a JSON object with a "user", "group" or "role" section.',
    );
    return report.items;
  }
  const props = propMap(root);
  const sectioned = entityTypes.some((key) => props.has(key));
  if (sectioned) {
    checkKeys(report, root, entityTypes, 'transformation');
    for (const type of entityTypes) {
      const prop = props.get(type);
      if (prop?.value) checkSection(report, prop.value, `${type} section`);
    }
  } else if (!props.has('mappings') && !root.incomplete) {
    report.brace(
      root,
      'error',
      'no-section',
      'Add a "user", "group" or "role" section containing "mappings"; the evaluator finds no section to run.',
    );
  } else {
    checkSection(report, root, 'transformation');
  }
  return report.items;
}

function checkSection(report, node, label) {
  if (node.type !== 'object') {
    report.node(node, 'error', 'type-object', `The ${label} must be an object with a "mappings" array.`);
    return;
  }
  const props = propMap(node);
  checkKeys(report, node, Object.keys(sectionKeys), label);
  const skip = props.get('skipOperations');
  if (skip)
    report.node(
      skip.key,
      'error',
      'skip-operations',
      'skipOperations needs the provisioning lifecycle and is rejected by this evaluator. Remove it.',
    );
  if (props.get('ignore')) expectBoolean(report, props.get('ignore'), 'ignore');
  if (props.get('condition'))
    checkConditionProp(report, props.get('condition'), `${label} condition`, { blankIsError: false });
  const mappings = props.get('mappings');
  if (!mappings) {
    if (!node.incomplete && props.get('ignore')?.value?.value !== true)
      report.brace(
        node,
        props.has('condition') ? 'warning' : 'error',
        'missing-mappings',
        `The ${label} has no "mappings" array; the evaluator fails when this section runs.`,
      );
    return;
  }
  if (!mappings.value) return;
  if (mappings.value.type !== 'array') {
    report.node(
      mappings.value,
      'error',
      'type-array',
      `"mappings" must be an array of mapping objects (found ${typeName(mappings.value)}).`,
    );
    return;
  }
  mappings.value.items.forEach((item, index) => checkMapping(report, item, `mapping ${index + 1}`));
}

function checkMapping(report, node, label) {
  if (node.type !== 'object') {
    if (node.type !== 'invalid')
      report.node(node, 'error', 'type-object', `A mapping must be an object (found ${typeName(node)}).`);
    return;
  }
  const props = propMap(node);
  const get = (key) => props.get(key);
  checkKeys(report, node, mappingKeys, 'mapping');
  for (const key of BOOLEAN_MAPPING_KEYS) if (get(key)) expectBoolean(report, get(key), key);
  for (const key of STRING_MAPPING_KEYS) if (get(key)) expectString(report, get(key), key);
  const targetVariable = get('targetVariable')?.value;
  if (targetVariable?.type === 'string' && FORBIDDEN.has(targetVariable.value))
    report.node(
      targetVariable,
      'error',
      'unsafe-name',
      `"${targetVariable.value}" is blocked as a variable name; choose another name.`,
    );
  const ignored = get('ignore')?.value?.value === true;

  const scope = get('scope')?.value;
  if (scope) checkScope(report, scope);
  if (get('condition') && !ignored) checkConditionProp(report, get('condition'), 'condition', { blankIsError: true });

  const typeNode = get('type')?.value;
  let type = 'set';
  if (typeNode && typeNode.type !== 'null') {
    if (typeNode.type !== 'string' || !mappingTypes.includes(typeNode.value)) {
      const near = typeNode.type === 'string' ? closest(typeNode.value, mappingTypes) : null;
      report.node(
        typeNode,
        'error',
        'mapping-type',
        `Unsupported mapping type${typeNode.type === 'string' ? ` "${typeNode.value}"` : ''}.${near ? ` Did you mean "${near}"?` : ''} Use ${list(mappingTypes)}.`,
      );
      return;
    }
    type = typeNode.value;
  }
  const functions = get('functions');
  if (functions?.value) {
    if (functions.value.type !== 'array') {
      report.node(
        functions.value,
        'error',
        'type-array',
        `"functions" must be an array of function objects (found ${typeName(functions.value)}).`,
      );
    } else if (type !== 'set' && functions.value.items.length) {
      report.node(
        functions.key,
        'error',
        'functions-on-type',
        `Functions are not supported on "${type}" mappings (no approximate result is returned). Remove "functions" or use type "set".`,
      );
    }
  }
  // The evaluator validates every mapping, ignored or not, before it decides to skip it.
  if (type !== 'set') {
    for (const prop of node.props) {
      if (prop.key.closed && mappingKeys.includes(prop.key.value) && !mappingTypeKeys[type].includes(prop.key.value))
        report.node(
          prop.key,
          'error',
          'type-key',
          `"${prop.key.value}" has no effect on a "${type}" mapping and is rejected. Remove it or change the type.`,
        );
    }
  }
  if (ignored) return;
  const anchor = typeNode ?? node;
  const reportMissing = (code, message) => {
    if (node.incomplete) return;
    if (anchor === node) report.brace(node, 'error', code, message);
    else report.node(anchor, 'error', code, message);
  };
  const targetPath = get('targetPath');

  if (type === 'remove' || type === 'rename') {
    if (!targetPath) reportMissing('missing-target', `type "${type}" requires a targetPath.`);
    else checkTarget(report, targetPath, type, label);
    if (type === 'rename') {
      const constant = get('constant');
      if (!constant)
        reportMissing('missing-constant', 'type "rename" requires "constant" holding the new key name as a string.');
      else if (constant.value && constant.value.type !== 'string')
        report.node(
          constant.value,
          'error',
          'rename-constant',
          `For type "rename", constant is the new key name and must be a string (found ${typeName(constant.value)}).`,
        );
      else if (constant.value && FORBIDDEN.has(constant.value.value))
        report.node(
          constant.value,
          'error',
          'unsafe-name',
          `"${constant.value.value}" is blocked as a property name; choose another name.`,
        );
    }
    return;
  }
  if (type === 'valueMapping') {
    checkValueMapping(report, node, props, reportMissing);
    if (targetPath) checkTarget(report, targetPath, 'set', label);
    return;
  }

  // type "set"
  for (const key of ['sourcePaths', 'valueMappings'])
    if (get(key))
      report.node(
        get(key).key,
        'error',
        'needs-value-mapping',
        `"${key}" is only valid with "type": "valueMapping". Remove it or set the type.`,
      );
  const present = SOURCE_KEYS.filter((key) => get(key));
  const firstFunction = functions?.value?.type === 'array' ? functions.value.items[0] : null;
  const generated =
    present.length === 0 && firstFunction?.type === 'object' && functionName(firstFunction)?.value === 'randomPassword';
  if (present.length > 1) {
    for (const key of present.slice(1))
      report.node(
        get(key).key,
        'error',
        'source-count',
        `A mapping takes exactly one of sourcePath, sourceVariable or constant; remove "${key}" or "${present[0]}".`,
      );
  } else if (present.length === 0 && !generated) {
    reportMissing(
      'source-count',
      'Add exactly one of "sourcePath", "sourceVariable" or "constant" (only a first randomPassword function may omit it).',
    );
  }
  const path = get('sourcePath')?.value;
  if (path?.type === 'string') checkSourcePath(report, path);
  if (targetPath) checkTarget(report, targetPath, 'set', label);
  const hasTarget = targetPath || get('targetVariable') || get('correlationAttribute')?.value?.value === true;
  if (!hasTarget)
    reportMissing('missing-target', 'Add "targetPath" or "targetVariable" so the result is written somewhere.');
  if (functions?.value?.type === 'array' && type === 'set')
    functions.value.items.forEach((item) => checkFunction(report, item));
}

function checkScope(report, scope) {
  const entries = scope.type === 'array' ? scope.items : [scope];
  for (const entry of entries) {
    if (entry.type === 'invalid') continue;
    if (entry.type !== 'string' || !contextOperations.includes(entry.value)) {
      const near = entry.type === 'string' ? closest(entry.value, contextOperations) : null;
      report.node(
        entry,
        'error',
        'scope-value',
        `Invalid scope${entry.type === 'string' ? ` "${entry.value}"` : ''}; the evaluator rejects it.${near ? ` Did you mean "${near}"?` : ''} Use ${list(contextOperations)}.`,
      );
    }
  }
}

function checkSourcePath(report, node) {
  if (!node.value && !node.closed) return;
  // The engine resolves a leading placeholder before it reads the path, so its start is unknown here.
  if (startsWithPlaceholder(node.value)) return;
  report.inString(node, checkJsonPath(maskPlaceholders(node.value)));
}

function checkTarget(report, prop, kind, label) {
  const node = prop.value;
  if (!node || node.type !== 'string') return;
  if (!node.value) {
    report.node(node, 'error', 'missing-target', `${label}: targetPath is empty; use a path such as $.name.`);
    return;
  }
  if (startsWithPlaceholder(node.value)) return;
  report.inString(node, checkTargetPath(maskPlaceholders(node.value), kind));
}

function checkValueMapping(report, node, props, reportMissing) {
  const sourcePaths = props.get('sourcePaths');
  const valueMappings = props.get('valueMappings');
  if (!sourcePaths)
    reportMissing('value-mapping', 'type "valueMapping" requires "sourcePaths" (an array of JSONPath strings).');
  if (!valueMappings)
    reportMissing(
      'value-mapping',
      'type "valueMapping" requires "valueMappings" (an array of { "key": [...], "mappedValue": ... }).',
    );
  if (!props.get('targetPath')) reportMissing('missing-target', 'type "valueMapping" requires a targetPath.');
  let arity = null;
  if (sourcePaths?.value) {
    if (sourcePaths.value.type !== 'array') {
      report.node(
        sourcePaths.value,
        'error',
        'type-array',
        `"sourcePaths" must be an array of strings (found ${typeName(sourcePaths.value)}).`,
      );
    } else {
      arity = sourcePaths.value.items.length;
      for (const item of sourcePaths.value.items) {
        if (item.type === 'string') checkSourcePath(report, item);
        else if (item.type !== 'invalid')
          report.node(item, 'error', 'type-string', `Each source path must be a string (found ${typeName(item)}).`);
      }
    }
  }
  if (!valueMappings?.value) return;
  if (valueMappings.value.type !== 'array') {
    report.node(
      valueMappings.value,
      'error',
      'type-array',
      `"valueMappings" must be an array of objects (found ${typeName(valueMappings.value)}).`,
    );
    return;
  }
  for (const entry of valueMappings.value.items) {
    if (entry.type !== 'object') {
      if (entry.type !== 'invalid')
        report.node(
          entry,
          'error',
          'type-object',
          'Each valueMappings entry must be an object with "key" and "mappedValue".',
        );
      continue;
    }
    checkKeys(report, entry, ['key', 'mappedValue'], 'valueMapping entry');
    const entryProps = propMap(entry);
    const key = entryProps.get('key');
    if (!key && !entry.incomplete)
      report.brace(entry, 'error', 'value-mapping-key', 'This entry has no "key" array; valueMapping rejects it.');
    else if (key?.value && key.value.type !== 'array')
      report.node(key.value, 'error', 'value-mapping-key', '"key" must be an array with one value per source path.');
    else if (key?.value && arity !== null && key.value.items.length !== arity)
      report.node(
        key.value,
        'error',
        'value-mapping-arity',
        `"key" has ${key.value.items.length} value${key.value.items.length === 1 ? '' : 's'} but sourcePaths has ${arity}; valueMapping rejects it.`,
      );
    if (!entryProps.get('mappedValue') && !entry.incomplete)
      report.brace(entry, 'error', 'value-mapping-value', 'This entry has no "mappedValue"; valueMapping rejects it.');
  }
}

// ---- functions -----------------------------------------------------------------------------------------------

function functionName(node) {
  const props = propMap(node);
  return props.get('function')?.value ?? props.get('type')?.value ?? null;
}

function isIntegerLiteral(node) {
  return node.type === 'number' && Number.isInteger(node.value);
}

function checkFunction(report, node) {
  if (node.type !== 'object') {
    if (node.type !== 'invalid')
      report.node(
        node,
        'error',
        'type-object',
        'Each function must be an object such as { "function": "toLowerCaseString" }.',
      );
    return;
  }
  const props = propMap(node);
  const nameProp = props.get('function') ?? props.get('type');
  const name = nameProp?.value;
  if (!name) {
    if (!node.incomplete)
      report.brace(
        node,
        'error',
        'function-name',
        'Add a "function" name, for example "function": "toLowerCaseString".',
      );
    return;
  }
  if (name.type !== 'string' || !Object.hasOwn(functionParameters, name.value)) {
    const near = name.type === 'string' ? closest(name.value, Object.keys(functionParameters)) : null;
    report.node(
      name,
      'error',
      'unknown-function',
      `Unsupported mapping function${name.type === 'string' ? ` "${name.value}"` : ''}.${near ? ` Did you mean "${near}"?` : ''} Hover a known function name or press Ctrl+Space for the list.`,
    );
    return;
  }
  const fn = name.value;
  const other = props.get('function') && props.get('type');
  if (
    other &&
    props.get('function').value &&
    props.get('type').value &&
    props.get('function').value.value !== props.get('type').value.value
  )
    report.node(
      props.get('type').key,
      'error',
      'function-conflict',
      '"function" and "type" name different functions; keep one of them.',
    );
  const allowed = [...commonFunctionKeys, ...functionParameters[fn]];
  for (const prop of node.props) {
    const key = prop.key.value;
    if (allowed.includes(key) || !prop.key.closed) continue;
    const owners = Object.keys(functionParameters).filter((name) => functionParameters[name].includes(key));
    const near = closest(key, allowed);
    const hint = near
      ? ` Did you mean "${near}"?`
      : owners.length
        ? ` "${key}" belongs to ${owners.slice(0, 3).join(', ')}; ${fn} accepts ${list(functionParameters[fn]) || 'no parameters'}.`
        : ` ${fn} accepts ${list(functionParameters[fn]) || 'no parameters'}.`;
    report.node(prop.key, 'error', 'unknown-key', `Unsupported function ${fn} property "${key}".${hint}`);
  }
  const applyOn = props.get('applyOnAttribute') ?? props.get('applyOnJsonAttribute');
  if (props.get('applyOnElements')) expectBoolean(report, props.get('applyOnElements'), 'applyOnElements');
  if (props.get('condition')) {
    const condition = props.get('condition');
    checkConditionProp(report, condition, 'function condition', { blankIsError: false });
  }
  for (const key of PROPERTY_KEY_PARAMETERS) {
    const prop = props.get(key);
    if (!prop?.value) continue;
    if (prop.value.type !== 'string')
      report.node(prop.value, 'error', 'type-string', `${key} must be a string (found ${typeName(prop.value)}).`);
    else if (FORBIDDEN.has(prop.value.value))
      report.node(
        prop.value,
        'error',
        'unsafe-name',
        `"${prop.value.value}" is blocked as a property name; choose another name.`,
      );
  }
  if (props.get('assignToAttribute') && !applyOn)
    report.node(
      props.get('assignToAttribute').key,
      'error',
      'function-attribute',
      'assignToAttribute requires "applyOnAttribute" naming the member to read.',
    );

  const missing = (get(requiredParameters, fn) ?? []).filter((key) => !props.has(key));
  if (missing.length && !node.incomplete)
    report.node(
      name,
      'error',
      'required-parameter',
      `${fn} requires ${missing.length === 1 ? 'parameter' : 'parameters'} ${list(missing)}. Add ${missing.length === 1 ? 'it' : 'them'} to this function object.`,
    );
  checkParameters(report, fn, props);
}

const SHIFT_KEYS = ['years', 'months', 'days', 'hours', 'minutes', 'seconds'];
const DATE_PATTERN_KEYS = ['sourceDateFormat', 'targetDateFormat'];

// Whole-function manipulateDate check through the engine: fields the target pattern needs but the source pattern
// does not provide, and shifts that need a date or an hour the source lacks. Options still unknown (templated or
// already reported as malformed) are left out; a pattern that is itself invalid was reported on its own.
function checkManipulateDateFunction(report, props) {
  const value = (key) => props.get(key)?.value;
  const options = {};
  for (const key of DATE_PATTERN_KEYS) {
    const node = value(key);
    if (node?.type !== 'string' || isTemplated(node.value)) continue;
    if (checkDatePattern(node.value, key === 'sourceDateFormat' ? 'source' : 'target').length) return;
    options[key] = node.value;
  }
  for (const key of SHIFT_KEYS) {
    const node = value(key);
    if (node?.type === 'number' && Number.isInteger(node.value)) options[key] = node.value;
    else if (node?.type === 'string' && /^[+-]?\d{1,15}$/.test(node.value)) options[key] = node.value;
  }
  const problem = checkManipulateDate(options);
  if (!problem) return;
  const target = value(problem.key) ?? value('function') ?? value('type');
  if (!target) return;
  if (problem.offset !== undefined && target.type === 'string') {
    const from = problem.offset;
    const to = from + (problem.length ?? 1);
    report.inString(target, [{ from, to, severity: 'error', code: 'date-format', message: problem.message }]);
  } else {
    report.node(target, 'error', 'date-format', problem.message);
  }
}

function checkParameters(report, fn, props) {
  const value = (key) => props.get(key)?.value;
  for (const [key, allowed] of Object.entries(get(parameterEnums, fn) ?? {})) {
    const node = value(key);
    if (!node) continue;
    if (node.type !== 'string' || !allowed.includes(node.value))
      report.node(
        node,
        'error',
        'enum-value',
        `${fn} ${key} must be one of ${list(allowed)}${node.type === 'string' ? ` (found "${node.value}")` : ''}.`,
      );
  }
  for (const key of ['regex']) {
    const node = value(key);
    if (node?.type === 'string' && !isTemplated(node.value)) report.inString(node, checkRegex(node.value));
  }
  for (const key of ['sourceDateFormat', 'targetDateFormat']) {
    const node = value(key);
    if (node?.type !== 'string' || isTemplated(node.value)) continue;
    report.inString(node, checkDatePattern(node.value, key === 'sourceDateFormat' ? 'source' : 'target'));
  }
  if (value('locale') && value('locale').type !== 'string')
    report.node(
      value('locale'),
      'error',
      'type-string',
      `locale must be a string such as "en_EN" (found ${typeName(value('locale'))}).`,
    );
  if (value('skipPadding') && value('skipPadding').type !== 'boolean')
    report.node(value('skipPadding'), 'warning', 'type-boolean', 'skipPadding is read as true/false; use a boolean.');

  if (fn === 'substring') {
    for (const key of ['beginIndex', 'endIndex']) {
      const node = value(key);
      if (
        node &&
        node.type !== 'invalid' &&
        !isIntegerLiteral(node) &&
        !(node.type === 'string' && isTemplated(node.value))
      )
        report.node(
          node,
          'error',
          'type-integer',
          `${key} must be an integer number (found ${node.type === 'number' ? node.value : typeName(node)}).`,
        );
    }
    const begin = value('beginIndex');
    const end = value('endIndex');
    if (
      begin &&
      end &&
      isIntegerLiteral(begin) &&
      isIntegerLiteral(end) &&
      (begin.value < 0 || end.value < begin.value)
    )
      report.node(
        end,
        'error',
        'substring-range',
        'substring needs 0 <= beginIndex <= endIndex; the evaluator fails otherwise.',
      );
    else if (begin && isIntegerLiteral(begin) && begin.value < 0)
      report.node(begin, 'error', 'substring-range', 'beginIndex must not be negative.');
  }
  for (const key of ['index', 'groupIndex']) {
    const node = props.get(key)?.value;
    if (fn === 'elementAt' || fn === 'getMatchedRegexGroup') {
      if (
        node &&
        node.type !== 'invalid' &&
        !isIntegerLiteral(node) &&
        !(node.type === 'string' && (isTemplated(node.value) || /^\d+$/.test(node.value)))
      )
        report.node(node, 'warning', 'type-integer', `${key} should be a non-negative integer.`);
    }
  }
  if (fn === 'manipulateDate') {
    for (const key of ['years', 'months', 'days', 'hours', 'minutes', 'seconds']) {
      const node = value(key);
      if (!node || node.type === 'invalid') continue;
      const numeric =
        node.type === 'number'
          ? node.value
          : node.type === 'string' && node.value.trim() !== ''
            ? Number(node.value)
            : NaN;
      if (!Number.isInteger(numeric) && !(node.type === 'string' && isTemplated(node.value)))
        report.node(
          node,
          'error',
          'type-integer',
          `${key} must be an integer (found ${node.type === 'number' ? node.value : typeName(node)}).`,
        );
    }
  }
  if (fn === 'manipulateDate') checkManipulateDateFunction(report, props);
  if (fn === 'compositeId') {
    const subId = value('subId');
    if (subId?.type === 'string' && subId.value.startsWith('$') && !startsWithPlaceholder(subId.value))
      report.inString(subId, checkJsonPath(maskPlaceholders(subId.value)));
  }
  if (fn === 'convertCountryCode' || fn === 'convertCountryRegion') {
    const attrs = value('inputAttributes');
    if (attrs) {
      if (attrs.type !== 'array')
        report.node(
          attrs,
          'error',
          'type-array',
          `inputAttributes must be an array of member names (found ${typeName(attrs)}).`,
        );
      else if (fn === 'convertCountryRegion') {
        const names = attrs.items.map((item) => item.value);
        if (!names.includes('country') || !names.includes('region'))
          report.node(
            attrs,
            'error',
            'input-attributes',
            'convertCountryRegion needs inputAttributes containing both "country" and "region".',
          );
      }
      if (fn === 'convertCountryCode' && !props.get('outputAttribute'))
        report.node(
          attrs,
          'error',
          'required-parameter',
          'convertCountryCode with inputAttributes also requires "outputAttribute".',
        );
    }
  }
  if (fn === 'randomPassword') checkPassword(report, props);
}

function checkPassword(report, props) {
  const length = props.get('passwordLength')?.value;
  const counts = PASSWORD_COUNTS.map((key) => props.get(key)?.value);
  for (const [key, node] of [['passwordLength', length], ...PASSWORD_COUNTS.map((key, i) => [key, counts[i]])]) {
    if (
      node &&
      node.type !== 'invalid' &&
      !isIntegerLiteral(node) &&
      !(node.type === 'string' && isTemplated(node.value))
    )
      report.node(
        node,
        'error',
        'type-integer',
        `${key} must be an integer number (found ${node.type === 'number' ? node.value : typeName(node)}).`,
      );
  }
  if (!length || !isIntegerLiteral(length) || counts.some((node) => !node || !isIntegerLiteral(node))) return;
  const total = counts.reduce((sum, node) => sum + node.value, 0);
  if (length.value < 1 || length.value > 4096)
    report.node(length, 'error', 'password-length', 'passwordLength must be between 1 and 4096.');
  else if (counts.some((node) => node.value < 0))
    report.node(
      counts.find((node) => node.value < 0),
      'error',
      'password-length',
      'Minimum character counts must not be negative.',
    );
  else if (total > length.value)
    report.node(
      length,
      'error',
      'password-length',
      `The four minimums add up to ${total}, more than passwordLength ${length.value}.`,
    );
  else if (total === 0)
    report.node(
      length,
      'error',
      'password-length',
      'At least one minimum count must be above 0; the evaluator has no character set to draw from otherwise.',
    );
  const symbols = props.get('specialSymbols')?.value;
  if (symbols?.type === 'string' && symbols.value === '' && counts[3].value > 0)
    report.node(
      symbols,
      'error',
      'password-length',
      'specialSymbols is empty but minimumNumberOfSpecialSymbols is above 0.',
    );
}

// ---- runtime context -----------------------------------------------------------------------------------------

export function analyzeContext(text) {
  const report = new Report();
  const { root } = parseJson(text);
  if (!root) return report.items;
  if (root.type !== 'object') {
    report.node(
      root,
      'error',
      'document-type',
      'The runtime context must be a JSON object, for example { "variables": {}, "properties": {} }.',
    );
    return report.items;
  }
  const known = Object.keys(contextKeyDocs);
  const seen = new Set();
  for (const prop of root.props) {
    const key = prop.key.value;
    if (seen.has(key))
      report.node(prop.key, 'warning', 'duplicate-key', `Duplicate "${key}": only the last occurrence is used.`);
    seen.add(key);
    if (!known.includes(key)) {
      const near = closest(key, known);
      report.node(
        prop.key,
        'warning',
        'unknown-key',
        `"${key}" is ignored by the evaluator.${near ? ` Did you mean "${near}"?` : ` Known keys: ${list(known)}.`}`,
      );
    }
  }
  const props = propMap(root);
  for (const key of ['variables', 'properties', 'resolutions']) {
    const node = props.get(key)?.value;
    if (node && node.type !== 'object' && node.type !== 'invalid')
      report.node(node, 'error', 'type-object', `context.${key} must be an object (found ${typeName(node)}).`);
  }
  const operation = props.get('operation')?.value;
  if (
    operation &&
    operation.type !== 'invalid' &&
    !(operation.type === 'string' && contextOperations.includes(operation.value))
  )
    report.node(operation, 'error', 'operation', `context.operation must be ${list(contextOperations)}.`);
  const resolutions = props.get('resolutions')?.value;
  if (resolutions?.type === 'object')
    for (const prop of resolutions.props)
      if (prop.value && prop.value.type !== 'object' && prop.value.type !== 'invalid')
        report.node(
          prop.value,
          'warning',
          'type-object',
          'A resolution table should be an object mapping source IDs to target IDs.',
        );
  const locales = props.get('localeMappings')?.value;
  if (locales && locales.type !== 'invalid') {
    if (locales.type !== 'array')
      report.node(
        locales,
        'warning',
        'type-array',
        'localeMappings should be an array of [ISO639, BCP47] pairs; convertLocaleCode fails otherwise.',
      );
    else
      for (const pair of locales.items)
        if (
          pair.type !== 'invalid' &&
          !(pair.type === 'array' && pair.items.length === 2 && pair.items.every((item) => item.type === 'string'))
        )
          report.node(
            pair,
            'warning',
            'locale-pair',
            'Each locale mapping should be a pair of strings: ["EN", "en-US"].',
          );
  }
  return report.items;
}

// ---- expressions ---------------------------------------------------------------------------------------------

// Expression text is either a JSONPath or an IPS condition; the editor cannot tell which one Run will use.
export function analyzeExpression(text) {
  if (!text.trim()) return [];
  const masked = maskPlaceholders(text);
  const lead = masked.length - masked.trimStart().length;
  const body = masked.trim();
  const isPath = singlePath(body);
  const issues = isPath ? checkJsonPath(body) : checkCondition(body);
  return issues.map((found) => ({
    ...found,
    from: found.from + lead,
    to: Math.min(found.to + lead, text.length),
    severity: isPath ? found.severity : 'warning',
  }));
}

// A lone path token (no operators outside brackets) is treated as a JSONPath expression.
function singlePath(body) {
  return /^\$/.test(body) && !/[\s]/.test(stripBrackets(body));
}

function stripBrackets(body) {
  let depth = 0;
  let quote = null;
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '[') depth++;
    else if (c === ']') depth = Math.max(0, depth - 1);
    else if (!depth) out += c;
  }
  return out;
}

export function analyze(kind, text) {
  if (kind === 'transformation') return analyzeTransformation(text);
  if (kind === 'context') return analyzeContext(text);
  if (kind === 'expression') return analyzeExpression(text);
  return [];
}
