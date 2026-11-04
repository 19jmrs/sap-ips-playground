import { examples, pretty } from '../examples.js';
import { contextWithVariables } from './context.js';
import { missingContext } from './results.js';

// Which editable fields invalidate which result. Revisions let a run that finishes after an edit be marked stale.
export const TRANSFORMATION_INPUTS = [
  'data',
  'source',
  'target',
  'context',
  'mode',
  'entityType',
  'entityPath',
  'debug',
];
export const EXPRESSION_INPUTS = ['data', 'context', 'expression', 'expressionKind'];

export const DEFAULT_EXPRESSIONS = {
  jsonpath: '$.Resources[*].userName',
  condition: '$.Resources[0].active == true',
};

const BLANK_TRANSFORMATION = '{\n  "user": {\n    "mappings": []\n  }\n}';

function exampleFields(item) {
  return {
    data: pretty(item.data),
    source: pretty(item.source),
    target: pretty(item.target),
    context: pretty(item.context),
    mode: item.mode,
    entityType: item.entityType,
    entityPath: item.entityPath,
  };
}

function resultFields() {
  return {
    result: null,
    resultMode: 'chain',
    resultDebug: false,
    stale: false,
    expressionResult: undefined,
    expressionHasRun: false,
    expressionStale: false,
    notice: null,
    expressionError: '',
  };
}

export function blankState(workspace = 'transformations') {
  return {
    workspace,
    data: '{}',
    source: BLANK_TRANSFORMATION,
    target: BLANK_TRANSFORMATION,
    context: '{}',
    mode: 'chain',
    entityType: 'user',
    entityPath: '$',
    debug: false,
    contextOpen: false,
    example: '',
    expression: '',
    expressionKind: 'jsonpath',
    ...resultFields(),
    revision: 0,
    expressionRevision: 0,
    pending: null,
    keepOnReload: false,
    storageNote: null,
  };
}

/** Starting workspace: the first shipped example, optionally overlaid with a restored session snapshot. */
export function initialState(restored) {
  const first = examples[0];
  return {
    ...blankState(),
    ...exampleFields(first),
    example: first.id,
    expression: DEFAULT_EXPRESSIONS.jsonpath,
    ...(restored ? { ...restored, keepOnReload: true } : {}),
  };
}

export const isRunning = (state) => state.pending !== null;

function invalidate(state, { transformation, expression }) {
  const next = { ...state };
  if (transformation) {
    next.revision += 1;
    next.stale = true;
  }
  if (expression) {
    next.expressionRevision += 1;
    next.expressionStale = true;
  }
  return next;
}

function afterEdit(state, field) {
  const next = invalidate(state, {
    transformation: TRANSFORMATION_INPUTS.includes(field),
    expression: EXPRESSION_INPUTS.includes(field),
  });
  return next.notice?.tone === 'info' ? { ...next, notice: null } : next;
}

function loadFields(state, fields, example) {
  return { ...invalidate({ ...state, ...fields, example }, { transformation: true, expression: true }), notice: null };
}

function finishRun(state, kind, patch) {
  if (state.pending?.kind !== kind) return state;
  return { ...state, ...patch, pending: null };
}

export function reducer(state, action) {
  switch (action.type) {
    case 'setWorkspace':
      return { ...state, workspace: action.workspace };

    case 'edit': {
      if (state[action.field] === action.value) return state;
      return afterEdit({ ...state, [action.field]: action.value }, action.field);
    }

    case 'setExpressionKind': {
      if (state.expressionKind === action.kind) return state;
      const expression = DEFAULT_EXPRESSIONS[action.kind] ?? '';
      return afterEdit({ ...state, expressionKind: action.kind, expression }, 'expressionKind');
    }

    case 'loadExample': {
      const item = examples.find((candidate) => candidate.id === action.id);
      return item ? loadFields(state, exampleFields(item), item.id) : state;
    }

    // Imported cases never execute: results are kept (marked stale) until the user presses Run.
    case 'loadCase': {
      const { data, source, target, context, ...rest } = action.case;
      const fields = {
        ...rest,
        data: pretty(data),
        source: pretty(source),
        target: pretty(target),
        context: pretty(context),
      };
      return {
        ...loadFields(state, fields, ''),
        notice: { tone: 'info', title: 'Case imported', message: action.message },
      };
    }

    case 'notice':
      return { ...state, notice: action.notice };

    case 'dismissNotice':
      return state.notice ? { ...state, notice: null } : state;

    case 'runStarted': {
      if (state.pending) return state;
      if (action.kind === 'expression') {
        return {
          ...state,
          expressionError: '',
          expressionHasRun: true,
          pending: { kind: 'expression', revision: state.expressionRevision },
        };
      }
      return {
        ...state,
        notice: null,
        pending: { kind: 'transformation', revision: state.revision, mode: state.mode, debug: state.debug },
      };
    }

    // A run that failed on missing context says so. Missing variables are added to the Runtime context with a
    // placeholder and the panel opens; a missing operation points at the Operation setting, because only the user
    // knows which one to test. This is not an edit: the finished run stays current, and run requests refuse a
    // placeholder that was never replaced, so no invented value can reach a result.
    case 'transformationFinished': {
      const { pending } = state;
      const stale = state.revision !== pending?.revision;
      const missing = stale ? { variables: [], operation: false } : missingContext(action.result);
      const context = contextWithVariables(state.context, missing.variables);
      const added = context !== null && context !== state.context;
      const notes = [
        ...(added ? [`Added ${missing.variables.join(', ')} to the Runtime context with a placeholder.`] : []),
        ...(missing.operation ? ['A mapping scope needs an operation: choose one in the Operation setting.'] : []),
      ];
      return finishRun(state, 'transformation', {
        result: action.result,
        resultMode: pending?.mode,
        resultDebug: pending?.debug,
        stale,
        ...(added && { context, contextOpen: true }),
        ...(notes.length > 0 && {
          notice: { tone: 'info', title: 'More input needed', message: `${notes.join(' ')} Then run again.` },
        }),
      });
    }

    case 'contextToggled':
      return state.contextOpen === action.open ? state : { ...state, contextOpen: action.open };

    case 'transformationFailed':
      return finishRun(state, 'transformation', {
        notice: { tone: 'error', title: 'Unable to run', message: action.message },
      });

    case 'expressionFinished':
      return finishRun(state, 'expression', {
        expressionResult: action.value,
        expressionStale: state.expressionRevision !== state.pending?.revision,
      });

    case 'expressionFailed':
      return finishRun(state, 'expression', { expressionError: action.message, expressionResult: undefined });

    case 'clear':
      if (state.pending) return state;
      return blankState(state.workspace);

    case 'setKeepOnReload':
      return { ...state, keepOnReload: action.value, storageNote: action.value ? state.storageNote : null };

    case 'storageStatus':
      return state.storageNote === action.note ? state : { ...state, storageNote: action.note };

    default:
      return state;
  }
}
