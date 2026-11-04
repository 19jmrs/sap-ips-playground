import { useEffect, useRef } from 'react';
import { SESSION_DEBOUNCE_MS, STORAGE_UNAVAILABLE_NOTE, browserSessionStore } from '../state/session.js';

/**
 * Mirrors the editor inputs into sessionStorage only while `state.keepOnReload` is on, and removes the stored copy
 * as soon as it is turned off (Clear turns it off too). Storage failures leave the app memory-only with a note.
 */
export function useSessionRecovery(state, dispatch) {
  const { keepOnReload, workspace, data, source, target, context, mode, entityType, entityPath, debug } = state;
  const { example, expression, expressionKind } = state;
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  });

  useEffect(() => {
    if (!keepOnReload) browserSessionStore.clear();
  }, [keepOnReload]);

  useEffect(() => {
    if (!keepOnReload) return undefined;
    const timer = setTimeout(() => {
      const saved = browserSessionStore.write(latest.current);
      dispatch({ type: 'storageStatus', note: saved ? null : STORAGE_UNAVAILABLE_NOTE });
    }, SESSION_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    keepOnReload,
    workspace,
    data,
    source,
    target,
    context,
    mode,
    entityType,
    entityPath,
    debug,
    example,
    expression,
    expressionKind,
    dispatch,
  ]);

  // The debounce can lose the last edits when the tab is closed or reloaded quickly.
  useEffect(() => {
    if (!keepOnReload) return undefined;
    const flush = () => browserSessionStore.write(latest.current);
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [keepOnReload]);
}
