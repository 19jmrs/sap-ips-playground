const WORKSPACES = [
  ['transformations', 'Transformations'],
  ['expressions', 'Expressions'],
];

export default function WorkspaceTabs({ workspace, onChange }) {
  return (
    <nav className="workspace-tabs" aria-label="Workspaces">
      {WORKSPACES.map(([id, label]) => (
        <button
          key={id}
          aria-current={workspace === id ? 'page' : undefined}
          className={workspace === id ? 'active' : ''}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
