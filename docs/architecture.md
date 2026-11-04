# Architecture and language tooling

## Runtime boundary
React + Vite produces a static application. The transformation engine executes entirely in the browser; there is no application API, tenant connection, authentication, analytics, remote provisioning, or payload logging. The development HTTP server serves application assets. Dependencies are bundled, not fetched from a CDN at runtime.

Input documents and results live in React state. By default nothing is written to browser storage. The footer option "Keep work across reloads in this tab" (default off) stores editor inputs and selections, never results, in `sessionStorage` for the current tab only, debounced, and removed by Clear workspace or by turning the option off. No localStorage, IndexedDB, cookies or service worker is used. Closing a tab ordinarily releases `sessionStorage`, but browsers can restore it after a crash or tab restore, suspend pages, use back/forward caches or retain process memory. A website cannot guarantee forensic deletion from a user's browser; use synthetic data. If storage is unavailable the app falls back to memory only and says so.

## Execution boundary
Run is the sole execution trigger in both workspaces. JSON parsing, syntax diagnostics, formatting and completion can run while editing; they do not execute transformations or conditions. Entity selection supports an editable JSONPath. Each entity runs independently, with source intermediate output retained before target evaluation. Mapping inspection describes an already completed run and has no breakpoints or remote side effects.

The local engine is an independently implemented interpreter. SAP IPS's exact runtime JSONPath version/configuration and every tenant-dependent behavior have not been established. Official examples and local tests are evidence of specific behavior only. Consult the inventory and coverage matrix before relying on a transformation. Unsupported language features must be surfaced as errors rather than silently ignored.

## Editor services and LSP investigation
The editors use CodeMirror with JSON syntax support and integrated language services. Payload-aware JSONPath suggestions, IPS property/function/context completion, JSON diagnostics, hover help and formatting belong naturally beside the current in-memory documents.

A true Language Server Protocol architecture would introduce a separate language server, a protocol transport, document synchronization, versioning, completion/diagnostic requests and server lifecycle management. It becomes valuable if the same tooling must serve VS Code or multiple editor clients, or if a JVM engine supplies canonical diagnostics. It would not itself increase IPS execution compatibility.

For this single-browser app, integrated editor services avoid sending confidential documents elsewhere and keep completions immediate. No LSP server is claimed. A reusable actual LSP server remains a future material architecture choice if external editor integration is requested; it is not required for the functional transformation workflow.

## Verification strategy
Engine tests cover official-reference semantics, mapping errors, entity isolation and safety boundaries. Browser QA checks manual execution, stage outputs, expressions, examples and responsive layout. Live IPS differential fixtures are required to establish parity beyond documented reference behavior; no credentials are requested.

## Execution limits and editor implementation
Runs use a disposable dedicated Web Worker. Each run is limited to 5 MB of serialized UTF-8 input and a 5-second wall-clock timeout; the worker is terminated on completion, error or timeout. This keeps expensive user expressions off the UI thread. JSON parsing and editor services still occur in the page, so huge pasted documents can be costly before Run.

The editor performs position-aware diagnostics (`src/editor/analyze.js`) for structure, function parameters, enumerated values, regular expressions, date patterns, conditions, JSONPath and target paths; context-aware completion; and hover with payload value previews. Path completion samples up to 20 array members to depth 8 and handles common batch envelopes. These checks are assistance rather than a complete IPS validator: `src/editor/syntax.js` still re-implements some engine parsers, so editor and engine can disagree until they are unified. Runtime errors and the compatibility matrix remain authoritative.

## Engine modules (`src/engine/`)
`index.js` is the public barrel (`runPipeline`, `evaluateExpression`, `readPath`, `supportedFunctions`, `detectEntityPath`). `pipeline.js` runs entities and stages; `transform.js` and `mapping-types.js` interpret mappings; `target-path.js` writes target paths; `jsonpath.js` and `path-methods.js` are an own Jayway-dialect JSONPath evaluator (JSONPath Plus is no longer used); `condition-tokenizer.js`, `conditions.js` and `condition-functions.js` implement IPS conditions; `environment.js`, `path-text.js` and `errors.js` handle context, interpolation and structured errors (`entity.errorDetail`); `functions/` holds one module per function family behind a registry whose keys equal the catalog; `dates.js` implements the supported `DateTimeFormatter`-style subset. `catalog.js` is dataset-free metadata shared with the editor.
