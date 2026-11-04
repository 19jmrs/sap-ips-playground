// Pipeline entry points.
//
// runPipeline() returns { entities, summary }. Every entity is
//   { index, input, trace, output?, sourceOutput?, targetOutput?, skipped?, error?, errorDetail? }
// and never throws for a per-entity problem: the failure is recorded on the entity instead.
//
//   error        string shown to users, e.g. "source mapping 2: Required source value missing: $.a".
//   errorDetail  the same failure as data (additive; present exactly when `error` is):
//                  stage         'source' | 'target' | null (null: failure before any stage ran)
//                  mappingIndex  0-based index into the section's mappings, null outside a mapping
//                  function      name of the mapping function that failed, else null
//                  code          MISSING_SOURCE   required value, rename target or valueMapping match absent
//                                UNSUPPORTED      syntax or option the evaluator rejects on purpose
//                                INVALID_CONFIG   malformed transformation or mapping
//                                FUNCTION_ERROR   a mapping function failed
//                                MISSING_CONTEXT  context variable/property/operation not supplied
//                                CONDITION_ERROR  a condition could not be evaluated
//                                PATH_ERROR       a source or target path could not be read or written
//                                ENTITY_INVALID   the entity is not a JSON object
//                                LIMIT            input or transformation too deep for the evaluator
//                  message       `error` without the "<stage> mapping <n>: " prefix
//
// Only an invalid mode, entity type, entity path or context makes runPipeline itself throw.
import { entityTypes, executionModes } from './catalog.js';
import { evaluateCondition } from './conditions.js';
import { environment, stageEnvironment } from './environment.js';
import { IpsError, classify, failWith, within } from './errors.js';
import { readPath } from './jsonpath.js';
import { resolvePathText } from './path-text.js';
import { transform } from './transform.js';
import { clone } from './util.js';

// Runs every selected stage for one entity. Errors are captured on the returned entity so a
// failing entity never aborts the batch.
function runEntity(input, index, { source, target, mode, entityType, baseEnv, debug }) {
  const entity = { index, trace: [] };
  try {
    entity.input = clone(input);
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      failWith('ENTITY_INVALID', 'Entity must be a JSON object');
    }
    let current = clone(input);
    for (const stage of mode === 'chain' ? ['source', 'target'] : [mode]) {
      const document = stage === 'source' ? source : target;
      if (!document) throw new IpsError('INVALID_CONFIG', `Missing ${stage} transformation`, { stage });
      // Fresh variables per stage: they never leak between stages or entities.
      const result = transform(current, document, entityType, stageEnvironment(baseEnv), entity.trace, stage, debug);
      if (result.skipped) {
        entity.skipped = true;
        return entity;
      }
      current = result.output;
      entity[stage + 'Output'] = clone(current);
    }
    entity.output = current;
  } catch (error) {
    const failure = classify(error, 'INVALID_CONFIG');
    entity.error = failure.text;
    entity.errorDetail = failure.detail;
  }
  return entity;
}

export function runPipeline({
  data,
  source,
  target,
  mode = 'chain',
  entityPath = '$',
  entityType = 'user',
  context = {},
  debug = false,
}) {
  if (!executionModes.includes(mode)) failWith('INVALID_CONFIG', 'Invalid execution mode');
  if (!entityTypes.includes(entityType)) failWith('INVALID_CONFIG', 'Invalid entity type');

  const baseEnv = environment(context);
  const selected = within('PATH_ERROR', () => readPath(data, entityPath, baseEnv));
  if (selected === undefined) failWith('PATH_ERROR', `Entity path matched nothing: ${entityPath}`);
  const inputs = Array.isArray(selected) ? selected : [selected];

  const options = { source, target, mode, entityType, baseEnv, debug };
  const entities = inputs.map((input, index) => runEntity(input, index, options));
  const summary = { total: entities.length, succeeded: 0, failed: 0, skipped: 0 };
  for (const entity of entities) {
    if (entity.error) summary.failed++;
    else if (entity.skipped) summary.skipped++;
    else summary.succeeded++;
  }
  return { entities, summary };
}

export function evaluateExpression({ data, expression, kind = 'jsonpath', context = {} }) {
  const env = environment(context);
  if (kind === 'condition') return within('CONDITION_ERROR', () => evaluateCondition(expression, data, env));
  if (kind !== 'jsonpath') failWith('INVALID_CONFIG', 'Invalid expression kind');
  return within('PATH_ERROR', () => readPath(data, resolvePathText(expression, env), env));
}
