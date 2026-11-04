import { interpolate } from './environment.js';
import { classify, failWith, within } from './errors.js';
import { applyFunction } from './functions/index.js';
import { readPath } from './jsonpath.js';
import { resolvePathText } from './path-text.js';
import { pathTokens, writeAt, writePath } from './target-path.js';
import { assertSafePath, checkKeys, clone, equal, forbidden, own } from './util.js';

// One handler per mapping `type`. Each receives the mapping, its interpolated target path
// and a ctx = { data, env, output, record, debug }; it sets `record.status` and returns
// the new output document. `record.read` / `record.written` hold copies of the values only in
// debug mode, because copying every value of a large batch is the dominant cost of a trace.

// Default value, else skip when optional, else fail. Returns { value } or null when skipped.
function fallbackValue(mapping, ctx, code, message) {
  if (own(mapping, 'defaultValue')) return { value: interpolate(mapping.defaultValue, ctx.env) };
  if (mapping.optional) {
    ctx.record.status = 'optional-missing';
    return null;
  }
  return failWith(code, message);
}

function recordWritten(ctx, value) {
  if (ctx.debug) ctx.record.written = clone(value);
  ctx.record.status = 'written';
}

export function removeMapping(mapping, path, ctx) {
  if (!path) failWith('INVALID_CONFIG', 'remove requires targetPath');
  const output = within('PATH_ERROR', () => writePath(ctx.output, path, undefined, true));
  ctx.record.status = 'removed';
  return output;
}

export function renameMapping(mapping, path, ctx) {
  const { env, record } = ctx;
  if (!path || typeof mapping.constant !== 'string') {
    failWith('INVALID_CONFIG', 'rename requires targetPath and string constant for the new key');
  }
  const { tokens, value } = within('PATH_ERROR', () => {
    assertSafePath(path, 'targetPath');
    const parts = pathTokens(path);
    if (!parts.length) failWith('INVALID_CONFIG', 'rename cannot rename the document root');
    return { tokens: parts, value: readPath(ctx.output, path, env) };
  });
  const newName = interpolate(mapping.constant, env);
  if (forbidden.has(newName)) failWith('PATH_ERROR', 'Unsafe renamed property');
  if (value === undefined) {
    if (mapping.optional) {
      record.status = 'optional-missing';
      return ctx.output;
    }
    failWith('MISSING_SOURCE', `Required rename target missing: ${path}`);
  }

  const output = within('PATH_ERROR', () => {
    const removed = writePath(ctx.output, path, undefined, true);
    tokens[tokens.length - 1] = newName;
    return writeAt(removed, tokens, value);
  });
  recordWritten(ctx, value);
  record.status = 'renamed';
  return output;
}

function checkValueMappingEntries(mapping) {
  for (const entry of mapping.valueMappings) {
    within('INVALID_CONFIG', () => checkKeys(entry, ['key', 'mappedValue'], 'valueMapping entry'));
    if (!Array.isArray(entry.key) || entry.key.length !== mapping.sourcePaths.length) {
      failWith('INVALID_CONFIG', 'valueMapping key must be an array with one value per sourcePath');
    }
    if (!own(entry, 'mappedValue')) failWith('INVALID_CONFIG', 'valueMapping entry requires mappedValue');
  }
}

export function valueMapping(mapping, path, ctx) {
  const { data, env, record } = ctx;
  if (!Array.isArray(mapping.sourcePaths) || !Array.isArray(mapping.valueMappings) || !path) {
    failWith('INVALID_CONFIG', 'valueMapping requires sourcePaths, valueMappings and targetPath');
  }
  checkValueMappingEntries(mapping);
  const values = within('PATH_ERROR', () =>
    mapping.sourcePaths.map((sourcePath) => readPath(data, resolvePathText(sourcePath, env), env)),
  );
  if (ctx.debug) record.read = clone(values);

  const matched = mapping.valueMappings.find((entry) => equal(entry.key, values));
  let value;
  if (matched) {
    value = interpolate(matched.mappedValue, env);
  } else {
    const fallback = fallbackValue(
      mapping,
      ctx,
      'MISSING_SOURCE',
      'valueMapping has no matching key and no defaultValue',
    );
    if (!fallback) return ctx.output;
    value = fallback.value;
  }

  const output = within('PATH_ERROR', () => writePath(ctx.output, path, value));
  recordWritten(ctx, value);
  return output;
}

