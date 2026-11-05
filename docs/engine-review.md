# EngineReview-r1: adversarial engine review (wave 3, run 20261103-review)

Status: complete. Done by the coordinator after the `EngineReview` and `EngineReview2` agents died on HTTP 429 account rate limits.

Basis: the engine at baseline `1411da4` plus the working tree of this run. Four oracles and probes, all throwaway and outside the repository:

| Oracle | What it is | Used for |
|---|---|---|
| Pre-run engine | Snapshot of `src/engine` before the review waves (with `jsonpath-plus` reinstalled temporarily) | Old-versus-new differential |
| Jayway JsonPath 2.9.0 | The real library (json-path 2.9.0 jars, JDK 23) | JSONPath and filter/condition semantics |
| `java.util.regex` | JDK 23 (SapMachine) | Regex translation, replacement syntax |
| `java.time.format.DateTimeFormatter` | JDK 23 | `manipulateDate` patterns |

Evidence level: Jayway 2.9.0 is the library the SAP documentation cites. SAP's own version, and whether top-level (non-filter) conditions use the same rules as filters, are unverified. Nothing here proves SAP parity.

## Findings and what was done

| ID | Sev | Finding | Evidence | Action |
|---|---|---|---|---|
| F1 | High | `NIN` was the plain negation of `IN`, so a non-list right side made it true. Jayway: false. | 225 of 4,447 filter cases | Fixed: `NIN` is false when the right side is not a list. |
| F2 | High | `EMPTY` treated null and missing as empty; `SIZE` counted object keys and treated null/missing as 0. Jayway: strings and arrays only; every other left operand makes `EMPTY true`, `EMPTY false` and `SIZE n` false; an object makes `EMPTY` throw. | 18 cases | Fixed. `EMPTY` on an object is an explicit error. |
| F3 | High | `=~` was a substring (find) test. Jayway uses `Matcher.matches()`: `/b/` does not match `abc`. | 2 cases plus the SAP documentation's own `.*`-padded example | Fixed: the pattern must match the whole value. Array, number, boolean, null and missing operands verified (18 of 18 agree). |
| F4 | Medium | `==`, `!=`, `IN`, `CONTAINS` and the set operators were strictly typed. Jayway converts a numeric string to a number (`'1' == 1`). `===` stays strict. | 8 cases | Fixed. |
| F5 | Medium | Two missing operands compared equal. Jayway: a missing value equals nothing (`==` false, `!=` true). | 7 cases | Fixed. |
| F6 | High | Existence test in a filter (`[?(@.x)]`) meant "selects at least one node". Jayway evaluates the path with `REQUIRE_PROPERTIES`: no missing property on the way (a name missing from an object when it ends the path or follows only definite segments; a name or index on a non-container after only definite segments) and, for a definite path, a result. An indefinite path that selects nothing still exists. | 12 of 44 existence probes | Fixed in `jsonpath.js` (`state.missing`); the 2 remaining differences are both errors with different text. |
| F7 | Medium | An apostrophe run of four or more in a date pattern produced the wrong number of quotes: `''''` is one quote in Java, two here. A silent wrong answer. | 15 of 5,000 date cases | Fixed in `dates.js`; 0 value differences over 7,500 cases after the fix. |
| F8 | Low | Catastrophic regex backtracking: `(a+)+$` against 40 `a`s plus `!` does not return. | Probe hangs | Not fixed: JavaScript and Java both backtrack exponentially and no cheap engine-level guard exists. The 5-second worker timeout terminates it; the UI is not blocked. The pre-run engine behaved identically. |

Also removed: the now-unused `isEmpty` helper in `util.js`.

### Remaining known differences from Jayway 2.9.0 (left on purpose)

