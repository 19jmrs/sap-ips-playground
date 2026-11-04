import { parseJsonField } from './caseFile.js';
import { CONTEXT_PLACEHOLDER } from './context.js';

// The Runtime context as an object. A variable still holding the placeholder the app inserted for a missing variable
// is refused, because running with it would produce output from an invented value.
function runtimeContext(text) {
  const context = parseJsonField(text, 'Runtime context');
  for (const [name, value] of Object.entries(context?.variables ?? {})) {
    if (value === CONTEXT_PLACEHOLDER) {
      throw new Error(
        `Runtime context: variables.${name} still has the placeholder ${CONTEXT_PLACEHOLDER}. Enter its real value.`,
      );
    }
  }
  return context;
}

/** Arguments for `executePipeline`; throws a labelled error when a document the chosen mode needs is not JSON. */
export function pipelineRequest(state) {
  return {
    data: parseJsonField(state.data, 'Source data'),
    source: state.mode === 'target' ? undefined : parseJsonField(state.source, 'Source transformation'),
    target: state.mode === 'source' ? undefined : parseJsonField(state.target, 'Target transformation'),
    mode: state.mode,
    entityPath: state.entityPath,
    entityType: state.entityType,
    context: runtimeContext(state.context),
    debug: state.debug,
  };
}

export function expressionRequest(state) {
  return {
    data: parseJsonField(state.data, 'Source data'),
    expression: state.expression,
    kind: state.expressionKind,
    context: runtimeContext(state.context),
  };
}

export function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
