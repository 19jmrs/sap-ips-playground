import { contextOperations, entityTypes, mappingKeys, mappingTypeKeys, mappingTypes } from './catalog.js';
import { evaluateCondition } from './conditions.js';
import { classify, failWith, within } from './errors.js';
import { removeMapping, renameMapping, setMapping, valueMapping } from './mapping-types.js';
import { resolvePathText } from './path-text.js';
import { checkKeys, own, propertyKey } from './util.js';

const sectionKeys = ['mappings', 'condition', 'ignore', 'skipOperations'];
const booleanKeys = ['optional', 'ignore', 'preserveArrayWithSingleElement', 'correlationAttribute'];
const stringKeys = ['sourcePath', 'sourceVariable', 'targetPath', 'targetVariable'];
const mappingHandlers = {
  set: setMapping,
  remove: removeMapping,
  rename: renameMapping,
  valueMapping,
};

// `set` accepts every key (its handler reports misplaced valueMapping keys); the other types list theirs in
// catalog.js (mappingTypeKeys), where the editor reads the same table.

// Accepts either { user, group, role } documents or a bare section with `mappings`.
function selectSection(document, entityType) {
  const hasEntitySections = document && entityTypes.some((key) => own(document, key));
  within('INVALID_CONFIG', () => checkKeys(document, hasEntitySections ? entityTypes : sectionKeys, 'transformation'));

  const section = document[entityType] ?? (document.mappings ? document : null);
  if (!section) failWith('INVALID_CONFIG', `Transformation has no ${entityType} section`);
  within('INVALID_CONFIG', () => checkKeys(section, sectionKeys, `${entityType} section`));
  if (section.ignore !== undefined && typeof section.ignore !== 'boolean') {
    failWith('INVALID_CONFIG', 'Entity ignore must be boolean');
  }
  if (section.skipOperations !== undefined) {
    failWith(
      'UNSUPPORTED',
      'skipOperations requires provisioning lifecycle and is outside local transformation execution',
    );
  }
  return section;
}

function validateScope(scope) {
  const scopes = Array.isArray(scope) ? scope : [scope];
  if (!scopes.length || !scopes.every((item) => contextOperations.includes(item))) {
    failWith('INVALID_CONFIG', `scope must be ${contextOperations.join(', ')} or an array of them`);
  }
}

// Returns the mapping's type after rejecting anything the evaluator would otherwise ignore.
function validateMapping(mapping) {
  within('INVALID_CONFIG', () => checkKeys(mapping, mappingKeys, 'mapping'));
  for (const key of booleanKeys) {
    if (own(mapping, key) && typeof mapping[key] !== 'boolean') failWith('INVALID_CONFIG', `${key} must be boolean`);
  }
  for (const key of stringKeys) {
    if (own(mapping, key) && typeof mapping[key] !== 'string') failWith('INVALID_CONFIG', `${key} must be a string`);
  }
  if (mapping.targetVariable !== undefined) {
    within('INVALID_CONFIG', () => propertyKey(mapping.targetVariable, 'targetVariable'));
  }
  if (mapping.functions !== undefined && !Array.isArray(mapping.functions)) {
    failWith('INVALID_CONFIG', 'functions must be an array');
  }
  if (mapping.scope !== undefined) validateScope(mapping.scope);

  const type = mapping.type ?? 'set';
  if (!mappingTypes.includes(type)) failWith('UNSUPPORTED', `Unsupported mapping type: ${type}`);
  if (type !== 'set') {
    if (mapping.functions?.length) {
      failWith('UNSUPPORTED', `Functions on ${type} mappings are not verified; no approximate result returned`);
    }
    const ignored = Object.keys(mapping).find((key) => !mappingTypeKeys[type].includes(key));
    if (ignored !== undefined) failWith('INVALID_CONFIG', `${ignored} has no effect on a ${type} mapping`);
  }
  return type;
}

// Returns the trace status for a mapping that must not run, or null when it should run.
function skipStatus(mapping, record, data, env) {
  if (mapping.ignore === true) return 'ignored';
  // Without an explicit scope, update and delete operations skip the mapping.
  if (['patchEntity', 'deleteEntity'].includes(env.operation) && mapping.scope === undefined) return 'scope-skipped';
  if (mapping.scope !== undefined) {
    if (!env.operation) failWith('MISSING_CONTEXT', 'Mapping scope requires context.operation');
    const scopes = Array.isArray(mapping.scope) ? mapping.scope : [mapping.scope];
    if (!scopes.includes(env.operation)) return 'scope-skipped';
  }
  if (mapping.condition !== undefined) {
    const result = within('CONDITION_ERROR', () => evaluateCondition(mapping.condition, data, env));
    record.condition = { expression: mapping.condition, result };
    if (!result) return 'condition-skipped';
  }
  return null;
}

// Applies one mapping to `ctx.output` and returns the new output document.
function applyMapping(mapping, record, ctx) {
  const type = validateMapping(mapping);
  const skipped = skipStatus(mapping, record, ctx.data, ctx.env);
  if (skipped) {
    record.status = skipped;
    return ctx.output;
  }

  const path =
    mapping.targetPath !== undefined
      ? within('PATH_ERROR', () => resolvePathText(mapping.targetPath, ctx.env))
      : undefined;
  return mappingHandlers[type](mapping, path, { ...ctx, record });
}

function runMapping(mapping, index, ctx) {
  const record = {
    stage: ctx.stage,
    mapping: index,
    index,
    status: 'pending',
    sourcePath: mapping?.sourcePath,
    targetPath: mapping?.targetPath,
    functions: [],
  };
  try {
    return applyMapping(mapping, record, ctx);
  } catch (error) {
    const failure = classify(error, 'INVALID_CONFIG');
    failure.stage = ctx.stage;
    failure.mappingIndex = index;
    record.status = 'error';
    record.error = failure.message;
    record.code = failure.code;
    throw failure;
  } finally {
    // Failures are always traced; successful mappings only in debug mode.
    if (ctx.debug || record.status === 'error') ctx.trace.push(record);
  }
}

// A deleteEntity operation ignores the entity-level condition.
function sectionConditionRejects(section, data, env) {
  if (env.operation === 'deleteEntity' || !section.condition) return false;
  return !within('CONDITION_ERROR', () => evaluateCondition(section.condition, data, env));
}

function runSection(data, document, entityType, env, trace, stage, debug) {
  const section = selectSection(document, entityType);
  if (section.ignore === true || sectionConditionRejects(section, data, env)) {
    trace.push({ stage, status: 'skipped', condition: section.condition });
    return { skipped: true };
  }
  if (!Array.isArray(section.mappings)) failWith('INVALID_CONFIG', 'Transformation mappings must be an array');

  let output = {};
  for (const [index, mapping] of section.mappings.entries()) {
    output = runMapping(mapping, index, { data, env, output, trace, stage, debug });
  }
  return { output };
}

// Runs one stage's transformation over one entity. Returns { skipped: true } or { output }.
// Failures are IpsErrors carrying the stage (and, for mapping failures, the mapping index).
export function transform(data, document, entityType, env, trace, stage, debug) {
  try {
    return runSection(data, document, entityType, env, trace, stage, debug);
  } catch (error) {
    const failure = classify(error, 'INVALID_CONFIG');
    failure.stage ??= stage;
    throw failure;
  }
}
