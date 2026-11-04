// Descriptions shown by hover and completion. Texts state what this app's evaluator does; they make no claim about SAP.
import { functionParameters, parameterEnums, parameterTypes, requiredParameters } from '../engine/catalog.js';

export const documentKeys = {
  user: 'Transformation section applied when the selected entity type is user.',
  group: 'Transformation section applied when the selected entity type is group.',
  role: 'Transformation section applied when the selected entity type is role.',
};

export const sectionKeys = {
  mappings: 'Ordered mappings for the selected entity section.',
  condition: 'Entity condition. When false, the entity is skipped. Evaluated when you press Run.',
  ignore: 'true excludes the whole entity from execution.',
  skipOperations: 'Rejected by this evaluator: it needs the provisioning lifecycle, which is not simulated.',
};

export const mappingKeyDocs = {
  sourcePath: 'JSONPath evaluated against the current input entity.',
  sourcePaths: 'Ordered input paths for a valueMapping tuple.',
  targetPath: 'JSONPath where this mapping writes its result. Definite paths, [*] and [?(@.attr)] only.',
  sourceVariable: 'Read a named variable from runtime context.',
  targetVariable: 'Write a named variable for subsequent mappings.',
  constant: 'A literal JSON value used as the mapping input. For type rename, the new key name.',
  optional: 'Skip this mapping when its source value is missing.',
  ignore: 'Exclude this mapping from execution.',
  condition: 'IPS condition. When false, this mapping is skipped. Evaluated when you press Run.',
  preserveArrayWithSingleElement: 'Retain array shape when a path selects one value.',
  scope: 'Requires explicit context.operation: createEntity, patchEntity or deleteEntity.',
  type: 'Mapping action: set (default), remove, rename or valueMapping.',
  defaultValue: 'Fallback when the selected input or tuple is missing.',
  valueMappings: 'Ordered { "key": [...], "mappedValue": ... } entries for valueMapping.',
  functions: 'Ordered transformation functions applied to the source value.',
  correlationAttribute: 'Identity metadata; this app performs no licensing or provisioning effects.',
};

export const mappingKeyTypes = {
  sourcePath: 'string',
  sourcePaths: 'array of strings',
  targetPath: 'string',
  sourceVariable: 'string',
  targetVariable: 'string',
  constant: 'any JSON value',
  optional: 'boolean',
  ignore: 'boolean',
  condition: 'string',
  preserveArrayWithSingleElement: 'boolean',
  scope: 'string or array of strings',
  type: 'string',
  defaultValue: 'any JSON value',
  valueMappings: 'array of objects',
  functions: 'array of objects',
  correlationAttribute: 'boolean',
};

export const booleanMappingKeys = ['optional', 'ignore', 'preserveArrayWithSingleElement', 'correlationAttribute'];

export const mappingTypeDocs = {
  set: 'Default. Read the source, apply functions, write targetPath and/or targetVariable.',
  remove: 'Remove the output at targetPath. Functions are not allowed.',
  rename: 'Rename the last key of the output at targetPath to the string constant. Functions are not allowed.',
  valueMapping:
    'Match the tuple read from sourcePaths against valueMappings[].key and write mappedValue to targetPath. Functions are not allowed.',
};

export const commonFunctionKeyDocs = {
  function: 'Name of the mapping function to apply.',
  type: 'Legacy alias of "function"; both may be set only if they are equal.',
  condition: 'Per-function condition; when false the input passes through unchanged. @ is the current member.',
  applyOnElements: 'true applies the function to each member of an array input (boolean).',
  applyOnAttribute: 'Apply the function to this member of an object input.',
  assignToAttribute: 'Write the result to this member instead of applyOnAttribute. Requires applyOnAttribute.',
  applyOnJsonAttribute: 'Deprecated alias of applyOnAttribute.',
};

