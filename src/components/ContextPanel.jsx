import JsonEditor from './JsonEditor';

// `open` / `onToggle` are optional: pass them to let the page open the panel (for example after a quick fix);
// without them the disclosure manages itself.
export default function ContextPanel({ value, payload, onChange, withGuidance, open, onToggle }) {
  return (
    <details className="context-disclosure" open={open} onToggle={onToggle && ((event) => onToggle(event.target.open))}>
      <summary>
        Runtime context
        {withGuidance ? <span>User supplied · optional</span> : null}
      </summary>
      {withGuidance ? (
        <p>
          Provide variables, properties, operation and resolution results required by your transformation. Missing
          context is reported; remote operations are never simulated.
        </p>
      ) : null}
      <JsonEditor title="Runtime context" value={value} onChange={onChange} payload={payload} height="180px" />
    </details>
  );
}
