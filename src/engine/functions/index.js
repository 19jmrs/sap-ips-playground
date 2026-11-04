import { commonFunctionKeys, functionParameters } from '../catalog.js';
import { evaluateCondition } from '../conditions.js';
import { interpolate } from '../environment.js';
import { checkKeys, clone, fail, forbidden, own, propertyKey } from '../util.js';
import { conversionFunctions } from './conversions.js';
import { countryFunctions } from './countries.js';
import { encodingFunctions } from './encoding.js';
import { mapEntryFunctions } from './map-entries.js';
import { passwordFunctions } from './password.js';
import { regexFunctions } from './regex.js';
import { resolveIdFunctions } from './resolve-ids.js';
import { stringFunctions } from './strings.js';

// name -> { run(value, config, ctx), mapsArrayInput? }. Keys must equal the catalog's
// functionParameters keys (pinned by tests/engine-structure.test.js).
export const functionRegistry = {
  ...stringFunctions,
  ...regexFunctions,
  ...encodingFunctions,
  ...mapEntryFunctions,
  ...countryFunctions,
  ...conversionFunctions,
  ...passwordFunctions,
  ...resolveIdFunctions,
};

const propertyKeyFields = [
  'key',
  'sourceKey',
  'targetKey',
  'applyOnAttribute',
  'applyOnJsonAttribute',
  'assignToAttribute',
  'outputAttribute',
];

function validateConfig(name, config) {
  if (!own(functionParameters, name)) fail(`Unsupported mapping function: ${name}`);
  checkKeys(config, [...commonFunctionKeys, ...functionParameters[name]], `function ${name}`);
  for (const field of propertyKeyFields) {
    if (own(config, field)) propertyKey(config[field], `${name} ${field}`);
  }
  if (config.applyOnElements !== undefined && typeof config.applyOnElements !== 'boolean') {
    fail('applyOnElements must be boolean');
  }
  if (config.function && config.type && config.function !== config.type) fail('Conflicting function and type names');
}

// Applies one function to a single value or, with applyOnAttribute, to one attribute of an object.
function applyToElement(entry, element, config, ctx, observations) {
  if (config.condition) {
    const result = evaluateCondition(config.condition, element, { ...ctx.env, filterMode: true, rootData: ctx.data });
    observations?.push({ expression: config.condition, result, input: clone(element) });
    if (!result) return element;
  }

  const attribute = config.applyOnAttribute ?? config.applyOnJsonAttribute;
  if (attribute !== undefined) {
    if (!element || typeof element !== 'object') fail(`${ctx.name} applyOnAttribute requires objects`);
    if (forbidden.has(attribute) || forbidden.has(config.assignToAttribute)) fail('Unsafe function attribute');
    const result = clone(element);
    result[config.assignToAttribute ?? attribute] = entry.run(element[attribute], config, ctx);
    return result;
  }
  if (config.assignToAttribute !== undefined) fail('assignToAttribute requires applyOnAttribute');
  return entry.run(element, config, ctx);
}

// `observations` (debug only) collects the evaluated per-element function conditions.
// `note(key, value)` (optional) lets a function report facts about its result to the caller,
// e.g. note('fallbackUsed', true) when a documented default replaced an unmapped value.
export function applyFunction(input, rawConfig, data, env, observations, note) {
  const config = interpolate(rawConfig, env);
  const name = config.function ?? config.type;
  validateConfig(name, config);

  // Own-property lookup: a missing entry must never fall through to Object.prototype (e.g. toString).
  if (!own(functionRegistry, name)) fail(`Unsupported mapping function: ${name}`);
  const entry = functionRegistry[name];
  const ctx = {
    name,
    data,
    env,
    required: (key) => (own(config, key) ? config[key] : fail(`${name} requires ${key}`)),
    note: note ?? (() => {}),
  };
  const applyOne = (element) => applyToElement(entry, element, config, ctx, observations);

  if (config.applyOnElements || (Array.isArray(input) && entry.mapsArrayInput)) {
    if (!Array.isArray(input)) fail(`${name} applyOnElements requires an array`);
    return input.map((element) => applyOne(element));
  }
  return applyOne(input);
}