export const functionDocs = {
  concatString: 'Adds optional prefix and suffix around the value.',
  replaceString: 'Literal (non-regex) replacement of every occurrence of target.',
  replaceFirstString: 'Replaces the first match of a regex.',
  replaceLastString: 'Replaces the last match of a regex.',
  replaceAllString: 'Replaces every match of a regex.',
  toUpperCaseString: 'Upper-cases the string; optional locale such as en_EN.',
  toLowerCaseString: 'Lower-cases the string; optional locale such as en_EN.',
  substring: 'Substring from beginIndex to optional exclusive endIndex. Indices must be integers within the string.',
  splitStringToArray: 'Splits a string at a literal separator.',
  elementAt: 'Selects one member of an array input.',
  toString: 'Converts a byte array to a UTF-8 string, otherwise stringifies the value.',
  getMatchedRegexGroup: 'Returns capture group groupIndex of the first regex match (0 = whole match).',
  matchRegex: 'Returns true when the regex matches the value.',
  encode: 'Encodes a string or byte array as base32 or base64.',
  decode: 'Decodes base32 or base64 text to a byte array.',
  compositeId: 'Appends ":" and subId (a literal, or a JSONPath starting with $) to the value. Separator must be ":".',
  putIfAbsent: 'Sets key to defaultValue when the object member is missing or null.',
  putIfPresent: 'Replaces the object member key with defaultValue when it exists.',
  copyMapEntry: 'Copies the object member sourceKey to targetKey, keeping the original.',
  renameMapEntry: 'Copies sourceKey to targetKey and removes the original.',
  resolveEntityIds: 'Looks the value up in context.resolutions; never contacts a remote system.',
  randomPassword:
    'Generates a password; needs no source. All four minimums are required and must sum to at most passwordLength.',
  convertCountryCode: 'Converts a country name or ISO code to fullName, alpha2, alpha3 or numeric.',
  manipulateDate: 'Reformats and shifts a date using a supported Java-pattern subset (UTC arithmetic).',
  convertCountryRegion: 'Converts country/region attributes of an object to a region name or alpha2 code.',
  convertLocaleCode: 'Converts between ISO 639 and BCP 47 using context.localeMappings.',
  convertTimezoneCode: 'Converts between IANA and SAP timezone codes using the bundled table.',
};

export const parameterDocs = {
  prefix: 'Text placed before the value.',
  suffix: 'Text placed after the value.',
  target: 'Literal text to replace.',
  replacement: 'Replacement text.',
  regex: 'Regular expression; a leading (?i) enables case-insensitive matching. Java-only constructs are rejected.',
  locale: 'Locale such as en_EN.',
  beginIndex: 'Inclusive start index.',
  endIndex: 'Exclusive end index; defaults to the string length.',
  separator: 'Separator text.',
  index: 'Array index.',
  groupIndex: 'Regex capture group number; 0 is the whole match.',
  algorithm: 'base32 or base64.',
  skipPadding: 'true omits "=" padding when encoding.',
  subId: 'Literal value, or a JSONPath starting with $ that is read from the entity.',
  key: 'Object member name.',
  defaultValue: 'Value to write; any JSON value.',
  sourceKey: 'Object member to read.',
  targetKey: 'Object member to write.',
  entityType: 'Entity type key used to select a table in context.resolutions (defaults to user).',
  sourceSystemName: 'Source system name used to select a table in context.resolutions.',
  targetSystemName: 'Target system name used to select a table in context.resolutions.',
  passwordLength: 'Total length, 1 to 4096.',
  minimumNumberOfLowercaseLetters: 'Minimum lowercase letters (integer >= 0).',
  minimumNumberOfUppercaseLetters: 'Minimum uppercase letters (integer >= 0).',
  minimumNumberOfDigits: 'Minimum digits (integer >= 0).',
  minimumNumberOfSpecialSymbols: 'Minimum special symbols (integer >= 0).',
  specialSymbols: 'Characters used for special symbols; default ~!@#$%^&*()_+.',
  outputFormat: 'Target representation; the accepted values depend on the function.',
  inputAttributes: 'Object member names to read, e.g. ["country", "region"].',
  outputAttribute: 'Object member that receives the converted value.',
  sourceDateFormat: 'Java date pattern of the input, or Date(milliseconds).',
  targetDateFormat: 'Java date pattern of the output, or Date(milliseconds); defaults to sourceDateFormat.',
  years: 'Integer years to add.',
  months: 'Integer months to add; the day clamps to the month length.',
  days: 'Integer days to add.',
  hours: 'Integer hours to add.',
  minutes: 'Integer minutes to add.',
  seconds: 'Integer seconds to add.',
};

export const enumValueDocs = {
  base32: 'RFC 4648 base32 alphabet.',
  base64: 'Standard base64 alphabet.',
  fullName: 'English full name.',
  alpha2: 'Two-letter code.',
  alpha3: 'Three-letter code.',
  numeric: 'ISO numeric code.',
  bcp47: 'BCP 47 language tag.',
  iso639: 'ISO 639 language code.',
  iana: 'IANA timezone identifier.',
  sap: 'SAP timezone code.',
  ':': 'The only separator the evaluator accepts.',
  createEntity: 'Mappings with this scope run when context.operation is createEntity.',
  patchEntity: 'Mappings with this scope run when context.operation is patchEntity.',
  deleteEntity: 'Mappings with this scope run when context.operation is deleteEntity.',
  ...mappingTypeDocs,
};

