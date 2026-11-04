# Tasks — run 20261103-review

Max three active specialists at a time (AGENTS.md default). Pre-run snapshot: `%TEMP%/ips-snapshot-20261103` (project is not a git repository).
Phase 0 (coordinator, done): snapshot, Prettier added and applied, shared key lists exported from `src/engine/catalog.js`; 28 tests + build verified.

| ID | Agent | Owns | State |
|---|---|---|---|
| W1-ENGINE-SPLIT | EngineSplit | `src/engine/**` except catalog.js | accepted (30 tests) |
| W1-APP | AppShell | App, components, state, hooks, execution, styles | accepted; browser-smoke verified 2026-11-04 |
| W1-EDITOR | EditorIntel | JsonEditor, `src/editor/**`, catalog.js | accepted; lint/hover browser-verified |
| W2-PATHS-CONDITIONS | PathsConditions | jsonpath, conditions, util | accepted (67 tests) |
| W2-FUNCTIONS | FunctionsSemantics | `functions/**`, dates | accepted (68 tests) |
| W2-PIPELINE | PipelineIntegrity | transform, mapping-types, target-path, pipeline, environment | accepted; jsonpath-plus removed by coordinator |
| W3-EDITOR-ENGINE-ALIGN | EditorEngineAlign | editor + additive engine exports | FAILED: HTTP 429 account rate limit (retry-after about 3.8 h); nothing landed; to retry |
| W3-ENGINE-REVIEW | EngineReview | read-only review | FAILED: same 429; no report written; to retry |

Coordinator integration: removed `unsafePathPattern` and `jsonpath-plus`; `clone` primitive fast path; coverage.md, architecture.md, README.md, handover.md updated. Final state: 225 tests, build green, Prettier clean, browser smoke test passed. Agent reports were delivered in the conversation only; no `reports/` files were written.
