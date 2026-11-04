# Playground interface design

T3 / revision 1. Complete primary workspace concept generated with built-in ImageGen, saved as `docs/concept.png`. This is a technical workspace rather than a marketing page. The coordinator inspected the concept before final browser QA.

## Design specification

- Cool off-white canvas `#f5f7fa`, white editor surfaces, navy text `#11213c`, teal actions `#00796a` (darkened from `#008775` to reach 4.5:1 text contrast), fine blue-gray borders `#d3ddeb`.
- System sans typography (Segoe UI on Windows), monospace code (Cascadia Code / Consolas), compact toolbars, 6–7px panel corners and restrained shadows.
- Header, two workspace tabs, workspace heading, example/mode/run toolbar, entity/debug toolbar (entity type user/group/role, import/export/clear), three equal editor columns, context disclosure, stage results and a footer with the privacy note and the session-recovery toggle.
- Results use an entity rail and stage/changes/trace tabs (keyboard arrows, Home/End; roving tabindex). The Changes tab adds a stage selector (Input → Source output, Source → Target output, Input → Final) when both stage outputs exist. A failed entity shows the stage and mapping that failed. Empty results explain the explicit Run trigger. Mobile stacks editors and moves the entity rail above results without horizontal page overflow.
- Actual code uses the documented IPS `sourcePath` / `targetPath` properties and `user` / `group` section wrappers. The concept's invented JSON content is not a semantics reference.

## Actual behavior

No example selection, case import, edit, format action or tab switch executes a transformation. Execution is explicit via Run and uses the coordinator-owned disposable worker API (`src/execution.js`, 5 MB input bound, 5 s timeout, one worker per run). Inputs can be edited while a run is pending; revision tracking marks the returned result stale, and a result keeps the mode/debug setting it was started with. Clear is disabled during a pending run.

### Structure and state

`App.jsx` only composes components. Workspace state lives in a reducer (`src/state/workspace.js`); pure modules under `src/state/` (case file schema, session snapshot, request building, result helpers, markdown parser) have no DOM dependency and are covered by `tests/app.test.js`. `src/hooks/` holds the React wiring (`useWorkspace`, `useSessionRecovery`).

### Case files

Export writes `schemaVersion: 1` plus `data, source, target, mode, entityPath, entityType, context, debug`. Import validates the file against that schema (unknown, missing or mistyped fields are reported and nothing is loaded; files without `schemaVersion` are accepted as version 1), loads it without running it, and marks results stale.

### Session recovery

Off by default. The footer option “Keep work across reloads in this tab” stores the editor inputs (never results or errors) in `sessionStorage`, debounced; turning it off or using Clear removes the stored copy. If storage is unavailable or full the app stays memory-only and shows a note. No `localStorage`, IndexedDB or cookies are used. The Privacy dialog describes what is stored, where, when it is removed, and that browsers may restore `sessionStorage` after a crash or tab restore.

### Documentation dialogs

The coverage, inventory and architecture markdown files are rendered by a small built-in renderer (headings, lists, code, tables, bold/italic/code spans, http(s) links only); raw HTML is never interpreted.

CodeMirror provides JSON syntax diagnostics and highlighting, basic IPS mapping hints, completion for payload paths (including entity paths within common envelopes), documented function names, condition vocabulary and context keys, property hover help, and formatting. These are editor-integrated language services; no LSP server is implemented. Runtime evaluation remains authoritative for unsupported features and missing context.

The full interface concept was created with this prompt brief: complete 1536×1024 SAP IPS technical workspace; cool gray / navy / teal; compact three editor columns; example and source/target/chain mode controls; explicit Run; entity selector and debug trace; context disclosure; lower per-entity stage results; browser-only privacy and compatibility disclosure. The original ImageGen file is retained in the Codex generated image directory.

## Verification boundary

Production build passed after worker integration. Coordinator performs browser end-to-end QA and final concept/screenshot visual comparison. Do not interpret this design record as a claim of exact SAP runtime equivalence or of pixel-perfect comparison before that QA completes.
