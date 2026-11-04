import { supportedFunctions } from '../engine/catalog.js';
import { pretty } from '../examples';
import ContextPanel from './ContextPanel';
import JsonEditor from './JsonEditor';

const EXAMPLES = {
  condition: 'Example: $.Resources[0].active == true',
  jsonpath: 'Example: $.Resources[*].userName',
};

function ExpressionResult({ state }) {
  if (state.expressionError) {
    return (
      <div className="execution-error" role="alert">
        {state.expressionError}
      </div>
    );
  }
  if (state.expressionResult === undefined) {
    return (
      <div className="expression-empty">
        {state.expressionHasRun
          ? 'The expression matched no value (undefined).'
          : 'Press Run expression to inspect values.'}
      </div>
    );
  }
  return <pre className="expression-output">{pretty(state.expressionResult)}</pre>;
}

export default function ExpressionWorkspace({ workspace }) {
  const { state, payload, running, ...actions } = workspace;
  const isCondition = state.expressionKind === 'condition';
  return (
    <>
      <div className="expression-toolbar">
        <label>
          Evaluate
          <select value={state.expressionKind} onChange={(event) => actions.setExpressionKind(event.target.value)}>
            <option value="jsonpath">JSONPath extraction</option>
            <option value="condition">IPS condition</option>
          </select>
        </label>
        <button className="primary-button" disabled={running} onClick={actions.runExpression}>
          <span aria-hidden="true">▶</span> {running ? 'Running…' : 'Run expression'}
        </button>
      </div>
      <div className="expression-grid">
        <JsonEditor
          title="Source data"
          value={state.data}
          onChange={(value) => actions.setField('data', value)}
          payload={payload}
          height="400px"
        />
        <section className="expression-panel">
          <p className="expression-label">{isCondition ? 'IPS condition' : 'JSONPath expression'}</p>
          <JsonEditor
            title="Expression"
            value={state.expression}
            onChange={(value) => actions.setField('expression', value)}
            payload={payload}
            functions={supportedFunctions}
            height="110px"
            expressionMode
          />
          <p className="muted">{isCondition ? EXAMPLES.condition : EXAMPLES.jsonpath}</p>
          <h3>
            Result{' '}
            {state.expressionStale && state.expressionResult !== undefined ? (
              <small className="stale">Inputs changed · run again</small>
            ) : null}
          </h3>
          <div aria-live="polite">
            <ExpressionResult state={state} />
          </div>
        </section>
      </div>
      <ContextPanel value={state.context} payload={payload} onChange={(value) => actions.setField('context', value)} />
    </>
  );
}
