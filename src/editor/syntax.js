// Syntax checks for IPS condition strings, source/target JSONPath strings, regular expressions and date patterns.
//
// There is no second parser here: every check calls the engine's own parse-only validator, so an "error" is
// exactly something the evaluator fails on when it reads the string, and the position comes from the engine.
//
// Import rule for src/editor/**: the editor MAY import the pure engine modules that have no dataset or heavy
// imports -- util.js, jsonpath.js, path-text.js, condition-tokenizer.js, conditions.js, functions/java-regex.js,
// dates.js, target-path.js and catalog.js (plus their own dependencies: errors.js, environment.js,
// path-methods.js, condition-functions.js). It MUST NOT import engine/index.js, pipeline.js,
// functions/countries.js, functions/conversions.js or anything that pulls i18n-iso-countries,
// country-region-data or timezones.json: those belong to the worker chunk only. tests/editor-engine-parity.test.js
// walks the import graph and fails if the editor can reach one of them.
//
// Every checker returns issues { from, to, severity, code, message } with offsets into the checked string; when
// the engine reports no position the range is the whole string. No SAP validity is implied.
import { validateCondition } from '../engine/conditions.js';
import { validateDatePattern, validateManipulateDate } from '../engine/dates.js';
import { validateJavaRegex } from '../engine/functions/java-regex.js';
import { validateJsonPath } from '../engine/jsonpath.js';
import { validateTargetPath } from '../engine/target-path.js';
import { conditionFunctions, get } from './vocab.js';

// ${variable} and %property% placeholders. The engine resolves them before it reads a function parameter, so their
// value (and what it would do to a regex or date pattern) is unknown to the editor.
export const isTemplated = (value) => typeof value === 'string' && /\$\{[^}]+\}|%[^%\s]+%/.test(value);

// Keeps offsets stable while a placeholder is unknown: masked with digits so path/condition parsers accept it.
export function maskPlaceholders(text) {
  return text.replace(/\$\{[^}]+\}|%[^%\s]+%/g, (match) => '0'.repeat(match.length));
}

export const startsWithPlaceholder = (text) => /^(?:\$\{[^}]+\}|%[^%\s]+%)/.test(text);

function issue(from, to, severity, code, message) {
  return { from, to: Math.max(to, from + 1), severity, code, message };
}

// An engine failure { domain, kind, message, offset?, length? } as editor issues for `text`.
function failure(text, error, code, severity = 'error') {
  const from = error.offset ?? 0;
  const to = error.offset === undefined ? text.length : from + (error.length ?? 1);
  return [issue(from, Math.min(to, text.length), severity, code, error.message)];
}

const codeOf = (error) => (error.domain === 'target' ? 'target-path' : `${error.domain}-${error.kind}`);

// Conditional functions are looked up when a call is reached, so a call the editor cannot prove is reached is a
// warning (a short-circuited branch never runs it). Argument counts are not checked by the engine at all.
function callWarnings(calls) {
  const found = [];
  for (const { name, args, offset, length } of calls) {
    const known = get(conditionFunctions, name);
    if (!known) {
      found.push(
        issue(offset, offset + length, 'warning', 'condition-function', `Unsupported conditional function: ${name}.`),
      );
    } else if (known.args !== args) {
      found.push(
        issue(
          offset,
          offset + length,
          'warning',
          'condition-arguments',
          `${name} is written as ${known.signature}; this call has ${args} argument${args === 1 ? '' : 's'}.`,
        ),
      );
    }
  }
  return found;
}

// `inFilter` is true for the body of a `[?(...)]` filter. At most one error: the evaluator stops at the first.
export function checkCondition(text, { inFilter = false } = {}) {
  const result = validateCondition(text, { inFilter });
  return result.ok ? callWarnings(result.calls) : failure(text, result.error, codeOf(result.error));
}

// sourcePath, sourcePaths entries, subId and JSONPath expressions.
export function checkJsonPath(text) {
  const result = validateJsonPath(text);
  return result.ok ? [] : failure(text, result.error, codeOf(result.error));
}

// `kind`: 'set' | 'remove' | 'rename' (valueMapping writes like set).
export function checkTargetPath(text, kind = 'set') {
  const result = validateTargetPath(text, kind);
  return result.ok ? [] : failure(text, result.error, codeOf(result.error));
}

// Java regular expression as the translator reads it. Errors that depend on the input text (guards) are not
// reported: the engine refuses those only when it sees such an input.
export function checkRegex(pattern) {
  const result = validateJavaRegex(pattern);
  return result.ok ? [] : failure(pattern, result.error, 'regex');
}

// `role`: 'source' (sourceDateFormat) or 'target' (targetDateFormat).
export function checkDatePattern(pattern, role) {
  const result = validateDatePattern(pattern, role);
  return result.ok ? [] : failure(pattern, result.error, 'date-format');
}

// Whole-function check of manipulateDate. `options` holds only the values that are known (no placeholders). The
// failing option's name comes back as `key` so the caller can point at that property.
export function checkManipulateDate(options) {
  const result = validateManipulateDate(options);
  return result.ok ? null : result.error;
}
