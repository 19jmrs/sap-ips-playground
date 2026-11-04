import { useRef, useState } from 'react';
import JsonEditor from './JsonEditor';
import { pretty } from '../examples';
import { changes, describeFailure, entityLabel, stageComparisons } from '../state/results.js';

const TABS = [
  ['source', 'After source'],
  ['target', 'After target'],
  ['changes', 'Changes'],
  ['trace', 'Trace'],
];

const STAGE_NAMES = { source: 'Source transformation', target: 'Target transformation' };

function Display({ value, label }) {
  return value === undefined ? (
    <div className="empty-stage">{label}</div>
  ) : (
    <JsonEditor title="Output" value={pretty(value)} readOnly height="275px" />
  );
}

function entityStatus(item) {
  if (item.error) return 'failed';
  return item.skipped ? 'skipped' : 'succeeded';
}

function FailureNotice({ entity }) {
  const failure = describeFailure(entity);
  if (!failure) return null;
  const where = [
    failure.stage ? (STAGE_NAMES[failure.stage] ?? failure.stage) : null,
    failure.mapping ? `mapping ${failure.mapping}` : null,
  ].filter(Boolean);
  return (
    <div className="execution-error" role="alert">
      <strong>Entity failed{where.length ? ` · ${where.join(' · ')}` : ''}</strong>
      <p>{failure.message}</p>
      {failure.path ? (
        <p>
          Source path: <code>{failure.path}</code>
        </p>
      ) : null}
    </div>
  );
}

