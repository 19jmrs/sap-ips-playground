import { useMemo, useReducer } from 'react';
import { detectEntityPath } from '../engine/catalog.js';
import { executeExpression, executePipeline } from '../execution.js';
import { pretty } from '../examples.js';
import {
  CASE_FILE_NAME,
  caseErrorMessage,
  caseFileSizeError,
  parseCaseFile,
  serializeCase,
} from '../state/caseFile.js';
import { expressionRequest, pipelineRequest, safeParse } from '../state/requests.js';
import { browserSessionStore } from '../state/session.js';
import { initialState, isRunning, reducer } from '../state/workspace.js';
import { downloadText } from './downloadText.js';
import { useSessionRecovery } from './useSessionRecovery.js';

const errorNotice = (title, message) => ({ tone: 'error', title, message });

/** Owns the workspace reducer and the side effects around it: worker runs, file import/export, session recovery. */
export function useWorkspace() {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState(browserSessionStore.read()));
  useSessionRecovery(state, dispatch);
  const payload = useMemo(() => safeParse(state.data), [state.data]);
  const running = isRunning(state);

  const fail = (title, error) => dispatch({ type: 'notice', notice: errorNotice(title, error.message) });

  async function run() {
    if (running) return;
    let request;
    try {
      request = pipelineRequest(state);
    } catch (error) {
      fail('Unable to run', error);
      return;
    }
    dispatch({ type: 'runStarted', kind: 'transformation' });
    try {
      dispatch({ type: 'transformationFinished', result: await executePipeline(request) });
    } catch (error) {
      dispatch({ type: 'transformationFailed', message: error.message });
    }
  }

  async function runExpression() {
    if (running) return;
    let request;
    try {
      request = expressionRequest(state);
    } catch (error) {
      dispatch({ type: 'runStarted', kind: 'expression' });
      dispatch({ type: 'expressionFailed', message: error.message });
      return;
    }
    dispatch({ type: 'runStarted', kind: 'expression' });
    try {
      dispatch({ type: 'expressionFinished', value: await executeExpression(request) });
    } catch (error) {
      dispatch({ type: 'expressionFailed', message: error.message });
    }
  }

  function detect() {
    try {
      const path = detectEntityPath(JSON.parse(state.data));
      dispatch({ type: 'edit', field: 'entityPath', value: path });
      dispatch({ type: 'dismissNotice' });
    } catch (error) {
      fail('Unable to detect entity path', new Error(`Source data: ${error.message}`));
    }
  }

  function exportCase() {
    try {
      downloadText(CASE_FILE_NAME, pretty(serializeCase(state)));
    } catch (error) {
      fail('Unable to export case', error);
    }
  }

  async function importCase(file) {
    const tooLarge = caseFileSizeError(file.size);
    if (tooLarge) return fail('Unable to import case', new Error(tooLarge));
    let text;
    try {
      text = await file.text();
    } catch {
      return fail('Unable to import case', new Error(`${file.name} could not be read.`));
    }
    const parsed = parseCaseFile(text);
    if (!parsed.ok) return fail('Unable to import case', new Error(caseErrorMessage(parsed.errors)));
    dispatch({
      type: 'loadCase',
      case: parsed.case,
      message: `${file.name} was loaded without running it. Press Run transformation to see results.`,
    });
  }

  return {
    state,
    payload,
    running,
    setField: (field, value) => dispatch({ type: 'edit', field, value }),
    setWorkspace: (workspace) => dispatch({ type: 'setWorkspace', workspace }),
    setExpressionKind: (kind) => dispatch({ type: 'setExpressionKind', kind }),
    loadExample: (id) => dispatch({ type: 'loadExample', id }),
    setKeepOnReload: (value) => dispatch({ type: 'setKeepOnReload', value }),
    dismissNotice: () => dispatch({ type: 'dismissNotice' }),
    clear: () => dispatch({ type: 'clear' }),
    run,
    runExpression,
    detect,
    exportCase,
    importCase,
  };
}
