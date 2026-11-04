import { fail } from './util.js';

// Trailing JSONPath methods (`$.items.length()`), evaluated locally.
//
// Evidence: Jayway JsonPath's function sources (AbstractAggregation, Sum, Min, Max, Average,
// Length, AbstractSequenceAggregation). Jayway silently skips non-numeric members and throws on
// an empty input; this evaluator is stricter on purpose: a non-numeric member is an explicit
// error naming the function and the value, because SAP's exact JsonPath version is unknown.
// No method ever returns NaN or +-Infinity. `size()` is not a Jayway function; it is kept as
// an alias of `length()` (bounded).
export const pathMethodNames = ['length', 'size', 'first', 'last', 'min', 'max', 'sum', 'avg'];

const alternatives = pathMethodNames.join('|');
export const pathMethodCall = new RegExp(`\\.(${alternatives})\\(\\)$`);
export const pathMethodName = new RegExp(`\\.(${alternatives})$`);

function describe(value) {
  if (value === undefined) return 'a missing value';
  const text = JSON.stringify(value);
  return text.length > 40 ? `${text.slice(0, 37)}...` : text;
}

function numbers(method, values) {
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      fail(`${method}() requires numeric values but found ${describe(value)}`);
    }
  }
  return values;
}

function nonEmptyNumbers(method, values) {
  if (!values.length) fail(`${method}() cannot be applied to an empty array`);
  return numbers(method, values);
}

function finite(method, result) {
  if (!Number.isFinite(result)) fail(`${method}() result is out of numeric range`);
  return result;
}

function total(values) {
  return values.reduce((sum, n) => sum + n, 0);
}

function lengthOf(method, value) {
  if (value == null) return 0;
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'object') return Object.keys(value).length;
  if (typeof value === 'string') return value.length;
  return fail(`${method}() requires an array, object or string but found ${describe(value)}`);
}

export function applyPathMethod(method, value) {
  const values = Array.isArray(value) ? value : [value];
  switch (method) {
    case 'length':
    case 'size':
      return lengthOf(method, value);
    case 'first':
      return values[0];
    case 'last':
      return values.at(-1);
    case 'min':
      return nonEmptyNumbers(method, values).reduce((least, n) => Math.min(least, n));
    case 'max':
      return nonEmptyNumbers(method, values).reduce((most, n) => Math.max(most, n));
    case 'sum':
      return finite(method, total(numbers(method, values)));
    case 'avg':
      return finite(method, total(nonEmptyNumbers(method, values)) / values.length);
  }
}
