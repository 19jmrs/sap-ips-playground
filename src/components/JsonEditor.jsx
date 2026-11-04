import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import CodeMirror from '@uiw/react-codemirror';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { autocompletion } from '@codemirror/autocomplete';
import { linter } from '@codemirror/lint';
import { EditorView, hoverTooltip } from '@codemirror/view';
import { analyze } from '../editor/analyze.js';
import { completionsAt } from '../editor/completions.js';
import { documentKind } from '../editor/context.js';
import { hoverAt } from '../editor/hover.js';
import { useModal } from '../hooks/useModal';

const editorTheme = EditorView.theme({
  '&': { fontSize: '12px', backgroundColor: '#fff', color: '#12223c' },
  '.cm-content': {
    fontFamily: "'Cascadia Code', 'SFMono-Regular', Consolas, monospace",
    padding: '12px 0',
    lineHeight: '1.65',
  },
  '.cm-gutters': { backgroundColor: '#fafbfd', border: 'none', color: '#8d9aae' },
  '.cm-activeLine': { backgroundColor: '#f3f8fa' },
  '.cm-activeLineGutter': { backgroundColor: '#edf4f6' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto' },
});

const noAssist = EditorView.contentAttributes.of({
  spellcheck: 'false',
  autocorrect: 'off',
  'data-gramm': 'false',
  'data-gramm_editor': 'false',
  'data-enable-grammarly': 'false',
});

// A larger copy of one editor, centred over the page. It edits the same value as the panel it came from; the panel
// stays mounted underneath (and inert) so its scroll position and undo history survive.
function ExpandedEditor({
  title,
  expressionMode,
  readOnly,
  value,
  onChange,
  extensions,
  onFormat,
  formatError,
  onClose,
}) {
  const dialogRef = useRef(null);
  useModal(dialogRef, onClose, { isolate: true });
  return createPortal(
    <div className="modal-backdrop">
      <section
        ref={dialogRef}
        className="editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${title} (expanded)`}
      >
        <div className="panel-heading">
          <h3>{title}</h3>
          <span className="language-tag">{expressionMode ? 'EXPR' : 'JSON'}</span>
          <div className="panel-actions">
            {!readOnly && !expressionMode ? (
              <button className="small-button format-button" onClick={onFormat}>
                Format
              </button>
            ) : null}
            <button className="small-button" onClick={onClose} aria-label={`Close expanded ${title}`}>
              ✕ Close
            </button>
          </div>
        </div>
        <div className="editor-dialog-body">
          <CodeMirror
            value={value ?? ''}
            onChange={onChange}
            extensions={extensions}
            height="100%"
            autoFocus
            readOnly={readOnly}
            basicSetup={{ foldGutter: true, highlightActiveLine: !readOnly, autocompletion: false }}
            aria-label={`${title} expanded editor`}
          />
        </div>
        {formatError ? (
          <div className="inline-error" role="alert">
            {formatError}
          </div>
        ) : null}
      </section>
    </div>,
    document.body,
  );
}

export default function JsonEditor({
  title,
  value,
  onChange,
  payload,
  functions = [],
  readOnly = false,
  height = '322px',
  transformation = false,
  expressionMode = false,
}) {
  const [formatError, setFormatError] = useState('');
  const [expanded, setExpanded] = useState(false);
  useEffect(() => setFormatError(''), [value]);
  const kind = documentKind({ title, transformation, expressionMode });
  // Services read the latest payload/functions through a ref so typing in one editor does not reconfigure another.
  const latest = useRef({ payload, functions });
  latest.current = { payload, functions };

  const extensions = useMemo(() => {
    const source = (context) => {
      const text = context.state.doc.toString();
      const found = completionsAt(kind, text, context.pos, { ...latest.current, explicit: context.explicit });
      if (!found) return null;
      return {
        from: found.from,
        to: found.to,
        filter: false,
        options: found.options.map((item) => ({
          label: item.label,
          apply: item.insert,
          type: item.type,
          detail: item.detail,
          info: item.info,
          boost: item.boost,
        })),
      };
    };
    const hover = hoverTooltip((view, pos) => {
      const hit = hoverAt(kind, view.state.doc.toString(), pos, latest.current);
      if (!hit) return null;
      return {
        pos: hit.from,
        end: hit.to,
        create() {
          const dom = document.createElement('div');
          dom.className = 'editor-tooltip';
          dom.style.whiteSpace = 'pre-wrap';
          dom.textContent = hit.text;
          return { dom };
        },
      };
    });
    const lint = linter((view) => {
      const length = view.state.doc.length;
      return analyze(kind, view.state.doc.toString()).map((item) => ({
        from: Math.min(item.from, length),
        to: Math.min(Math.max(item.to, item.from + 1), length),
        severity: item.severity,
        message: item.message,
        source: 'IPS',
      }));
    });
    return [
      ...(kind === 'expression' ? [] : [json(), linter(jsonParseLinter())]),
      lint,
      autocompletion({ override: [source] }),
      hover,
      editorTheme,
      noAssist,
    ];
  }, [kind]);

  function format() {
    try {
      onChange(JSON.stringify(JSON.parse(value), null, 2));
      setFormatError('');
    } catch (error) {
      setFormatError(error.message);
    }
  }

  return (
    <section className="editor-panel" aria-label={title}>
      <div className="panel-heading">
        <h3>{title}</h3>
        <span className="language-tag">{expressionMode ? 'EXPR' : 'JSON'}</span>
        <div className="panel-actions">
          {!readOnly && !expressionMode ? (
            <button className="small-button format-button" onClick={format}>
              Format
            </button>
          ) : null}
          <button
            className="small-button expand-button"
            onClick={() => setExpanded(true)}
            aria-haspopup="dialog"
            aria-label={`Expand ${title}`}
          >
            ⤢ Expand
          </button>
        </div>
      </div>
      <div className="editor-body" style={{ height }}>
        <CodeMirror
          value={value ?? ''}
          onChange={onChange}
          extensions={extensions}
          height="100%"
          readOnly={readOnly}
          basicSetup={{ foldGutter: true, highlightActiveLine: !readOnly, autocompletion: false }}
          aria-label={`${title} editor`}
        />
      </div>
      {formatError ? (
        <div className="inline-error" role="alert">
          {formatError}
        </div>
      ) : null}
      {expanded ? (
        <ExpandedEditor
          title={title}
          expressionMode={expressionMode}
          readOnly={readOnly}
          value={value}
          onChange={onChange}
          extensions={extensions}
          onFormat={format}
          formatError={formatError}
          onClose={() => setExpanded(false)}
        />
      ) : null}
    </section>
  );
}
