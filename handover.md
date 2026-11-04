# SAP IPS Transformation Playground — Handover

Updated: 2026-11-03. Project: `E:/Projects/sap-ips-playground`.

## 1. Initial request and agreed scope

Build a functional website where SAP Identity Provisioning Service (IPS) consultants can paste source JSON, source read transformations and target write transformations, execute them, and inspect the results. The deliverable was explicitly a working application with tests, not just a design or plan.

The intended audience includes experienced and occasional IPS consultants. The product is intended to be public, anonymous and English-facing. Project documentation is in English; the original development discussion was in Portuguese, and subsequent conversation should follow the user's language.

The agreed transformation flow is:

```text
Source-specific JSON -> source read transformation -> common JSON
                    -> target write transformation -> target-specific JSON
```

The original ambition is support for the entire IPS transformation language, including mappings, functions, conditions and applicable context. **That ambition has not been proven complete by this implementation.** A documented local evaluator and a working end-to-end application were delivered, with explicit compatibility boundaries.

Important confirmed requirements:

- Source only, Target only and Source -> Target execution.
- Individual entities and batches; editable entity selection, per-entity results/errors and continuation after individual failures.
- Manual Run in both transformation and expression workspaces. Automatic expression evaluation was proposed during discovery and explicitly rejected by the user.
- A second workspace for JSONPath extraction and IPS condition evaluation.
- Optional inspection of a completed execution, mapping by mapping. Interactive stepping and breakpoints were not selected.
- JSON formatting and readable code; advanced diagnostics and completion after the functional core. Explicitly include investigation of LSP, payload-based JSONPath suggestions after a dot, function/condition/context suggestions and hover.
- Caller-supplied external context, with missing-context diagnostics. No fabricated values, remote API calls or provisioning-cycle simulation.
- No server persistence or logging of payloads/transformations. Recommend fictitious data. Any browser recovery must remain limited to the browser session; cookies were only a suggestion, not a requirement.
- Local import/export permitted at low priority.
- The user can obtain real IPS reference results and supply official documentation; do not request credentials.

The user deferred defining a business success metric. The immediate operational objective was a working, testable application with pasted input and transformations.

**Authorization:** the later instruction to start development superseded the old discovery documents' “awaiting confirmation” headers. Do not reopen the product interview or treat those old headers as an outstanding implementation gate. Local development was authorized; external deployment and paid services were not.

## 2. Current delivery status

The local application is implemented. Two verification points exist. 2026-11-02 (original implementation): 28 tests, production build, Edge QA. 2026-11-04 (review run `runs/20261103-review/`): the engine, editor and UI were restructured and hardened by specialist agents; **225 tests pass**, the production build succeeds, Prettier is clean, and a managed-Chromium smoke test exercised run, stage-diff, opt-in session recovery and Clear, import (valid and invalid), the rendered docs dialog (focus/inert/Escape), editor diagnostics/hover and the expression workspace with no application console errors. Not yet done from the review run: wave 3 (see section 8). See `runs/20261103-review/analysis.md` for the independent analysis.

The user said they would test the application the following day. No user test findings or acceptance results have been provided in this chat as of this handover.

The application has not been published. Development and preview servers were stopped at the end of the implementation run. No branch or worktree was created for that run. Do not assume a server is still running.

### Status definitions

- **Implemented:** available locally, with the verification evidence described below; this does not imply SAP runtime equivalence.
- **Partial / bounded:** useful behavior exists, but a requested capability or its compatibility evidence is incomplete.
- **Pending:** not delivered yet.
- **Excluded:** outside the agreed transformation-only scope or explicitly not selected.

## 3. Requested features, approach and remaining work

