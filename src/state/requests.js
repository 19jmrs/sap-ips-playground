import { parseJsonField } from './caseFile.js';

/** Arguments for `executePipeline`; throws a labelled error when a document the chosen mode needs is not JSON. */
export function pipelineRequest(state) {
  return {
    data: parseJsonField(state.data, 'Source data'),
    source: state.mode === 'target' ? undefined : parseJsonField(state.source, 'Source transformation'),
    target: state.mode === 'source' ? undefined : parseJsonField(state.target, 'Target transformation'),
    mode: state.mode,
    entityPath: state.entityPath,
    entityType: state.entityType,
    context: parseJsonField(state.context, 'Runtime context'),
    debug: state.debug,
  };
}

export function expressionRequest(state) {
  return {
    data: parseJsonField(state.data, 'Source data'),
    expression: state.expression,
    kind: state.expressionKind,
    context: parseJsonField(state.context, 'Runtime context'),
  };
}

export function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
