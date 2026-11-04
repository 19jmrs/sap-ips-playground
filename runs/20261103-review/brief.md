# Run 20261103-review — shared brief

Project: `E:/Projects/sap-ips-playground` (React/Vite SPA + browser-only JS evaluator of SAP IPS transformations).
Read `handover.md`, `docs/coverage.md`, `docs/architecture.md` first. Reports go in `runs/20261103-review/reports/<TASK>-r1.md`.

## Non-negotiable product constraints (from handover §1)

- Nothing executes automatically: only the Run buttons execute. Editing/loading examples never executes.
- No server, no analytics, no network calls, no `console.*` logging of payloads. No cookies. Persistence only where the task explicitly allows it (session-only, disclosed).
- Never fabricate values (no remote lookups, no invented IDs/dates). Unsupported syntax must error explicitly rather than approximate.
- No claim of SAP equivalence. Behaviour that is not evidenced by official docs stays "bounded" in docs. Do NOT edit `docs/coverage.md` or `docs/ips-inventory.md`: list the rows you would change (feature, old status -> new status, reason) in your report; the coordinator integrates them.
- Clean cutover: when you move/rename something, update every caller and remove the old path. No shims, no dead code.
- Style: Prettier is configured (`.prettierrc`, 120 cols, single quotes). Code was just auto-formatted; keep it formatted but readable — real functions with names, no multi-statement one-liners, short comments only where the *why* is non-obvious.

## Concurrency rules

- Several agents edit this tree at once and it is NOT a git repository. Edit ONLY files in your "Owns" list. Need a change elsewhere -> describe it in your report ("Requests" section); never edit it.
- Do not run `npm run build`, `npm ci`/`install`, or `prettier` on files you do not own (`dist/` and `node_modules/` are shared). You MAY run `node --test <your test files>` and `npx prettier --write <your own files>`. The coordinator runs the full suite and build after the wave.
- New tests go in NEW files named in your task (`tests/<area>.test.js`, flat directory: `package.json` runs `node --test tests/*.test.js`). Do not edit `tests/engine.test.js` or `tests/examples.test.js` unless your task owns them.
- Tests must catch plausible consumer-visible bugs (behaviour, boundaries, errors). No tests of wiring, copies or source text.
- Shared contract: `src/engine/catalog.js` exports `functionParameters`, `supportedFunctions`, `mappingKeys`, `commonFunctionKeys`, `entityTypes`, `executionModes`, `detectEntityPath`. Public engine API (`src/engine/index.js`): `runPipeline`, `evaluateExpression`, `readPath`, `supportedFunctions`, `detectEntityPath` — keep names and result shapes unless your task says otherwise.
- Finish the whole task; if something is blocked say exactly what is missing. Final report: what changed (files), decisions, verification output actually observed, requests to other owners, doc-row changes.