| Case | Jayway | Here | Reason |
|---|---|---|---|
| `$.a[1:-1]` (mixed-sign slice) | `[]` (an apparent Jayway quirk) | explicit error | Version-dependent; refused rather than guessed. |
| `$.s.length()` on a string | NullPointerException | string length | Useful and harmless. |
| `EMPTY` or `=~` with a wrong-kind right operand | false | explicit error | A malformed condition should fail loudly; the editor flags it while typing. |
| `@.arr size 2.5` | matches (truncation) | no match | Jayway quirk. |
| An aggregate (`.max()`) on an empty or non-numeric array | JsonPathException | explicit error with other text | Both error. |

## Verified sound

| Check | Result |
|---|---|
| Robustness fuzz, 25,000 iterations (random sourcePath, targetPath, conditions, regex functions, replacement syntax, `manipulateDate`, `decode`), plus 7 structural stress inputs (20,000 nested parentheses, a 50,000-token condition, a 50,000-segment path, a 200,000-member scan, depth-3,000 nesting) | Zero raw JS exceptions (`TypeError`, `RangeError`, `SyntaxError`) in `entity.error`, zero non-`Error` throws. Slowest non-ReDoS probe: 302 ms. |
| Prototype pollution: 19 documents with `__proto__`, `constructor`/`prototype` in sourcePath, targetPath, variables, constants, map-function keys, `applyOnAttribute`/`assignToAttribute`, valueMapping, and `JSON.parse`-created own `__proto__` keys in the data | `Object.prototype` unchanged; no own `__proto__` key in any output. |
| Java regex translation, 3 seeds, about 3,000 cases each, against `java.util.regex` | 0 cases where Java rejects a pattern the engine accepts; about 19% explicit rejections (non-ASCII case-insensitivity, `\b` on non-ASCII text, constructs JavaScript cannot express). 25 value differences in the one seed whose output was read, all pathological: empty-match iteration inside a quantified group (ECMAScript rejects the empty iteration, Java keeps it), a captured group that did not participate in the last iteration (`""` versus undefined), and empty matches between the two halves of an emoji's surrogate pair. |
| `manipulateDate`, 3 seeds of 2,500 cases, against `DateTimeFormatter` | After F7: 0 value differences, 0 Java-only errors; 7 to 13 engine-only errors per seed (year outside the pattern's width), which are explicit. |
| JSONPath, 60 hand-written cases against Jayway | 5 differences before the fixes; 2 left, listed above. |
| Editor/engine parity | `tests/editor-engine-parity.test.js`: about 98 cases through both the real engine and the editor's diagnostics, plus an import-graph guard. |
| Bundle placement | `npx vite build --outDir <temp>`: country and timezone data appear only in the worker chunk; the main chunk grew from about 141 kB to 178 kB with the editor intelligence. |

## Differential old versus new engine (1,032 generated cases, 6 shipped examples)

| Bucket | Count | Verdict |
|---|---|---|
| Identical | 684 | |
| OK to error | 312 | Intended: an array, null or object passed to a string function used to be stringified (`"1,2,3"`, `"null"`, `"[object Object]"`); a non-byte array to `encode`/`toString`; a target index beyond the array length. All are explicit errors now. |
| Error to OK | 20 | Intended: negative indices (`$.a[-1]`), and `elementAt` on a filter result. |
| OK to different OK | 14 | Intended: negative index with `optional`; `[?(@.primary)]` is now an existence test (selects both emails, as Jayway does); `5 < "9"` is now false instead of a JavaScript coercion. |
| Error to different error | 2 | Message only. |

No regression found. Every difference traces to a documented decision. Run before the Jayway-alignment fixes above, so the `5 < "9"` and existence rows are the only ones touched by operator semantics.

## Not covered

- SAP's actual engine: no reference outputs exist. Every "bounded" row in `docs/coverage.md` stays bounded.
- Jayway versions other than 2.9.0.
- Locale and timezone behaviour of `toUpperCaseString`, `manipulateDate` defaults and `randomPassword` against a JDK in another locale.
- A persisted, automated browser suite.
