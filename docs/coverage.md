# Compatibility coverage and verification matrix

Inventory baseline: [official IPS inventory](ips-inventory.md), researched 2026-11-02. **Full SAP parity is not demonstrated.** This matrix separates discoverability, local implementation and reference evidence. A recognized name does not mean every argument, input shape or Java runtime behavior is supported.

Statuses: **local** = evaluator route exists; **bounded** = deliberately restricted or depends on caller-supplied exact data; **metadata** = inspect intent without external effects; **outside** = not performed. Engine test results and final QA are recorded in the implementation run reports. No row has live SAP tenant differential evidence at this delivery baseline.

## Mapping language

| Feature | Local status | Required parity evidence / known boundary |
| --- | --- | --- |
| user/group/role section selection | local | Selected section only; not a provisioning connector/job. |
| Ordered mappings | local | Dependency and overwrite fixtures. |
| sourcePath | bounded | JSONPath dialect below. |
| targetPath | bounded | Property/index/wildcard and attribute-projection construction; arbitrary target predicates need explicit support/error. |
| sourcePaths | local | valueMapping tuples only. |
| sourceVariable / targetVariable | local | Independent stages and entities; caller context, no IPS state discovery. |
| constant | local | JSON primitives/objects/arrays and interpolation. |
| optional | local | Missing mandatory source errors. An empty array or missing path counts as missing; `null` and `''` are values; a constant is never missing. Tenant fixtures still needed. |
| defaultValue | local | Applied to a missing path or empty array, missing optional input, and unmatched valueMapping. `null`/`''` do not trigger it (bounded, unverified). |
| ignore | local | Entity/mapping exclusion. |
| condition | bounded | Parser/operator coverage below. |
| preserveArrayWithSingleElement | bounded | Definite arrays versus indefinite path selection need differential fixtures. |
| type:set | local | Default action. |
| type:remove | bounded | Definite paths, `[*]` and `[n]`; never creates parents. Filters and `..` fail explicitly. |
| type:rename | local | Final output key; doc-derived fixture. |
| type:valueMapping / valueMappings | local | Ordered key tuples and fallback; doc-derived fixture. Malformed keys and keys a mapping type ignores are rejected explicitly. |
| functions chain | local | Per-function limits below. |
| function / legacy type name | local | Recognized names only. |
| applyOnElements | local | Arrays; intrinsic collection-function behavior also matters. |
| applyOnAttribute / applyOnJsonAttribute | local | Single map member; deprecated spelling recognized. |
| assignToAttribute | local | Output member for function result. |
| function condition | bounded | Current-member context versus entity root needs reference fixtures. |
| %property% | local | Caller supplies system properties; missing value errors. |
| ${variable} | local | Caller/local stage variables; no invented external values. |
| correlationAttribute | metadata | Marker accepted; identity licensing/counting outside. |
| scope:createEntity | bounded | Caller-supplied operation selection only; an invalid scope value fails instead of skipping the mapping. |
| scope:patchEntity | bounded | Caller selection only, no PATCH request. |
| scope:deleteEntity | bounded | Caller selection only, no deletion/update side effects. |
| skipOperations | outside | Explicit unsupported lifecycle diagnostic; never silently ignored. |

## Mapping functions: complete discovered inventory

| Function | Local status | Remaining verification boundary |
| --- | --- | --- |
| concatString | local | Coercion, null, interpolation. |
| convertCountryCode | bounded | Accepts alpha-2/alpha-3/numeric/English name; ambiguous names (e.g. Congo) error; ISO dataset versus SAP aliases unverified. |
| convertCountryRegion | bounded | Country-qualified region codes handled (`DK-84` -> `DK-84`); dataset completeness unverified; no raw regex built from input. |
| convertLocaleCode | bounded | Requires `context.localeMappings`. Documented English fallback is recorded as `fallbackUsed` in the debug trace; bcp47 output without an EN entry errors. |
| convertTimezoneCode | bounded | Official ordered 459-pair table; documented fallback (Europe/Berlin / CET) is recorded as `fallbackUsed` in the debug trace; tenant comparison pending. |
| compositeId | local | Colon and subId literal/path; doc-derived fixture. |
| copyMapEntry | local | Map and collection behavior; missing source key edge cases. |
| decode | bounded | Strict base32/base64: bad characters, padding and lengths error; URL-safe alphabets rejected. SAP vector verified for base32 encode. |
| elementAt | local | Bounds/type edge cases. |
| encode | bounded | Byte arrays validated (integers 0-255); UTF-8 only; unpaired surrogates error. |
| getMatchedRegexGroup | bounded | Java regex translated to JavaScript (allow-list); find semantics unverified; out-of-range group errors. |
| manipulateDate | bounded | `DateTimeFormatter`-style subset; invalid dates error (no roll-over); offsets carried through; DST/leniency/default timezone unverified. |
| matchRegex | bounded | Find (substring) semantics; whole-match (`Matcher.matches`) versus find needs an SAP reference case. |
| putIfAbsent | bounded | Array-of-map behavior; null versus empty. |
| putIfPresent | bounded | Array-of-map behavior; missing/null differences. |
| randomPassword | bounded | Local CSPRNG; custom symbols require a nonzero special minimum; no deterministic output parity claim. |
| renameMapEntry | local | Map and collection behavior. |
| replaceString | local | Literal replacement; empty target follows Java `String.replace`. |
| replaceFirstString | bounded | Java replacement syntax (`$1`, `\$`; JS-only tokens error); regex dialect translated. |
| replaceLastString | bounded | Last non-overlapping match, Java replacement syntax. |
| replaceAllString | bounded | Java replacement syntax; regex dialect translated. |
| resolveEntityIds | bounded | Supplied resolution data only; no remote lookup or fabricated IDs. |
| splitStringToArray | bounded | Literal versus regex separator needs tenant-reference case; target object projection. |
| substring | local | Java index range and UTF-16 behavior. |
| toString | bounded | UTF-8 byte/string cases and malformed bytes. |
| toUpperCaseString | bounded | Browser locale behavior versus Java locale/version. |
| toLowerCaseString | bounded | Browser locale behavior versus Java locale/version. |