| Requested feature | Status | Approach taken / current behavior | Pending work or limitation |
| --- | --- | --- | --- |
| Functional website | Implemented locally | React/Vite application with actual transformation execution and result inspection. | Public hosting remains pending and requires authorization. |
| Public anonymous access | Partial | No login or account system; static build is suitable for hosting. | No publicly reachable deployment exists. |
| English interface | Implemented | Controls, guidance, errors and examples are English-facing. | No additional localization requested. |
| Paste JSON source data | Implemented | CodeMirror editor, JSON parsing, formatting and syntax diagnostics. | Very large documents can still affect editor responsiveness before execution limits apply. |
| Paste source read transformation | Implemented | Editable IPS JSON document; selected entity section evaluated by the local interpreter. | Entire-language compatibility remains bounded below. |
| Paste target write transformation | Implemented | Separate editable document and target execution stage. | Same compatibility boundary as source execution. |
| Source only / Target only / Source -> Target | Implemented | Explicit mode selection; source output becomes target input in chained execution. | Live IPS comparison fixtures still needed. |
| Inspect source and target results | Implemented | After source / After target tabs retain available stage outputs per entity. | Failed stages may have no output; successful preceding stages remain inspectable. |
| Inspect changes | Implemented | Changes tab compares entity input with the final output, with a selector for Input→Source, Source→Target and Input→Final when both stage outputs exist. | Arrays are compared as values rather than fine-grained member edits. |
| Single entities and batches | Implemented | Selected JSONPath yields one entity or an array; entities execute independently. | An unusual envelope must be selected manually. |
| Detect common input structures | Implemented | Root arrays and common envelopes such as Resources/resources/users/groups/value/results/entities and d.results. | Detection is heuristic, not universal. |
| Correct entity path | Implemented | Editable Entity path field and Detect action. | Path semantics follow the bounded local JSONPath implementation. |
| Select user/group/role transformation section | Implemented | User/Group/Role selector in UI (browser-verified 2026-11-04). | Section selection only; no provisioning behavior. |
| Per-entity result/error, continue after failures | Implemented | Success/failure/skipped summary and entity rail; one failed entity does not abort later entities. | Input-selection/JSON parsing errors can prevent the overall run before entity processing. |
| Manual Run in both workspaces | Implemented | Only Run transformation / Run expression triggers execution. Editing and example selection do not execute. | Parsing, diagnostics and completion may run during editing, as editor assistance. Preserve this distinction. |
| JSONPath value extraction | Partial / bounded | Expression workspace and an own Jayway-dialect JSONPath evaluator (JSONPath Plus removed); filters use the local condition parser. | Exact SAP Jayway version/options and complete dialect equivalence unverified. See coverage.md for the open reference cases. |
| IPS boolean conditions | Partial / bounded | Per-token tokenizer/parser with `${}`/`%x%` resolution, short circuiting, deep equality, typed ordering, collection operators, regex and five inventoried conditional functions. | Full SAP grammar, `=~` whole-match versus substring, `EMPTY`/`SIZE` on missing values and email validation are unverified reference cases. |
| Clear expression results/errors | Implemented | Explicit returned values, boolean results, missing-value guidance and errors; stale results indicated after edits. | Broader live reference cases needed for semantic correctness. |
| Entire IPS transformation language | Partial / bounded | Public documentation inventoried; all four documented mapping types and routes for all 27 discovered mapping-function names exist. | This is not proof of complete language support. See compatibility gaps below and the detailed coverage matrix. |
| External runtime context | Implemented with bounds | Runtime context JSON supplies variables, properties, operation, resolution tables and locale mappings; missing required values error. | No automatic IPS state discovery. Some functions require authoritative caller-supplied reference data. |
| Context isolation | Implemented | Each entity and stage receives a fresh context copy; source-created variables do not leak into target-system variables. | Validate difficult tenant-specific scoping cases against IPS. |
| Completed-run debug inspection | Implemented | Optional trace records mapping reads, mapping conditions, function configuration, before/after values, per-member function conditions, writes and errors. | Trace inspects a finished run; it is not an interactive debugger. |
| Breakpoints / interactive stepping | Excluded | Not part of selected debug option A. | Only reconsider if explicitly requested. |
| JSON formatting and readable code | Implemented | Syntax highlighting, folding, line numbers and Format for JSON documents. | Format requires valid JSON. Expressions are not formatted as JSON. |
| JSON diagnostics | Implemented | CodeMirror JSON syntax diagnostics and formatter/run parse errors. | Not a full domain-schema validator. |
| Advanced IPS validation | Implemented with bounds | Position-aware diagnostics for structure, per-function required parameters and enums, regex, date patterns, conditions, JSONPath and target paths (browser-verified: a missing `replacement` is flagged at the function name with a message). | `src/editor/syntax.js` still re-implements some engine parsers and can drift from the engine; schema coverage is the app's, not SAP's. |
| Payload-aware JSONPath completion after a dot | Implemented with bounds | Ctrl+Space/autocomplete offers paths from the current payload in JSON and expression editors. | Samples array members, limits traversal to seven levels, recognizes common batch envelopes; not a complete inferred schema for heterogeneous/custom batches. |
| Function/condition/context suggestions | Implemented with bounds | Context-aware: only absent mapping keys, function-specific parameters, enum values, context keys, payload paths (20 sampled members, depth 8, envelopes). | Suggestions do not certify valid combinations or complete runtime semantics. |
| Hover help | Implemented with bounds | Keys, functions, parameters (type/required/allowed values), operators, context keys and payload path previews. | No hover for filters, recursive descent or slices. |
| LSP investigation | Completed; actual server not implemented | Chose editor-integrated CodeMirror services; tradeoff documented in architecture.md. | A real reusable LSP server would need a separate decision and implementation if external editor clients are required. |
| No server payload persistence/logging | Implemented by architecture | Processing stays in browser; there is no application processing API, analytics or payload logging. | Reassess logging/privacy if a server backend or hosting integration is introduced. |
| Recommend fictional data | Implemented | UI notice and synthetic examples. | Browser extensions and OS/browser behavior remain outside the application's guarantees. |
| Browser session recovery | Implemented, opt-in | Footer option "Keep work across reloads in this tab", default off; stores inputs/selections only (never results) in `sessionStorage`, 500 ms debounce; Clear removes it and turns it off; falls back to memory with a note. Browser-verified reload restore and Clear. | Default-off is the implementer's privacy-first decision, not a recorded user choice: confirm with the user. Browsers may restore sessionStorage after a crash or tab restore. |
| Clear current workspace | Implemented | Clears input documents, context, expressions and results; disabled during an active run. | Cannot guarantee forensic erasure from browser/OS memory. |
| Local export | Implemented | Export case downloads JSON containing input, transformations, mode, selection, context and debug setting. | User controls the resulting local file. |
| Local import | Implemented | Import case validates `schemaVersion` (absent = v1), unknown/missing/mistyped fields and size; loads without running; results marked stale. Browser-verified valid and invalid files. | None known. |
| Synthetic reference examples | Implemented | Six examples: chain, source-only, target-only, partial batch error, conditional mapping and groups. | Add cases from real IPS outputs as supplied. |
| Execution responsiveness | Implemented with limits | Disposable Web Worker; 5 MB serialized UTF-8 input limit and 5-second timeout. | Main-thread parsing/editor services occur before worker execution; limits are not a universal resource-safety guarantee. |
| External calls / provisioning lifecycle | Excluded | No tenant calls, writes, provisioning jobs, group assignments or fabricated remote resolution. | Keep transformation evaluation separate from remote effects. |

