import { contextOperations } from '../engine/catalog.js';

// Helpers over the Runtime context *text*. The text stays the single source of truth: settings such as the operation
// dropdown read and write it, so exports, imports and session recovery need no second copy to keep in step.

export const CONTEXT_PLACEHOLDER = 'REPLACE_WITH_VALUE';

const isPlain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// The parsed context, or null when the text is not a JSON object (or `variables` is not one). Callers then leave the
// text for the editor to report instead of overwriting what the user typed.
function parseContext(text) {
  let context;
  try {
    context = JSON.parse(text);
  } catch {
    return null;
  }
  return isPlain(context) && (context.variables === undefined || isPlain(context.variables)) ? context : null;
}

/**
 * The context text with `variables.<name>` present for every name, so the user only has to type the values. A variable
 * that is already there is left as it is. Null when the text is unusable.
 */
export function contextWithVariables(text, names) {
  const context = parseContext(text);
  if (context === null) return null;
  const absent = names.filter((name) => !(context.variables && Object.hasOwn(context.variables, name)));
  if (absent.length === 0) return text;
  const placeholders = Object.fromEntries(absent.map((name) => [name, CONTEXT_PLACEHOLDER]));
  return JSON.stringify({ ...context, variables: { ...context.variables, ...placeholders } }, null, 2);
}

/** The selected operation: '' when none (or not a valid one, which the editor flags), null when the text is unusable. */
export function operationOf(text) {
  const context = parseContext(text);
  if (context === null) return null;
  return contextOperations.includes(context.operation) ? context.operation : '';
}

/** The context text with `operation` set, or removed for ''. Null when the text is unusable. */
export function contextWithOperation(text, operation) {
  const context = parseContext(text);
  if (context === null) return null;
  const { operation: _previous, ...rest } = context;
  return JSON.stringify(operation === '' ? rest : { ...rest, operation }, null, 2);
}
