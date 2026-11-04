import { entityTypes, executionModes } from '../engine/catalog.js';

// Export format. Version 1 is also what files exported before versioning existed contain.
export const CASE_SCHEMA_VERSION = 1;
export const MAX_CASE_FILE_BYTES = 5_000_000;
export const CASE_FILE_NAME = 'ips-playground-case.json';

const FIELDS = ['data', 'source', 'target', 'mode', 'entityPath', 'entityType', 'context', 'debug'];
const KNOWN_KEYS = new Set(['schemaVersion', ...FIELDS]);

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}

const mustBeObject = (value) => (isPlainObject(value) ? null : `must be a JSON object, found ${describe(value)}`);

const fieldChecks = {
  source: mustBeObject,
  target: mustBeObject,
  context: mustBeObject,
  mode: (value) =>
    executionModes.includes(value)
      ? null
      : `must be one of ${executionModes.join(', ')}, found ${JSON.stringify(value)}`,
  entityType: (value) =>
    entityTypes.includes(value) ? null : `must be one of ${entityTypes.join(', ')}, found ${JSON.stringify(value)}`,
  entityPath: (value) => (typeof value === 'string' ? null : `must be a string, found ${describe(value)}`),
  debug: (value) => (typeof value === 'boolean' ? null : `must be true or false, found ${describe(value)}`),
};

export function caseFileSizeError(byteLength) {
  if (byteLength <= MAX_CASE_FILE_BYTES) return null;
  return `The file is larger than the ${MAX_CASE_FILE_BYTES / 1_000_000} MB case limit and was not loaded.`;
}

/**
 * Validates the text of an exported case file.
 * Returns `{ ok: true, case }` with all eight fields, or `{ ok: false, errors }`; nothing is partially accepted.
 */
export function parseCaseFile(text) {
  const sizeError = caseFileSizeError(text.length);
  if (sizeError) return { ok: false, errors: [sizeError] };
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    return { ok: false, errors: [`The file is not valid JSON: ${error.message}`] };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, errors: [`A case file must be a JSON object, found ${describe(parsed)}.`] };
  }
  const errors = [];
  if (Object.hasOwn(parsed, 'schemaVersion')) {
    const version = parsed.schemaVersion;
    if (!Number.isInteger(version) || version < 1) errors.push('schemaVersion must be a positive integer.');
    else if (version > CASE_SCHEMA_VERSION) {
      errors.push(`schemaVersion ${version} is newer than this playground supports (${CASE_SCHEMA_VERSION}).`);
    }
  }
  for (const key of Object.keys(parsed)) {
    if (!KNOWN_KEYS.has(key)) errors.push(`Unknown field "${key}".`);
  }
  for (const field of FIELDS) {
    if (!Object.hasOwn(parsed, field)) errors.push(`Missing field "${field}".`);
    else {
      const problem = fieldChecks[field]?.(parsed[field]);
      if (problem) errors.push(`Field "${field}" ${problem}.`);
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, case: Object.fromEntries(FIELDS.map((field) => [field, parsed[field]])) };
}

export function caseErrorMessage(errors) {
  const shown = errors.slice(0, 4).join(' ');
  const more = errors.length > 4 ? ` (+${errors.length - 4} more problems)` : '';
  return `Case not imported. ${shown}${more}`;
}

export function parseJsonField(text, name) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${name}: ${error.message}`);
  }
}

/** Builds the exported case document from the editor texts; throws a labelled error on invalid JSON. */
export function serializeCase(workspace) {
  return {
    schemaVersion: CASE_SCHEMA_VERSION,
    data: parseJsonField(workspace.data, 'Source data'),
    source: parseJsonField(workspace.source, 'Source transformation'),
    target: parseJsonField(workspace.target, 'Target transformation'),
    mode: workspace.mode,
    entityPath: workspace.entityPath,
    entityType: workspace.entityType,
    context: parseJsonField(workspace.context, 'Runtime context'),
    debug: workspace.debug,
  };
}
