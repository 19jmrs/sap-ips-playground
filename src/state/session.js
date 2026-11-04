import { entityTypes, executionModes } from '../engine/catalog.js';

// Opt-in, tab-scoped recovery. Only editor inputs are stored; execution results and errors never are.
export const SESSION_KEY = 'ips-playground.workspace';
export const SESSION_VERSION = 1;
export const SESSION_DEBOUNCE_MS = 500;
export const STORAGE_UNAVAILABLE_NOTE =
  'Browser storage is unavailable or full, so this work is kept in memory only and will not survive a reload.';

const TEXT_FIELDS = ['data', 'source', 'target', 'context', 'entityPath', 'example', 'expression'];
const EXPRESSION_KINDS = ['jsonpath', 'condition'];
const WORKSPACES = ['transformations', 'expressions'];

export function snapshotForStorage(state) {
  return {
    version: SESSION_VERSION,
    workspace: state.workspace,
    data: state.data,
    source: state.source,
    target: state.target,
    context: state.context,
    mode: state.mode,
    entityType: state.entityType,
    entityPath: state.entityPath,
    debug: state.debug,
    example: state.example,
    expression: state.expression,
    expressionKind: state.expressionKind,
  };
}

/** Returns the fields to overlay on the initial workspace, or null when the stored value is not usable. */
export function restoreSnapshot(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || raw.version !== SESSION_VERSION) return null;
  const valid =
    TEXT_FIELDS.every((field) => typeof raw[field] === 'string') &&
    typeof raw.debug === 'boolean' &&
    executionModes.includes(raw.mode) &&
    entityTypes.includes(raw.entityType) &&
    EXPRESSION_KINDS.includes(raw.expressionKind) &&
    WORKSPACES.includes(raw.workspace);
  if (!valid) return null;
  const { version, ...fields } = snapshotForStorage(raw);
  return fields;
}

/**
 * Wraps a sessionStorage-like object. `getStorage` is called per operation because merely touching
 * `window.sessionStorage` can throw when storage is blocked. Failures never propagate.
 */
export function createSessionStore(getStorage) {
  function attempt(action) {
    try {
      return { ok: true, value: action(getStorage()) };
    } catch {
      return { ok: false, value: null };
    }
  }
  return {
    read() {
      const { ok, value } = attempt((storage) => storage.getItem(SESSION_KEY));
      return ok && typeof value === 'string' ? restoreSnapshot(value) : null;
    },
    write(state) {
      return attempt((storage) => storage.setItem(SESSION_KEY, JSON.stringify(snapshotForStorage(state)))).ok;
    },
    clear() {
      return attempt((storage) => storage.removeItem(SESSION_KEY)).ok;
    },
  };
}

export const browserSessionStore = createSessionStore(() => globalThis.sessionStorage);
