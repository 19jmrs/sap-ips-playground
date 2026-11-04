import { useRef } from 'react';
import coverageText from '../../docs/coverage.md?raw';
import inventoryText from '../../docs/ips-inventory.md?raw';
import architectureText from '../../docs/architecture.md?raw';
import { useModal } from '../hooks/useModal';
import Markdown from './Markdown';

const TITLES = {
  coverage: 'Compatibility & coverage',
  privacy: 'Your data stays in this tab',
  docs: 'Using the playground',
};

function ReferenceDocument({ title, text }) {
  return (
    <details className="reference-document">
      <summary>{title}</summary>
      <Markdown text={text} />
    </details>
  );
}

function CoverageContent() {
  return (
    <>
      <p>
        This is an independent local implementation of documented IPS transformation behavior. It is not SAP Simulate
        Job and does not establish runtime parity.
      </p>
      <p>
        Unsupported functions, mapping options and missing runtime context produce explicit errors. JSONPath dialect
        differences and unverified SAP edge cases can affect results.
      </p>
      <p>
        The project documentation includes a source inventory, implementation coverage matrix and reference tests.
        Validate production transformations against your SAP IPS environment.
      </p>
      <ReferenceDocument title="Detailed coverage matrix" text={coverageText} />
      <ReferenceDocument title="Official inventory and references" text={inventoryText} />
      <h3>Editor assistance</h3>
      <p>
        JSON syntax diagnostics, mapping hints, payload property completion, function suggestions, hover and formatting
        run locally in the editor. These are integrated language services, not a Language Server Protocol server.
      </p>
    </>
  );
}

function PrivacyContent({ keepOnReload }) {
  return (
    <>
      <p>
        Payloads, transformations and context are processed in your browser. The app has no processing server,
        analytics, cookies or logging, and nothing you enter is sent anywhere. Exporting creates a local file you
        control; importing reads only a file you choose, locally. Prefer fictional data.
      </p>
      <h3>Reloading the page</h3>
      {keepOnReload ? (
        <p>
          <strong>Keep work across reloads in this tab is on.</strong> The contents of the editors and your selections
          are being saved in this tab’s sessionStorage a moment after each edit.
        </p>
      ) : (
        <p>
          By default nothing is saved: your work lives in page memory and a reload discards it. You can opt in with the
          “Keep work across reloads in this tab” option in the footer.
        </p>
      )}
      <ul>
        <li>
          <strong>What is stored (only when the option is on):</strong> source data, both transformations, runtime
          context, the expression and your mode, entity and example selections. Execution results, errors and exported
          files are never stored.
        </li>
        <li>
          <strong>Where:</strong> this tab’s sessionStorage for this site. It is not encrypted by the app, is not shared
          with other tabs, and can be read by browser extensions and anyone using this browser profile while it exists.
        </li>
        <li>
          <strong>When it is removed:</strong> when you turn the option off, when you use Clear, and normally when the
          tab or window is closed.
        </li>
        <li>
          <strong>Limits:</strong> browsers can restore sessionStorage when you reopen a closed tab or recover a session
          after a crash or restart, and may keep session data on disk. The app cannot prevent that or erase browser or
          operating-system memory. Use Clear before leaving sensitive data.
        </li>
        <li>
          <strong>If storage is unavailable or full:</strong> the app keeps working from memory and shows a note that
          work will not survive a reload.
        </li>
      </ul>
    </>
  );
}

function DocsContent() {
  return (
    <>
      <ol>
        <li>Load an example, import a case file or paste a source JSON payload.</li>
        <li>
          Select source, target or chained execution. For batches, detect or enter a JSONPath that selects entities.
        </li>
        <li>Choose the user, group or role section and enter valid IPS transformation JSON.</li>
        <li>Enable Debug trace if needed, then press Run transformation.</li>
        <li>Inspect each entity, stage output, changes and mapping trace. An entity error does not stop the batch.</li>
      </ol>
      <p>
        Use Expressions to test JSONPath and IPS conditions. Both workspaces execute only on Run; loading an example or
        importing a case never runs anything.
      </p>
      <ReferenceDocument title="Architecture, privacy and LSP investigation" text={architectureText} />
      <p>
        In JSON editors, press Ctrl+Space for property/function suggestions and Tab or Enter to accept the selected one.
        Format prettifies valid JSON without executing it. Drag the corner of an editor to change its height, or press
        Expand to edit it in a larger window (Close or Escape returns).
      </p>
      <p>
        A mapping with <code>targetVariable</code> (for example <code>entityIdSourceSystem</code>) stores its value in a
        context variable, not in the output. Those values appear in the Variables result tab. Variables that IPS would
        supply itself, such as <code>entityIdTargetSystem</code>, must be given under <code>variables</code> in the
        Runtime context; when a run reports one missing, the failure message has a button that adds it for you.
      </p>
    </>
  );
}

export default function InfoDialog({ kind, keepOnReload, onClose }) {
  const dialogRef = useRef(null);
  useModal(dialogRef, onClose);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        ref={dialogRef}
        className="info-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="dialog-close small-button" onClick={onClose} aria-label="Close dialog">
          ✕
        </button>
        <h2 id="dialog-title">{TITLES[kind]}</h2>
        {kind === 'coverage' ? <CoverageContent /> : null}
        {kind === 'privacy' ? <PrivacyContent keepOnReload={keepOnReload} /> : null}
        {kind === 'docs' ? <DocsContent /> : null}
      </section>
    </div>
  );
}