export const wordOperators = {
  empty: 'path empty true/false: whether the left side is null, "" or an empty array.',
  size: 'path size n: number of items or characters on the left side equals n.',
  in: 'value in [list]: the left value equals one of the array members.',
  nin: 'value nin [list]: the left value equals none of the array members.',
  subsetof: 'left subsetof right: every left member is in the right array.',
  anyof: 'left anyof right: at least one left member is in the right array.',
  noneof: 'left noneof right: no left member is in the right array.',
  contains: 'left contains value: array member match or substring match.',
};

export const symbolOperators = {
  '==': 'Equal (JSON comparison).',
  '===': 'Equal (same as ==).',
  '!=': 'Not equal.',
  '!==': 'Not equal (same as !=).',
  '=~': 'Regex match; the right side must be a /pattern/ literal.',
  '<': 'Less than.',
  '>': 'Greater than.',
  '<=': 'Less than or equal.',
  '>=': 'Greater than or equal.',
  '&&': 'Logical and (short-circuit).',
  '||': 'Logical or (short-circuit).',
  '!': 'Logical not.',
};

export const conditionFunctions = {
  isValidEmail: {
    args: 1,
    signature: 'isValidEmail($.path)',
    doc: 'True when every selected value looks like an email address (generic check).',
  },
  isRegularGroup: {
    args: 0,
    signature: 'isRegularGroup()',
    doc: 'True unless the SAP group extension has both supportedOperations and applicationId.',
  },
  isApplicationSpecificGroup: {
    args: 0,
    signature: 'isApplicationSpecificGroup()',
    doc: 'Compares property ips.application.id (context.properties) with the group extension applicationId.',
  },
  isAttributeWithOptionalPrefix: {
    args: 2,
    signature: 'isAttributeWithOptionalPrefix($.path, propertyKey)',
    doc: 'True when the value or the property is absent, or the value starts with the property value.',
  },
  isAttributeWithMandatoryPrefix: {
    args: 2,
    signature: 'isAttributeWithMandatoryPrefix($.path, propertyKey)',
    doc: 'True only when both exist and the value starts with the property value.',
  },
};

export const pathMethods = {
  'length()': 'Number of members, or string length.',
  'size()': 'Same as length().',
  'first()': 'First selected value.',
  'last()': 'Last selected value.',
  'min()': 'Smallest selected value.',
  'max()': 'Largest selected value.',
  'sum()': 'Sum of the selected values.',
  'avg()': 'Average of the selected values.',
};

export const contextKeyDocs = {
  variables: 'Named values scoped to one entity and one stage; read with sourceVariable or ${name}.',
  properties: 'Explicit system property values used by %property% substitution.',
  operation:
    'Explicit local scope selection (createEntity, patchEntity, deleteEntity); no remote operation is performed.',
  resolutions: 'Caller-supplied identity resolution table, keyed by entity type or "source|target|type".',
  localeMappings: 'Ordered [ISO639, BCP47] pairs supplied from SAP language master data.',
};

// Names documented in docs/ips-inventory.md (special variables) and used by the conditional functions.
export const knownVariables = {
  entityIdSourceSystem: 'Source/proxy read identity selection; may be set by a mapping.',
  entityIdTargetSystem: 'Target/proxy identity; supplied by the caller in this app.',
  entityBaseLocation: 'Proxy entity endpoint base URL, supplied by the caller.',
  entityLocationSourceSystem: 'Proxy entity location, can be constructed from variables.',
  currentDate: 'Caller-supplied date; no clock is read.',
  assignGroup: 'Target-variable intent; no group assignment is performed.',
  unassignGroup: 'Target-variable intent; no group assignment is performed.',
};

export const knownProperties = {
  'ips.application.id': 'Used by isApplicationSpecificGroup() to compare with the group applicationId.',
};

// Own-property lookup: user text such as "toString" or "constructor" must not resolve to Object.prototype members.
export function get(table, key) {
  return typeof key === 'string' && Object.hasOwn(table, key) ? table[key] : undefined;
}

// Facts about one function parameter for hover/completion.
export function describeParameter(fn, name) {
  return {
    name,
    type: get(parameterTypes, name) ?? 'any',
    required: (get(requiredParameters, fn) ?? []).includes(name),
    values: get(get(parameterEnums, fn) ?? {}, name) ?? null,
    doc: get(parameterDocs, name) ?? '',
  };
}

export function parameterSignature(fn) {
  const required = get(requiredParameters, fn) ?? [];
  const parts = (get(functionParameters, fn) ?? []).map((name) => (required.includes(name) ? name : `${name}?`));
  return `${fn}(${parts.join(', ')})`;
}
