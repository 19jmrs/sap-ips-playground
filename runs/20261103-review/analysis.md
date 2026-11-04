# Independent analysis — 2026-11-03

Basis: source read in full for `engine/index.js`, `App.jsx`, `JsonEditor.jsx`, `Results.jsx`, `execution.js`; docs/coverage.md; 28 tests re-run (pass); build re-run (pass); ~30 engine probes (`readPath`, conditions, functions). No SAP reference outputs exist, so semantic parity is not assessed.

## Done well

- Honest compatibility posture: coverage matrix, explicit rejection of unsupported syntax, no "IPS compatible" claim.
- Safe execution model: disposable module Worker, 5 s timeout via `terminate()`, 5 MB bound; JSONPath Plus with `eval:false`; prototype-pollution key guards; no fetch/storage/console in `src`.
- Context isolation per entity/stage; failure isolation per entity; trace keeps the failing function and per-member conditions.
- Boolean short-circuit evaluation suppresses runtime-only branches (`suppressed` flag).
- Light UI bundle: editor metadata (`catalog.js`) separated from the evaluator + datasets; vendor chunk split.
- Manual-run requirement respected throughout; stale indicators with a revision guard.

## Problems found (evidence)

| # | Area | Finding | Evidence | Handled by |
|---|---|---|---|---|
| 1 | Maintainability | Engine was one 34 KB file with statement-per-line density; UI the same | `wc`: 420 lines / 34,178 bytes | Phase 0 (Prettier) + W1-ENGINE-SPLIT, W1-APP |
| 2 | Correctness | Any path containing `constructor`/`prototype`/`__proto__` as a substring is rejected, including legitimate names | probe: `$.constructorName` -> "Unsafe property in JSONPath" | W2-PATHS-CONDITIONS |
| 3 | Correctness | `%...%` / `${...}` substitution runs on the whole condition text before tokenising: a `%` inside a regex/string literal is treated as a property reference; substituted strings are not re-quoted | `engine/index.js condition()` | W2-PATHS-CONDITIONS |
| 4 | Correctness | `==` compares via `JSON.stringify` (object key order matters); no object literals; `<`/`>` use JS coercion on mixed types; missing-vs-null (`$.zzz == null` is false) undocumented | probes | W2-PATHS-CONDITIONS |
| 5 | Correctness | Path aggregates return `NaN`/`±Infinity` silently (`sum` of strings, `min` of empty array) which serialise to `null` | probes | W2-PATHS-CONDITIONS |
| 6 | Correctness | Function semantics rely on JS regex/string behaviour: Java regex constructs only partially screened; replacement-string syntax differs (`$&`); base64 uses `btoa`; malformed input behaviour | `regex()`, encode/decode | W2-FUNCTIONS |
| 7 | Design | Errors are plain strings; no stage/mapping/function/code fields; UI cannot show location or classify | `throw new Error(\`${stage} mapping ${n}: ...\`)` | W2-PIPELINE |
| 8 | Design | Per-record `structuredClone` of full values for the trace even when debug is off (`record.read=clone(value)`) | transform loop | W2-PIPELINE |
| 9 | Editor | All static diagnostics are at offset 0; no per-function parameter/enum validation; completion context-free; hover static | `JsonEditor.jsx mappingLint` | W1-EDITOR |
| 10 | UI | `App.jsx`: 20 `useState`, inline mega-handlers; role missing from entity selector; docs shown as raw markdown `<pre>` | `App.jsx` | W1-APP |
| 11 | Missing | Local import; session recovery (handover §3 / §8.5, §8.6) | not implemented | W1-APP |
| 12 | Tests | Only engine tests; none for execution wrapper, UI state, editor logic; no lint; no CI; no browser smoke test persisted | `tests/` | W1-APP, W1-EDITOR, Wave 3 |
| 13 | Process | Project is not a git repository: no history, no safe concurrent edits | `git status` fatal | Reported; snapshot taken |
| 14 | Hosting | No CSP/security headers, no deployment notes (deployment is unauthorized, config is not) | `index.html`, `vite.config.js` | Wave 3 |

## Not fixable without evidence (stays bounded)

Jayway vs JSONPath Plus equivalence, Java regex whole-match vs substring (`matchRegex`), SAP country/region data versions, locale master data, DST/leniency in date arithmetic, tenant-specific scope behaviour. These need real IPS outputs from the user (see docs/context.md).
