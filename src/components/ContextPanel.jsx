import JsonEditor from './JsonEditor';

export default function ContextPanel({ value, payload, onChange, withGuidance }) {
  return (
    <details className="context-disclosure">
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
