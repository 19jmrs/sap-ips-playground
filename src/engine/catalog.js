// Editor metadata has no evaluator/data imports, keeping the main UI lightweight.
export const functionParameters = {
  concatString: ['prefix', 'suffix'],
  replaceString: ['target', 'replacement'],
  replaceFirstString: ['regex', 'replacement'],
  replaceLastString: ['regex', 'replacement'],
  replaceAllString: ['regex', 'replacement'],
  toUpperCaseString: ['locale'],
  toLowerCaseString: ['locale'],
  substring: ['beginIndex', 'endIndex'],
  splitStringToArray: ['separator'],
  elementAt: ['index'],
  toString: [],
  getMatchedRegexGroup: ['regex', 'groupIndex'],
  matchRegex: ['regex'],
  encode: ['algorithm', 'skipPadding'],
  decode: ['algorithm', 'skipPadding'],
  compositeId: ['separator', 'subId'],
  putIfAbsent: ['key', 'defaultValue'],
  putIfPresent: ['key', 'defaultValue'],
  copyMapEntry: ['sourceKey', 'targetKey'],
  renameMapEntry: ['sourceKey', 'targetKey'],
  resolveEntityIds: ['entityType', 'sourceSystemName', 'targetSystemName'],
  randomPassword: [
    'passwordLength',
    'minimumNumberOfLowercaseLetters',
    'minimumNumberOfUppercaseLetters',
    'minimumNumberOfDigits',
    'minimumNumberOfSpecialSymbols',
    'specialSymbols',
  ],
  convertCountryCode: ['outputFormat', 'inputAttributes', 'outputAttribute'],
  manipulateDate: ['sourceDateFormat', 'targetDateFormat', 'years', 'months', 'days', 'hours', 'minutes', 'seconds'],
  convertCountryRegion: ['outputFormat', 'inputAttributes', 'outputAttribute'],
  convertLocaleCode: ['outputFormat'],
  convertTimezoneCode: ['outputFormat'],
};
// Parameters the evaluator reads through `required(...)`; omitting one fails when the function runs.
export const requiredParameters = {
  replaceString: ['target', 'replacement'],
  replaceFirstString: ['regex', 'replacement'],
  replaceLastString: ['regex', 'replacement'],
  replaceAllString: ['regex', 'replacement'],
  substring: ['beginIndex'],
  splitStringToArray: ['separator'],
  elementAt: ['index'],
  getMatchedRegexGroup: ['regex', 'groupIndex'],
  matchRegex: ['regex'],
  encode: ['algorithm'],
  decode: ['algorithm'],
  compositeId: ['separator', 'subId'],
  putIfAbsent: ['key', 'defaultValue'],
  putIfPresent: ['key', 'defaultValue'],
  copyMapEntry: ['sourceKey', 'targetKey'],
  renameMapEntry: ['sourceKey', 'targetKey'],
  randomPassword: [
    'passwordLength',
    'minimumNumberOfLowercaseLetters',
    'minimumNumberOfUppercaseLetters',
    'minimumNumberOfDigits',
    'minimumNumberOfSpecialSymbols',
  ],
  convertCountryCode: ['outputFormat'],
  convertCountryRegion: ['outputFormat', 'inputAttributes', 'outputAttribute'],
  convertLocaleCode: ['outputFormat'],
  convertTimezoneCode: ['outputFormat'],
};
// Values the evaluator accepts for enumerated parameters, per function.
export const parameterEnums = {
  encode: { algorithm: ['base32', 'base64'] },
  decode: { algorithm: ['base32', 'base64'] },
  compositeId: { separator: [':'] },
  convertCountryCode: { outputFormat: ['fullName', 'alpha2', 'alpha3', 'numeric'] },
  convertCountryRegion: { outputFormat: ['fullName', 'alpha2'] },
  convertLocaleCode: { outputFormat: ['bcp47', 'iso639'] },
  convertTimezoneCode: { outputFormat: ['iana', 'sap'] },
};
// JSON type each parameter is expected to hold ('any' = no evaluator constraint).
export const parameterTypes = {
  prefix: 'string',
  suffix: 'string',
  target: 'string',
  replacement: 'string',
  regex: 'string',
  locale: 'string',
  beginIndex: 'integer',
  endIndex: 'integer',
  separator: 'string',
  index: 'integer',
  groupIndex: 'integer',
  algorithm: 'string',
  skipPadding: 'boolean',
  subId: 'string',
  key: 'string',
  defaultValue: 'any',
  sourceKey: 'string',
  targetKey: 'string',
  entityType: 'string',
  sourceSystemName: 'string',
  targetSystemName: 'string',
  passwordLength: 'integer',
  minimumNumberOfLowercaseLetters: 'integer',
  minimumNumberOfUppercaseLetters: 'integer',
  minimumNumberOfDigits: 'integer',
  minimumNumberOfSpecialSymbols: 'integer',
  specialSymbols: 'string',
  outputFormat: 'string',
  inputAttributes: 'array',
  outputAttribute: 'string',
  sourceDateFormat: 'string',
  targetDateFormat: 'string',
  years: 'integer',
  months: 'integer',
  days: 'integer',
  hours: 'integer',
  minutes: 'integer',
  seconds: 'integer',
};
export const supportedFunctions = Object.keys(functionParameters);
// Single source of truth for property names, shared by the evaluator and editor diagnostics.
export const mappingKeys = [
  'sourcePath',
  'sourcePaths',
  'targetPath',
  'sourceVariable',
  'targetVariable',
  'constant',
  'optional',
  'ignore',
  'condition',
  'preserveArrayWithSingleElement',
  'scope',
  'type',
  'defaultValue',
  'valueMappings',
  'functions',
  'correlationAttribute',
];
export const commonFunctionKeys = [
  'function',
  'type',
  'condition',
  'applyOnElements',
  'applyOnAttribute',
  'assignToAttribute',
  'applyOnJsonAttribute',
];
export const entityTypes = ['user', 'group', 'role'];
export const mappingTypes = ['set', 'remove', 'rename', 'valueMapping'];
export const contextOperations = ['createEntity', 'patchEntity', 'deleteEntity'];
export const executionModes = ['source', 'target', 'chain'];
export function detectEntityPath(data) {
  if (Array.isArray(data)) return '$';
  for (const key of ['Resources', 'resources', 'users', 'groups', 'value', 'results', 'entities'])
    if (Array.isArray(data?.[key])) return '$.' + key;
  if (Array.isArray(data?.d?.results)) return '$.d.results';
  return '$';
}