## 4. Compatibility: what exists and what remains unproven

See [the full coverage matrix](docs/coverage.md) and [official language inventory](docs/ips-inventory.md). Do not replace their per-feature boundaries with a blanket “IPS compatible” statement.

### Implemented local language routes

- Ordered mappings; set/remove/rename/valueMapping; constants; optional/default values; ignores and conditions; singleton-array controls; variables/property interpolation; function chains and collection/attribute modifiers.
- Definite target paths, supported wildcard writes/removals, root copy and the supported attribute-construction projection form `[?(@.attribute)]`.
- All 27 mapping-function names discovered in the researched public documentation have routes. Tests exercise those names, but not every argument/input/runtime edge case.
- Five conditional functions, seven specially documented variables and custom variables are inventoried. Variables that originate in IPS state are caller-supplied here.
- Scope selection uses explicit context.operation; it does not perform create/patch/delete requests.

### Highest-priority compatibility gaps

| Area | Current approach | What is still needed |
| --- | --- | --- |
| JSONPath | JSONPath Plus with eval:false for structural paths and a custom filter/condition parser. | Establish SAP's exact Jayway version/configuration where possible; compare missing/null, array shape, filters, operators and path functions with actual IPS output. A JavaScript library is not evidence of Jayway equivalence. |
| Regex / condition semantics | JavaScript regex with explicit rejection of some unsupported Java constructs; local type/comparison rules. | Java regex/replacement, whole-match versus substring, email validation, null/empty and coercion conformance. Some current behavior is explicitly bounded rather than rejected in every divergent case. |
| Date manipulation | Explicit Java-pattern subset and UTC arithmetic; month/year changes clamp the day. | Additional Java tokens, default timezone/leniency, DST and tenant-reference cases. Supported tokens are documented in T2. |
| Country/region conversion | Third-party ISO country and subdivision datasets. | Confirm SAP dataset versions, aliases, unknown-value handling and exact conversion behavior. |
| Locale conversion | Requires context.localeMappings with ordered ISO639/BCP47 pairs. | Obtain authoritative SAP language master data; no built-in complete SAP locale table is claimed. |
| Timezone conversion | Bundled ordered 459-pair table extracted from the official PDF. | Tenant comparison, ordering/version validation and edge-case checks. |
| Identity resolution | Explicit context.resolutions lookups. | Compare selector/input-shape semantics against real cases; remote lookup remains excluded. |
| Unsupported mapping constructs | Unsupported keys, unimplemented target predicates and some combinations error explicitly. | Extend only with documented semantics and tests. Functions on non-set mapping types currently error. |
| Lifecycle metadata | correlationAttribute accepted as metadata; skipOperations rejected as outside local lifecycle execution. | Decide explicitly if any additional metadata-only interpretation is required; do not simulate jobs or remote effects. |

