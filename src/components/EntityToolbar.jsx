import { useRef } from 'react';
import { contextOperations, entityTypes } from '../engine/catalog.js';

const LABELS = { user: 'User', group: 'Group', role: 'Role' };

export default function EntityToolbar({
  entityType,
  entityPath,
  operation,
  debug,
  running,
  onEntityType,
  onEntityPath,
  onOperation,
  onDetect,
  onDebug,
  onImport,
  onExport,
  onClear,
}) {
  const fileInput = useRef(null);
  function chooseFile(event) {
    const [file] = event.target.files;
    event.target.value = '';
    if (file) onImport(file);
  }
  return (
    <div className="entity-toolbar">
      <label>
        Entity type
        <select value={entityType} onChange={(event) => onEntityType(event.target.value)}>
          {entityTypes.map((type) => (
            <option key={type} value={type}>
              {LABELS[type] ?? type}
            </option>
          ))}
        </select>
      </label>
      <label title="Which scope your mappings run for. Stored as operation in the Runtime context.">
        Operation
        <select
          value={operation ?? ''}
          disabled={operation === null}
          onChange={(event) => onOperation(event.target.value)}
        >
          <option value="">Not set</option>
          {contextOperations.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="entity-path">
        Entity path
        <input value={entityPath} onChange={(event) => onEntityPath(event.target.value)} spellCheck="false" />
      </label>
      <button className="small-button" onClick={onDetect}>
        Detect
      </button>
      <label className="checkbox-label">
        <input type="checkbox" checked={debug} onChange={(event) => onDebug(event.target.checked)} />
        Debug trace
      </label>
      <div className="toolbar-spacer" />
      <input
        ref={fileInput}
        className="visually-hidden"
        type="file"
        accept=".json,application/json"
        aria-label="Case file to import"
        tabIndex={-1}
        onChange={chooseFile}
      />
      <button className="text-button" onClick={() => fileInput.current.click()}>
        Import case
      </button>
      <button className="text-button" onClick={onExport}>
        Export case
      </button>
      <button className="text-button" disabled={running} onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
