import { examples } from '../examples';

const MODES = [
  ['source', 'Source only'],
  ['chain', 'Source → Target'],
  ['target', 'Target only'],
];

export default function RunToolbar({ example, mode, running, onExample, onMode, onRun }) {
  return (
    <div className="run-toolbar">
      <label className="example-control">
        Example
        <select value={example} onChange={(event) => onExample(event.target.value)}>
          <option value="" disabled>
            Custom case
          </option>
          {examples.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <div className="mode-control" role="group" aria-labelledby="mode-label">
        <span id="mode-label">Mode</span>
        <div className="segmented">
          {MODES.map(([id, label]) => (
            <button
              key={id}
              aria-pressed={mode === id}
              className={mode === id ? 'selected' : ''}
              onClick={() => onMode(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <button className="primary-button run-button" disabled={running} onClick={onRun}>
        <span aria-hidden="true">▶</span> {running ? 'Running…' : 'Run transformation'}
      </button>
    </div>
  );
}
