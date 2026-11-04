import { contextOperations } from './catalog.js';
import { failWith, within } from './errors.js';
import { clone, missingVariableMessage, own } from './util.js';

const contextObjectKeys = ['variables', 'properties', 'resolutions'];

// Validates and copies the caller's context once. Everything is copied so a run can never
// mutate the caller's context.
export function environment(context = {}) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    failWith('INVALID_CONFIG', 'Context must be an object');
  }
  for (const key of contextObjectKeys) {
    const value = context[key];
    if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) {
      failWith('INVALID_CONFIG', `context.${key} must be an object`);
    }
  }
  if (context.operation !== undefined && !contextOperations.includes(context.operation)) {
    failWith('INVALID_CONFIG', 'context.operation must be createEntity, patchEntity or deleteEntity');
  }
  return within('INVALID_CONFIG', () => ({
    variables: clone(context.variables ?? {}),
    properties: clone(context.properties ?? {}),
    resolutions: clone(context.resolutions ?? {}),
    operation: context.operation,
    localeMappings: clone(context.localeMappings),
  }));
}

// Per-entity, per-stage environment. Only `variables` is written to during a run (targetVariable),
// so only that map is fresh; properties, resolutions and locale mappings are read-only and shared,
// which keeps a batch from re-copying the whole context for every entity and stage.
// `inherited` are variables the previous stage of the same entity hands on (see runEntity); they sit on top of the
// supplied context. `written` collects just the variables a mapping set, so a run can show them.
export function stageEnvironment(base, inherited = {}) {
  return { ...base, variables: { ...base.variables, ...inherited }, written: {} };
}

function variable(env, name) {
  return own(env.variables, name) ? env.variables[name] : failWith('MISSING_CONTEXT', missingVariableMessage(name));
}

function property(env, name) {
  return own(env.properties, name)
    ? env.properties[name]
    : failWith('MISSING_CONTEXT', `Missing context property: ${name}`);
}

// Replaces ${variable} and %property% references in every string of `value`.
// A string that is exactly one ${variable} keeps the variable's original type.
export function interpolate(value, env) {
  if (Array.isArray(value)) return value.map((item) => interpolate(item, env));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, interpolate(item, env)]));
  }
  if (typeof value !== 'string') return value;
  if (!value.includes('${') && !value.includes('%')) return value;

  const exact = value.match(/^\$\{([^}]+)\}$/);
  if (exact) return clone(variable(env, exact[1]));
  return value
    .replace(/\$\{([^}]+)\}/g, (_, name) => String(variable(env, name)))
    .replace(/%([^%\s]+)%/g, (_, name) => String(property(env, name)));
}
