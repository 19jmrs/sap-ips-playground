import { fail } from '../util.js';

// Shared input/parameter coercion for mapping functions. SAP documents string and number
// parameters (concatString also boolean) and gives no coercion rules for anything else, so
// null, arrays and objects are rejected instead of being stringified into "null" or
// "[object Object]".

function describeValue(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'a missing value';
  if (Array.isArray(value)) return 'an array';
  return typeof value === 'object' ? 'an object' : JSON.stringify(value);
}

// The function input as text. Numbers use JavaScript formatting (123 -> "123"); Java
// number formatting for floats is not reproduced.
export function inputText(value, ctx) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fail(`${ctx.name} requires a string, number or boolean input, got ${describeValue(value)}`);
}

// A string-or-number parameter such as regex, replacement or target.
export function textParameter(value, name, ctx) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return fail(`${ctx.name} ${name} must be a string or number, got ${describeValue(value)}`);
}

export function integerParameter(value, name, ctx) {
  if (!Number.isInteger(value)) fail(`${ctx.name} ${name} must be an integer, got ${describeValue(value)}`);
  return value;
}
