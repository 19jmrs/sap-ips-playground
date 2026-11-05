const REPOSITORY_URL = 'https://github.com/19jmrs/sap-ips-playground';

export default function Footer({ keepOnReload, storageNote, onKeepOnReload, onOpenInfo }) {
  return (
    <footer>
      <span>
        <span className="privacy-dot" /> Runs in your browser. Use synthetic data.
      </span>
      <label className="keep-toggle">
        <input type="checkbox" checked={keepOnReload} onChange={(event) => onKeepOnReload(event.target.checked)} />
        Keep work across reloads in this tab
      </label>
      <span>
        {keepOnReload
          ? 'Inputs (never results) are saved in this tab’s sessionStorage · removed on Clear or when the tab closes.'
          : 'Session memory only · nothing is saved.'}{' '}
        <button onClick={() => onOpenInfo('privacy')}>Privacy details</button>
      </span>
      {storageNote ? (
        <p className="storage-note" role="status">
          {storageNote}
        </p>
      ) : null}
      <p>
        Independent implementation. SAP IPS equivalence is not certified.{' '}
        <button onClick={() => onOpenInfo('coverage')}>Check compatibility before relying on results.</button>
      </p>
      <p>
        <a href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer">
          Source code, issues and license on GitHub
        </a>
      </p>
    </footer>
  );
}