function ChangesView({ entity, stage, onStage }) {
  const comparisons = stageComparisons(entity);
  const comparison = comparisons.find((item) => item.id === stage) ?? comparisons.at(-1);
  const delta = comparison ? changes(comparison.before, comparison.after) : [];
  return (
    <div className="changes-view">
      {comparisons.length > 1 ? (
        <label className="stage-select">
          Compare
          <select value={comparison.id} onChange={(event) => onStage(event.target.value)}>
            {comparisons.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <p className="view-caption">
        {comparison?.label ?? 'Input → final output'} · {delta.length} {delta.length === 1 ? 'change' : 'changes'}
      </p>
      {delta.length ? (
        <table>
          <thead>
            <tr>
              <th scope="col">Path</th>
              <th scope="col">Before</th>
              <th scope="col">After</th>
            </tr>
          </thead>
          <tbody>
            {delta.map((item) => (
              <tr key={item.path}>
                <td>
                  <small>{item.kind}</small>
                  <code>{item.path}</code>
                </td>
                <td>
                  <pre>{item.before === undefined ? '—' : pretty(item.before)}</pre>
                </td>
                <td>
                  <pre>{item.after === undefined ? '—' : pretty(item.after)}</pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>No changes.</p>
      )}
    </div>
  );
}

function TraceView({ entity, debug }) {
  if (!entity?.trace?.length) {
    return (
      <div className="trace-view">
        <p>
          {debug
            ? 'No mapping trace was produced for this entity.'
            : 'Enable Debug trace and run again to inspect each mapping.'}
        </p>
      </div>
    );
  }
  return (
    <div className="trace-view">
      {entity.trace.map((step, i) => (
        <details key={i} className="trace-step">
          <summary>
            <span className={`trace-state ${step.status === 'error' ? 'bad' : ''}`}>{step.status}</span>
            <strong>
              {step.stage} · mapping {(step.mapping ?? i) + 1}
            </strong>
            <code>
              {step.sourcePath ?? 'constant / context'} → {step.targetPath ?? 'variable'}
            </code>
          </summary>
          <pre>{pretty(step)}</pre>
        </details>
      ))}
    </div>
  );
}

export default function Results({ result, stale, debug, mode }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [tab, setTab] = useState('target');
  const [stage, setStage] = useState('final');
  const tabRefs = useRef({});
  const entities = result?.entities ?? [];
  const keyOf = (item, position) => item.index ?? position;
  const entity = entities.find((item, position) => keyOf(item, position) === selectedIndex) ?? entities[0];
  const disabled = (key) => (key === 'source' && mode === 'target') || (key === 'target' && mode === 'source');
  const enabledTabs = TABS.filter(([key]) => !disabled(key)).map(([key]) => key);
  const selectedTab = disabled(tab) ? (mode === 'source' ? 'source' : 'target') : tab;

  function onTabKeyDown(event) {
    const current = enabledTabs.indexOf(selectedTab);
    const target = {
      ArrowRight: enabledTabs[(current + 1) % enabledTabs.length],
      ArrowLeft: enabledTabs[(current - 1 + enabledTabs.length) % enabledTabs.length],
      Home: enabledTabs[0],
      End: enabledTabs.at(-1),
    }[event.key];
    if (!target) return;
    event.preventDefault();
    setTab(target);
    tabRefs.current[target]?.focus();
  }

  return (
    <section className="results-panel" aria-label="Execution results">
      <div className="results-heading">
        <h2>Execution results</h2>
        {result ? (
          <div className="result-counts">
            <span className="status success">✓ {result.summary.succeeded} succeeded</span>
            {result.summary.failed ? <span className="status failure">{result.summary.failed} failed</span> : null}
            {result.summary.skipped ? <span className="status">{result.summary.skipped} skipped</span> : null}
          </div>
        ) : (
          <span className="muted">Ready when you are</span>
        )}
        {stale && result ? (
          <span className="stale" role="status">
            Inputs changed · run again
          </span>
        ) : null}
      </div>
      {!result ? (
        <div className="results-empty">
          <span className="empty-brackets" aria-hidden="true">
            {'{ }'}
          </span>
          <h3>Follow your data through every stage.</h3>
          <p>
            Choose an example or paste your JSON, then run the transformation.
            <br />
            Results only change when you press Run.
          </p>
        </div>
      ) : (
        <div className="results-body">
          <aside className="entity-list" aria-label="Entities">
            <h3>Entities ({entities.length})</h3>
            {entities.map((item, position) => (
              <button
                key={keyOf(item, position)}
                onClick={() => setSelectedIndex(keyOf(item, position))}
                aria-current={entity === item ? 'true' : undefined}
                className={`entity-item ${entity === item ? 'selected' : ''}`}
              >
                <span
                  className={item.error ? 'error-dot' : item.skipped ? 'skip-dot' : 'success-dot'}
                  aria-hidden="true"
                >
                  {item.error ? '!' : item.skipped ? '–' : '✓'}
                </span>
                <span>
                  Entity {(item.index ?? position) + 1}
                  <span className="visually-hidden"> {entityStatus(item)}</span>
                  <small>{entityLabel(item)}</small>
                </span>
              </button>
            ))}
          </aside>
          <div className="result-detail">
            <div className="result-tabs" role="tablist" aria-label="Result view" onKeyDown={onTabKeyDown}>
              {TABS.map(([key, label]) => (
                <button
                  key={key}
                  id={`result-tab-${key}`}
                  ref={(element) => {
                    tabRefs.current[key] = element;
                  }}
                  role="tab"
                  aria-selected={selectedTab === key}
                  aria-controls="result-tabpanel"
                  tabIndex={selectedTab === key ? 0 : -1}
                  disabled={disabled(key)}
                  className={selectedTab === key ? 'active' : ''}
                  onClick={() => setTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div id="result-tabpanel" role="tabpanel" aria-labelledby={`result-tab-${selectedTab}`}>
              {entity ? <FailureNotice entity={entity} /> : null}
              {entity?.skipped ? (
                <p className="empty-stage">This entity was skipped by its transformation condition.</p>
              ) : null}
              {selectedTab === 'source' ? (
                <Display value={entity?.sourceOutput} label="No source output is available for this entity." />
              ) : null}
              {selectedTab === 'target' ? (
                <Display value={entity?.targetOutput} label="No target output is available for this entity." />
              ) : null}
              {selectedTab === 'changes' && entity ? (
                <ChangesView entity={entity} stage={stage} onStage={setStage} />
              ) : null}
              {selectedTab === 'trace' ? <TraceView entity={entity} debug={debug} /> : null}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