## Conditions and JSONPath

| Feature | Status | Boundary |
| --- | --- | --- |
| isValidEmail | bounded | SAP published Java pattern differs from a generic browser email check. |
| isApplicationSpecificGroup | bounded | Supplied ips.application.id and SAP Group extension. |
| isRegularGroup | bounded | SAP Group extension supportedOperations/applicationId; missing/null cases. |
| isAttributeWithOptionalPrefix | local | Attribute/property missing follows documented optional behavior. |
| isAttributeWithMandatoryPrefix | local | Both values required for true. |
| && / \|\| / ! / parentheses | local | Precedence and error reporting must be tested. |
| == / != / < / <= / > / >= | bounded | Deep order-independent equality; a number equals a numeric string for `==`/`!=` (not `===`); a missing value equals nothing. Ordering only number-vs-number and string-vs-string, otherwise false. Checked against Jayway 2.9.0; SAP's version unverified. |
| contains / IN / NIN | bounded | Members compare like `==`; IN and NIN are both false when the right side is not a list (Jayway 2.9.0). |
| EMPTY / SIZE | bounded | Strings and arrays only; null, missing, numbers and booleans are false for both EMPTY forms and for SIZE; EMPTY on an object errors (Jayway 2.9.0). Top-level (non-filter) behaviour in SAP is an open reference case. |
| SUBSETOF / ANYOF / NONEOF | bounded | Non-list right side makes SUBSETOF/ANYOF/NONEOF false (Jayway 2.9.0); SAP acceptance unverified. |
| =~ regular-expression literal | bounded | Whole-value match like Jayway 2.9.0 (`/b/` does not match `abc`); the SAP example pads with `.*`. SAP's version unverified. |
| JSONPath property/bracket/index access | bounded | Own Jayway-dialect evaluator (no JSONPath Plus); negative indices and name unions supported; Jayway version unverified. |
| Wildcard / union / slice / recursive descent | bounded | Mixed-sign and step slices and `..[?()]` are explicit errors. |
| JSONPath filters | bounded | Bare path in a filter is an existence test with Jayway's rule: nothing missing on the way, and an indefinite path exists even if it selects nothing; filter on an object tests the object; filter on a primitive/null errors. Explicit condition parser; no JavaScript execution. |
| Terminal length/min/max/sum/avg/first/last | bounded | Never returns NaN/Infinity: non-numeric members and empty min/max/avg error (stricter than Jayway). |
| Other Jayway path functions | bounded | stddev/keys/concat/append/index and `~`, `^` error. |
| Java regex constructs | bounded | Unsupported constructs must error; negative lookahead ?! is rejected by current SAP validation release note. |

## Variables and context

| Variable / context | Status | Meaning |
| --- | --- | --- |
| entityIdSourceSystem | local | Supplied or mapping-written identity value. |
| entityIdTargetSystem | bounded | Supplied existing-target identity only. |
| entityBaseLocation | bounded | Supplied URL; no discovery/call. |
| entityLocationSourceSystem | local | Supplied or locally constructed value. |
| currentDate | bounded | Caller-supplied deterministic date; no fabricated IPS date context. |
| assignGroup | metadata | Variable output intent; no group assignment. |
| unassignGroup | metadata | Variable output intent; no group unassignment. |
| Custom variables | local | Per entity and stage scope. `entityIdSourceSystem` set by a source stage is also readable in the target stage of the same entity (bounded: SAP's exact exposure to write transformations unverified). |
| System properties | bounded | Explicit caller-supplied values. |
| Resolution state | bounded | Explicit caller-supplied IDs; cross-system selector semantics require fixtures. |
| Missing external context | local | Diagnostic/error instead of simulated result. |

## Reference evidence levels

1. Unit fixtures verify this local implementation.
2. Doc-derived fixtures use documented structures and expected examples; they are **not** SAP-run evidence.
3. Live differential conformance needs anonymized input, transformation, context and actual SAP output for the same case. None was supplied.

For exact document/example page references and the remaining research gates, see `ips-inventory.md`. The operational app can be useful while these compatibility limits remain visible; it must never be described as a complete IPS runtime replacement.

## Cross-cutting behavior

| Feature | Local status | Boundary |
| --- | --- | --- |
| Structured error details (`errorDetail`) | local | Stage, mapping index, function and stable code per failed entity; `entity.error` text unchanged. |
| Resource limits | local | Deep nesting yields a `LIMIT` error rather than a stack overflow; 5 MB / 5 s worker bounds in the UI. |
| `%x%` / `${x}` interpolation | bounded | Resolved per token in conditions and outside filter bodies in paths; object literals in conditions are explicitly unsupported. |
