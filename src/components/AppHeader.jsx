export default function AppHeader({ onOpenInfo }) {
  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          {'{ }'}
        </span>
        <h1>SAP IPS Transformation Playground</h1>
      </div>
      <nav aria-label="Help">
        <button onClick={() => onOpenInfo('coverage')}>Coverage</button>
        <button onClick={() => onOpenInfo('docs')}>Documentation</button>
      </nav>
    </header>
  );
}
