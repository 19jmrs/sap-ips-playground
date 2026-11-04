# Official IPS language inventory

Research date: 2026-11-02. This is an inventory of the public documentation, not a certification of this application's SAP compatibility. Implementation status belongs in `coverage.md`.

## Evidence and scope

- [Transformations](https://help.sap.com/docs/cloud-identity-services/cloud-identity-services/transformations): source-specific JSON → read transformation → common JSON → write transformation → target-specific JSON.
- [Transformation expressions](https://help.sap.com/docs/identity-provisioning/identity-provisioning/transformation-expressions): expression inventory and examples.
- [Transformation functions, Cloud Identity Services](https://help.sap.com/docs/identity-authentication/identity-authentication/transformation-functions): conditional and mapping function tables.
- [Transformation functions, Identity Provisioning](https://help.sap.com/docs/identity-provisioning/identity-provisioning/transformation-functions): alternate official publication of the tables.
- [Transformation variables](https://help.sap.com/docs/identity-authentication/identity-authentication/transformation-variables?locale=enUS): named system variables and scope.
- [Official provisioning PDF](https://help.sap.com/doc/c30747989e33466e8e4f789dd9c3c81c/Cloud/en-US/Provisioning_Service.pdf): downloaded document was dated **2026-10-23**, sections 1.3.3.3–1.3.3.5, printed pages 433–536. Its title explicitly identifies the Neo environment. Cloud Identity Services pages above were also consulted; equality between every infrastructure variant is not established.
- [SAP KBA 3256165](https://userapps.support.sap.com/sap/support/knowledge/en/3256165): public exception preview identifies `com.jayway.jsonpath.PathNotFoundException`; the full article requires SAP login. This does not establish an exact version, options, providers, extensions, or compatibility contract.
- [Jayway's own documentation](https://github.com/json-path/JsonPath): useful comparison vocabulary, **not proof that SAP enables every upstream feature**.

Direct Help Portal `open` requests returned empty content. Indexed official page extracts and the downloaded official PDF supplied the readable evidence. The inventory below is the union of their published tables. No tenant was accessed and no SAP runtime differential tests were performed.

## Mapping and entity expressions

| Construct | Documented contract / inspection requirement |
| --- | --- |
| `user`, `group`, `role` | Entity-specific transformation sections; execute the selected entity section. |
| `mappings` | Ordered actions; later mappings see the progressively built output for output-side actions. |
| `sourcePath` | Read from source/current stage input JSON. |
| `sourcePaths` | Multiple inputs for `type: valueMapping`; tuple arity matches each `key`. |
| `targetPath` | Write output JSON; `$` is a complete-root copy. Construction filters such as `$.emails[?(@.value)]` describe output object attributes. |
| `sourceVariable`, `targetVariable` | Read/write an entity- and system-local variable; variables have no JSON representation. |
| `constant` | Literal JSON value, including arrays/objects/null and property/variable interpolation where applicable. |
| `optional` | Missing input fails unless optional; the default is mandatory. |
| `defaultValue` | Fallback for optional missing input; also fallback for missing/unmatched valueMapping tuples. |
| `ignore` | Entity or mapping exclusion. |
| `condition` | Entity, mapping, and function conditions; false excludes the applicable work. |
| `preserveArrayWithSingleElement` | Preserve a singleton array when true; otherwise collapse singleton values. Exact behavior depends on path result shape. |
| `type: set` | Default mapping action. |
| `type: remove` | Remove an output path. |
| `type: rename` | Rename the final key of an output path using `constant`. |
| `type: valueMapping` | Match ordered source-value tuples to `valueMappings[].mappedValue`. |
| `valueMappings` | Entries contain `key` arrays and `mappedValue`. |
| `functions` | Ordered function chain; each output feeds the next function. |
| `correlationAttribute` | Marks identities for IPS managed-identity counting/licensing; counting is outside transformation evaluation. A mapping can have only a source and this marker. |
| `scope: createEntity` | Write mappings restricted to creation; unscoped mappings also participate in creation. |
| `scope: patchEntity` | Proxy write PATCH; only mappings with that scope participate. |
| `scope: deleteEntity` | Delete-related write transformation; unscoped mappings and entity condition are ignored in the documented lifecycle behavior. Connector applicability varies. |
| `skipOperations` | Target-side create/update/delete lifecycle exclusions, evaluated after entity condition. No remote operation should be simulated by this app. |
| `%property.name%` | System-property interpolation (including paths and function arguments). Missing external configuration must be explicit. |
| `${variableName}` | Variable interpolation, with system/entity scope. |

Common function modifiers: `condition`, `applyOnElements`, `applyOnAttribute`, `assignToAttribute`; deprecated `applyOnJsonAttribute` aliases `applyOnAttribute`. A function descriptor may use `function` or legacy `type`. `applyOnElements` operates on collection members; attribute modifiers select a map member and optionally write the result under another member. Some collection functions intrinsically operate on arrays of maps even when `applyOnElements` is omitted in SAP examples.

## All discovered mapping functions (27)

`?` marks optional parameters. Common modifiers above are omitted from the signatures below. This list records API names and parameter contracts, not copied implementation code.

| Function | Parameters / material boundary |
| --- | --- |
| `concatString` | `prefix?`, `suffix?` |
| `convertCountryCode` | `outputFormat` fullName/alpha2/alpha3/numeric, `inputAttributes`, `outputAttribute`; ISO 3166-1 mappings. |
| `convertCountryRegion` | `outputFormat` fullName/alpha2, `inputAttributes` country+region, `outputAttribute` region; ISO 3166-2 mappings. |
| `convertLocaleCode` | `outputFormat` bcp47/iso639; SAP's default language mapping, unknown languages fall back to English. |
| `convertTimezoneCode` | `outputFormat` iana/sap; SAP's published ordered lookup table, unknown values default to Europe/Berlin or CET. First matching IANA value matters. |
| `compositeId` | `separator` colon, `subId` string or JSONPath. |
| `copyMapEntry` | `sourceKey`, `targetKey`; preserve original map entry. |
| `decode` | `algorithm` base32/base64, `skipPadding?` false; produces bytes. |
| `elementAt` | `index`; selects an array member. |
| `encode` | `algorithm` base32/base64, `skipPadding?` false; UTF-8 string or bytes. |
| `getMatchedRegexGroup` | `regex`, `groupIndex`; zero is whole match, positive values select captures. |
| `manipulateDate` | `sourceDateFormat?`, `targetDateFormat?`, `years?`, `months?`, `days?`, `hours?`, `minutes?`, `seconds?`; Java patterns and SuccessFactors milliseconds forms. |
| `matchRegex` | `regex`; boolean result. Java regex semantics need explicit verification. |
| `putIfAbsent` | `key`, `defaultValue`; set a missing/null map member in each array object. Empty-string treatment is not experimentally confirmed. |
| `putIfPresent` | `key`, `defaultValue`; replace present members in each array object, leave absent members absent. |
| `randomPassword` | `passwordLength`, `minimumNumberOfLowercaseLetters`, `minimumNumberOfUppercaseLetters`, `minimumNumberOfDigits`, `minimumNumberOfSpecialSymbols`, `specialSymbols?`; sum cannot exceed length; custom symbols require nonzero special minimum. No source required. |
| `renameMapEntry` | `sourceKey`, `targetKey`; remove original key after copying value. |
| `replaceString` | `target`, `replacement`; literal substring replacement. |
| `replaceFirstString` | `regex`, `replacement`; first regex occurrence. |
| `replaceLastString` | `regex`, `replacement`; last regex occurrence. |
| `replaceAllString` | `regex`, `replacement`; all regex occurrences. |
| `resolveEntityIds` | `entityType?` user/group (default user), `sourceSystemName?`, `targetSystemName?`; requires supplied resolution state, never fabricate remote IDs. |
| `splitStringToArray` | `separator`; strings or object construction according to target path. |
| `substring` | `beginIndex`, `endIndex?` exclusive. |
| `toString` | UTF-8 byte/string conversion. |
| `toUpperCaseString` | `locale?` en_EN. |
| `toLowerCaseString` | `locale?` en_EN. |

The PDF extracts `splitStringToArray` with a typographic space in its name; the web table supplies the actual identifier. There is no documented generic `toLowerCase`/`trim`/`hash` mapping function in these tables; do not silently accept invented aliases.

## All discovered conditional functions (5)

| Function | Arguments / documented result |
| --- | --- |
| `isValidEmail` | JSONPath; validate each selected email against SAP's published email pattern. Java atomic groups and array behavior need reference cases. |
| `isApplicationSpecificGroup` | No arguments; compare system property `ips.application.id` with the SAP Group extension `applicationId`. |
| `isRegularGroup` | No arguments; true if `supportedOperations` or `applicationId` is absent, otherwise false. Connector extension paths matter. |
| `isAttributeWithOptionalPrefix` | JSONPath, unquoted system-property key; true if attribute/property absent or value starts with configured prefix. |
| `isAttributeWithMandatoryPrefix` | JSONPath, unquoted system-property key; true only when both are present and the prefix matches. |

Official conditions demonstrate `&&`, `||`, parentheses, comparisons, `contains`, `EMPTY`, `NIN`, literal arrays, root paths, `@` function-member paths and JSONPath terminal `length()`. These examples do not constitute a complete grammar. Upstream Jayway additionally documents regex, membership/set operators, sizes, slices, unions, recursive descent and numeric aggregate functions; support must be enumerated and tested individually rather than inferred.

## All specially documented system variables (7)

| Variable | Applicable source of context / consequence |
| --- | --- |
| `entityIdSourceSystem` | Source/proxy read identity selection; may be set by mapping. |
| `entityIdTargetSystem` | Target/proxy identity from creation response or IPS state; caller supplies it. |
| `entityBaseLocation` | Proxy entity endpoint base URL, caller supplied. |
| `entityLocationSourceSystem` | Proxy entity location, can be constructed from variables. |
| `currentDate` | Caller supplies deterministic date; SAP default format yyyy-MM-dd HH:mm:ss.SSS and property-controlled Java format. |
| `assignGroup` | Target-variable intent; no group assignment side effect in this app. |
| `unassignGroup` | Target-variable intent (often delete scope); no group side effect in this app. |

Custom local variables are also allowed. Variables created in a source stage must not automatically become target-system variables; independent stage context and per-entity reset are required.

## Reference cases to preserve

These are independently invented fixtures exercising the documented structures:

Source locations for doc-derived expectations (none are live SAP-run outputs):

| Pattern | Official location in PDF dated 2026-10-23 | Web page |
| --- | --- | --- |
| AD `sn[0]` → `name.familyName`, followed by target mapping | pp.429–431, Basic Transformation | [Transformation types](https://help.sap.com/docs/identity-provisioning/identity-provisioning/transformation-types) |
| Entity condition using email length and familyName EMPTY | pp.431 and 440–442 | [Transformation expressions](https://help.sap.com/docs/identity-provisioning/identity-provisioning/transformation-expressions) |
| Composite ID source + colon + subId | pp.500–501 | [Transformation functions](https://help.sap.com/docs/identity-provisioning/identity-provisioning/transformation-functions) |
| Rename final target key using constant | p.463 | [Transformation expressions](https://help.sap.com/docs/identity-provisioning/identity-provisioning/transformation-expressions) |
| Value mapping tuples and default fallback | pp.464–468 | [Transformation expressions](https://help.sap.com/docs/identity-provisioning/identity-provisioning/transformation-expressions) |
| Filter-shaped target object construction from emails | pp.471–472 | [Transformation functions](https://help.sap.com/docs/identity-provisioning/identity-provisioning/transformation-functions) |
| Ordered timezone table | pp.483–496, 459 extracted pairs | [Transformation functions](https://help.sap.com/docs/identity-provisioning/identity-provisioning/transformation-functions) |

The AD and other connector defaults contain many additional mappings. A test covering one projected attribute is a derivative fixture and must not be labelled a full default-transformation test. Exact JSON bytes and expected tenant output should be captured separately for differential conformance.

```json
{"sourcePaths":["$.country","$.city"],"type":"valueMapping","targetPath":"$.timezone","defaultValue":"UTC","valueMappings":[{"key":["PT","Lisbon"],"mappedValue":"Europe/Lisbon"}]}
```

```json
{"sourcePath":"$.emails[*].value","preserveArrayWithSingleElement":true,"targetPath":"$.emails[?(@.value)]"}
```

```json
{"targetPath":"$.name.surname","constant":"familyName","type":"rename","optional":true}
```

## Critical unknowns and verification gates

1. Exact SAP Jayway version/configuration and all transformation extensions remain unknown. JSONPath Plus or another JavaScript library alone cannot prove equivalence.
2. Java regular expressions differ from JavaScript (atomic groups, inline flags, replacement syntax, Unicode and whole-match behavior). The **15 October 2026** release note in the PDF says negative lookahead `?!` now fails SAP validation. Do not claim unrestricted Java regex compatibility.
3. SAP country, region, language and timezone lookup data and ordering must be complete for broad conversion parity. A few hardcoded samples are a bounded implementation.
4. Java date patterns, leniency, time zones, DST and date arithmetic need differential fixtures.
5. Missing versus null versus empty, singleton-array collapse, construction-filter merging and function conditions on array objects need tenant-reference tests.
6. Scope/lifecycle metadata can be evaluated against supplied context but external provisioning jobs, storage, calls, entity resolution and assignment side effects are outside scope.
7. No public SAP reference execution suite or tenant outputs were available in this task. Locally passing examples establish local behavior only. Preserve expected/actual JSON fixture pairs from real IPS when available; no credentials are required.