function readSource(mapping, generated, data, env) {
  if (generated) return '';
  if (own(mapping, 'constant')) return interpolate(mapping.constant, env);
  if (mapping.sourceVariable !== undefined) {
    if (!own(env.variables, mapping.sourceVariable)) {
      failWith('MISSING_CONTEXT', `Missing context variable: ${mapping.sourceVariable}`);
    }
    return clone(env.variables[mapping.sourceVariable]);
  }
  return within('PATH_ERROR', () => readPath(data, resolvePathText(mapping.sourcePath, env), env));
}

// Runs the function chain. In debug mode every step records before/after/configuration; a
// failing step is always kept (name and error) so the trace can say which function failed.
function applyFunctions(functions, input, ctx) {
  let value = input;
  for (const config of functions) {
    const name = config?.function ?? config?.type;
    const step = { name };
    if (ctx.debug) {
      step.before = clone(value);
      step.configuration = clone(config);
      step.conditions = [];
      ctx.record.functions.push(step);
    }
    // Functions may report flags such as `fallbackUsed` through ctx.note; they belong to the step.
    const note = (key, noted) => {
      step[key] = noted;
    };
    try {
      value = applyFunction(value, config, ctx.data, ctx.env, ctx.debug ? step.conditions : undefined, note);
      if (ctx.debug) step.after = clone(value);
    } catch (error) {
      const failure = classify(error, 'FUNCTION_ERROR');
      failure.function = typeof name === 'string' ? name : null;
      step.error = failure.message;
      if (!ctx.debug) ctx.record.functions.push(step);
      throw failure;
    }
  }
  return value;
}

export function setMapping(mapping, path, ctx) {
  const { data, env, record } = ctx;
  if (mapping.sourcePaths || mapping.valueMappings) {
    failWith('INVALID_CONFIG', 'sourcePaths/valueMappings require type valueMapping');
  }

  const sources = ['sourcePath', 'sourceVariable', 'constant'].filter((key) => own(mapping, key));
  const firstFunction = mapping.functions?.[0];
  // randomPassword is the one function that may generate a value without any source.
  const generated = sources.length === 0 && (firstFunction?.function ?? firstFunction?.type) === 'randomPassword';
  if (sources.length !== 1 && !generated) {
    failWith(
      'INVALID_CONFIG',
      'Mapping requires exactly one of sourcePath, sourceVariable, constant (except randomPassword generation)',
    );
  }
  if (path === undefined && mapping.targetVariable === undefined && !mapping.correlationAttribute) {
    failWith('INVALID_CONFIG', 'Mapping requires targetPath or targetVariable');
  }

  const isConstant = own(mapping, 'constant');
  let value = readSource(mapping, generated, data, env);
  if (ctx.debug) record.read = clone(value);
  // A constant is a value the author wrote, never "missing", even when it is an empty array.
  if (!isConstant && (value === undefined || (Array.isArray(value) && !value.length))) {
    const fallback = fallbackValue(
      mapping,
      ctx,
      'MISSING_SOURCE',
      `Required source value missing: ${mapping.sourcePath ?? mapping.sourceVariable}`,
    );
    if (!fallback) return ctx.output;
    value = fallback.value;
  }
  if (!isConstant && Array.isArray(value) && value.length === 1 && !mapping.preserveArrayWithSingleElement) {
    value = value[0];
  }

  value = applyFunctions(mapping.functions ?? [], value, ctx);
  if (value === undefined) {
    const fallback = fallbackValue(mapping, ctx, 'FUNCTION_ERROR', 'Function produced no value');
    if (!fallback) return ctx.output;
    value = fallback.value;
  }

  if (mapping.targetVariable !== undefined) {
    env.variables[mapping.targetVariable] = clone(value);
    env.written[mapping.targetVariable] = clone(value);
  }
  const output = path === undefined ? ctx.output : within('PATH_ERROR', () => writePath(ctx.output, path, value));
  recordWritten(ctx, value);
  return output;
}
