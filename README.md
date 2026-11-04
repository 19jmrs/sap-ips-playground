# SAP IPS Transformation Playground

A local browser application for experimenting with pasted JSON and SAP Identity Provisioning transformations. The interface is in English. This is an independent implementation, not an SAP service or a certified IPS runtime.

## Start

Requires Node.js 20.19+ or 22.12+ and npm.

```powershell
cd E:/Projects/sap-ips-playground
npm ci
npm run dev
```

Open the Local URL printed by Vite (normally http://127.0.0.1:5173). To produce static files:

```powershell
npm test
npm run build
npm run preview
```

No credentials, database, API keys or environment variables are required. No deployment was performed.

## Workflow

1. Load a synthetic example or paste a JSON entity or batch.
2. Choose Source only, Target only, or Source → Target. Paste the appropriate IPS transformation documents.
3. Check the entity path and user/group section. Supply required external context explicitly.
4. Click Run. Inspect each entity, source and target output, changes, errors and optional mapping trace.
5. Switch to Expressions to evaluate JSONPath or IPS conditions against the input. Expression evaluation also requires Run.

Editing does not run transformations. Formatting and editor diagnostics may update without execution.

## Compatibility and privacy

Read [the official inventory](docs/ips-inventory.md), [coverage](docs/coverage.md) and [architecture](docs/architecture.md). Supported reference behavior is not proof of full SAP parity. Unknown or unsupported behavior must produce a visible error. Real IPS differential fixtures are needed for further compatibility verification.

All payload processing is local to the browser. No application server receives input documents. Nothing is stored by default. An opt-in footer option keeps editor inputs (never results) in this tab's `sessionStorage` across reloads; Clear workspace removes them. Browsers may retain or restore in-memory pages and session storage; a website cannot guarantee forensic erasure on browser closure. Use fictitious data. Export and Import case use local files you control; imported cases never run automatically.

CodeMirror provides integrated editor language services. There is no Language Server Protocol server. See architecture for the LSP tradeoff and future extension boundary.

## Verified delivery

Last verified after the review run (`runs/20261103-review/`): `npm test` passes 324 tests, `npm run build` succeeds and Prettier is clean. The built app was exercised in headless Chromium: running examples, the stage-diff selector, opt-in session recovery, case import and rejection of a bad file, the coverage dialog, editor diagnostics, and the expression workspace (whole-value `=~`, `EMPTY` on missing values), with no console errors and no requests leaving the origin. Condition, JSONPath, regex and date behaviour was compared with real Jayway JsonPath 2.9.0 and the JDK's `java.util.regex` and `java.time` in a differential review ([report](runs/20261103-review/reports/EngineReview-r1.md)); that is evidence about those libraries, not about SAP's service. Other browser engines, mobile layout and assistive-technology use have not been tested.

Runtime context examples and reference-fixture guidance: [context](docs/context.md). There is no actual LSP server and no hosted deployment; run it locally with `npm run preview` after `npm run build`.