No live SAP differential conformance suite was run. Documentation-derived expected results and local unit tests are useful evidence of local behavior, not SAP-run evidence. Full language parity remains an open objective.

## 5. Technical approach and key files

| File / directory | Responsibility |
| --- | --- |
| src/App.jsx, src/components/*.jsx (except JsonEditor/Results) | Composition and focused UI components: toolbars, workspaces, context panel, footer, info dialogs, Markdown renderer. |
| src/state/*.js, src/hooks/*.js | Pure, tested workspace reducer, case import/export schema (`schemaVersion` 1), sessionStorage recovery, request tracking, result helpers, markdown parser; React hooks around them. |
| src/components/JsonEditor.jsx | Thin CodeMirror adapter: lint, completion, hover, formatting. |
| src/editor/*.js | DOM-free editor intelligence: position-aware parser, diagnostics, completion, hover, payload path index, vocabulary. |
| src/components/Results.jsx | Entity selection, stage outputs, changes with stage-diff selector, trace. |
| src/examples.js | Synthetic examples; no stored user data. |
| src/execution.js, src/execution.worker.js | Worker-per-run wrapper (injectable for tests), 5 MB bound, 5 s timeout; worker runs requests off the UI thread. |
| src/engine/ | Module map in docs/architecture.md: public barrel `index.js`, pipeline/transform/mapping-types, own JSONPath evaluator, conditions, target-path, structured errors, `functions/` registry, `dates.js`, `catalog.js`, `timezones.json`. |
| src/styles.css | Responsive technical-workspace styling. |
| tests/*.test.js | engine, examples, engine-structure, jsonpath, conditions, functions, pipeline, editor, app (pure UI logic), execution. |
| package.json / package-lock.json / vite.config.js | Commands, pinned dependency resolution and static build/chunk configuration. |
| dist/ | Generated static production build; regenerate after source changes. |

Dependencies include React, Vite, CodeMirror, i18n-iso-countries and country-region-data (JSONPath Plus was removed). Prettier is a dev dependency (`.prettierrc`, 120 columns). No credentials, database or environment variables are required.

### Why integrated services rather than an LSP server

The current product has one browser editor client and in-memory documents. Editor-local services keep assistance immediate and avoid introducing document synchronization, a protocol transport and a server lifecycle. A true LSP becomes more useful if the same tooling must serve VS Code or multiple clients, or a different runtime supplies reusable canonical diagnostics. LSP would not itself establish execution parity.

This was an implementation approach, not a separate explicit user selection. [Architecture](docs/architecture.md) preserves the investigation and tradeoff. Do not call the existing implementation an LSP server.

## 6. Running and checking the application

Requires Node.js compatible with Vite: 20.19+ or 22.12+; the implementation environment used Node 24.14.0.

```powershell
cd E:/Projects/sap-ips-playground
npm ci
npm run dev
```

Open the URL printed by Vite, normally http://127.0.0.1:5173. For checks and the production preview:

```powershell
npm test
npm run build
npm run preview
```

The default preview URL is normally http://127.0.0.1:4173. These are local commands, not evidence that a server is currently running. No external publication is authorized by this handover.

## 7. Verification evidence

Last recorded verification: 2026-11-04 (original implementation verification: 2026-11-02).

- 2026-11-04: 225 tests pass (`npm test`); `npm run build` passes; `npx prettier --check` clean; managed-Chromium smoke test as described in section 2. Earlier 2026-11-02: 28 tests plus Edge QA.
- Production build passed without warnings after chunk separation.
- Connected Edge browser QA covered pasted custom input/transformation; all three execution modes; stage outputs, changes and trace; continued processing after a middle-entity failure; JSONPath values; boolean conditions and expression errors; formatting/JSON errors; completion after `$.`; help dialogs; and worker timeout.
- Responsive checks used DOM viewports 1536x1024 and 390x844, with no horizontal page overflow found. Full-page imagery supplemented clipped native viewport screenshots.
- No application console errors were recorded. Browser-extension warnings were distinguished from application errors.
- Final source inspection found no application storage APIs, fetch calls or console logging in src.

Detailed evidence: [T4 integration/QA report](runs/20261102-implementation/reports/T4-r1.md). Supporting specialist reports: [T1 inventory](runs/20261102-implementation/reports/T1-r1.md), [T2 engine](runs/20261102-implementation/reports/T2-r1.md), [T3 UI](runs/20261102-implementation/reports/T3-r1.md). Specialist reports reflect their earlier completion points; T4 records the integrated final check.

Not verified: live SAP output equivalence, other browser engines, a comprehensive assistive-technology audit, public hosting behavior or a complete advanced IPS validator. Browser QA was performed interactively through tooling; the repo does not contain a persisted automated browser test suite.

## 8. Pending work and recommended continuation

1. **Retry wave 3 (blocked by an account rate limit on 2026-11-04, retry-after about 3.8 h).** Two agents died with 429 before landing anything (tree verified unchanged, 225 tests green). (a) `EditorEngineAlign`: replace the editor's mirrored condition/JSONPath/regex/date/target-path checkers in `src/editor/syntax.js` with additive parse-only exports from the dataset-free engine modules, plus a table-driven engine-vs-editor parity test (`tests/editor-engine-parity.test.js`); verify via a temp-dir build that datasets stay in the worker chunk. (b) `EngineReview`: read-only adversarial review of the engine rewrites, with a differential run of the pre-run snapshot (`%TEMP%/ips-snapshot-20261103`, may be gone) against the new engine on all fixtures; look for regressions, catastrophic regex backtracking, prototype-pollution bypasses, raw JS exceptions reaching `entity.error`, and false comments. The project is not a git repository: ask the user before `git init`, and do so before further concurrent edits.
2. **Collect the user's test findings.** No findings received. Preserve reproducible fictional/anonymized cases rather than asking for credentials.
3. **Build differential fixtures for compatibility.** Capture exact input, transformation, context, entity selection, actual SAP output/error and environment/date. Open reference cases are listed in docs/coverage.md (notably `=~` whole-match vs substring, `EMPTY`/`SIZE` on missing values, `$.a == $.b` with both missing, `matchRegex` find vs matches, locale/timezone fallbacks, date offsets). See [context and fixture guidance](docs/context.md).
4. **Close demonstrated semantic gaps** only against documentation or reference outputs; keep coverage.md partial/bounded until evidence exists.
5. **Confirm the session-recovery default with the user.** Implemented opt-in, default off, Clear also turns it off; this was an implementer decision, not a user selection.
6. **Browser coverage still missing:** other browser engines, mobile layout of the new footer/banner/Compare controls, a persisted automated browser test suite, a real assistive-technology audit.
7. **Prepare external publishing only when requested.** Hosting configuration (CSP/security headers), public deployment and hosted privacy checks are pending; no paid service or external action was authorized.

A business success metric remains deferred by the user. No formal user acceptance is recorded. These are separate from the completed operational local-app objective.

## 9. Source-of-truth documents and continuation constraints

- Original consolidated brief: `E:/Projects/runs/20261102-sap-playground-grilling/product-brief.md`.
- Explicit user answers: that run's `decisions/round-01.md` through `round-05.md`. Their answers and subsequent development authorization override obsolete pending-confirmation labels.
- [Implementation summary](runs/20261102-implementation/summary.md) and [task ledger](runs/20261102-implementation/tasks.md).
- [Official inventory](docs/ips-inventory.md), [coverage](docs/coverage.md), [architecture](docs/architecture.md), [context](docs/context.md), [UI design](docs/ui-design.md) and [README](README.md).
- Key official research starting points: [SAP transformations](https://help.sap.com/docs/cloud-identity-services/cloud-identity-services/transformations), [transformation expressions](https://help.sap.com/docs/identity-provisioning/identity-provisioning/transformation-expressions), [transformation functions](https://help.sap.com/docs/identity-provisioning/identity-provisioning/transformation-functions), and [official provisioning PDF](https://help.sap.com/doc/c30747989e33466e8e4f789dd9c3c81c/Cloud/en-US/Provisioning_Service.pdf). The inventory records source-access limitations, document variants and example/page references.

Use the applicable AGENTS.md instructions for substantive follow-on work: Maestro coordination, bounded specialist ownership, at most three active specialists, no nested delegation, and run records inside this project's runs directory. Routine documentation edits can be handled directly. Existing specialist sessions are historical completion records, not proof of active jobs or background services. Do not change unrelated projects under E:/Projects or create branches/worktrees without corresponding instruction.
