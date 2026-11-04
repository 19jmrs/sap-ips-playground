// The editor must report an error exactly where the engine fails, for everything the editor can know without
// running the data. Every case runs through the real engine and the real editor analysis.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline } from '../src/engine/index.js';
import { analyzeTransformation } from '../src/editor/analyze.js';

const DATA = {
  in: 'abc',
  n: 5,
  a: [1, 2, 3],
  d: '2024-01-31',
  emails: [{ value: 'x@example.com', primary: true }],
  obj: { k: 1 },
};

const doc = (...mappings) => ({ user: { mappings } });
const one = (body) => doc({ sourcePath: '$.in', targetPath: '$.out', ...body });
const fn = (config, sourcePath = '$.in') => one({ sourcePath, functions: [config] });
const path = (sourcePath) => one({ sourcePath });
const target = (targetPath) => one({ targetPath });
const cond = (condition) => one({ condition });

// [name, document, fails]
const cases = [
  // source paths
  ['path: property', path('$.in'), false],
  ['path: bracket name', path("$['in']"), false],
  ['path: negative index', path('$.a[-1]'), false],
  ['path: union of indices', path('$.a[0,1]'), false],
  ['path: filter with comparison', path('$.emails[?(@.primary == true)].value'), false],
  ['path: existence filter', path('$.emails[?(@.value)].value'), false],
  ['path: recursive descent', path('$..value'), false],
  ['path: terminal length()', path('$.a.length()'), false],
  ['path: unclosed bracket', path('$.a[0'), true],
  ['path: no leading $', path('in'), true],
  ['path: unknown function', path('$.a.foo()'), true],
  ['path: step slice', path('$.a[::2]'), true],
  ['path: unsafe segment', path('$.__proto__.x'), true],
  ['path: incomplete filter condition', path('$.emails[?(@.primary == )].value'), true],
  ['path: filter directly after ..', path('$..[?(@.x)]'), true],
  ['path: legitimate name containing constructor', one({ sourcePath: '$.constructorName', optional: true }), false],
  // target paths
  ['target: nested', target('$.a.b'), false],
  ['target: bracket name', target("$['x y']"), false],
  ['target: wildcard', target('$.list[*]'), false],
  ['target: projection', target('$.emails[?(@.value)]'), false],
  ['target: missing $', target('out'), true],
  ['target: recursive descent', target('$..x'), true],
  ['target: filter with comparison', target('$.out[?(@.a == 1)]'), true],
  ['target: unsafe segment', target('$.__proto__'), true],
  ['target: empty', target(''), true],
  // conditions
  ['condition: comparison', cond('$.n > 3'), false],
  ['condition: regex literal', cond('$.in =~ /^a/'), false],
  ['condition: contains', cond('$.a contains 1'), false],
  ['condition: IN list', cond('$.in IN ["abc","d"]'), false],
  ['condition: conditional function', cond('isValidEmail($.emails[0].value)'), false],
  ['condition: negation and or', cond('!($.n == 5) || true'), false],
  ['condition: dangling operator', cond('$.n >'), true],
  ['condition: dangling and', cond('$.n == 5 &&'), true],
  ['condition: unbalanced parenthesis', cond('($.n == 5'), true],
  ['condition: unclosed string', cond('$.in == "abc'), true],
  ['condition: unknown identifier', cond('$.in == abc'), true],
  // mapping structure
  ['mapping: source and constant', one({ constant: 1 }), true],
  ['mapping: no source', doc({ targetPath: '$.out' }), true],
  ['mapping: constant only', doc({ constant: 'x', targetPath: '$.out' }), false],
  ['mapping: unknown key', one({ sourceVar: 'x' }), true],
  ['mapping: unknown type', one({ type: 'copy' }), true],
  ['mapping: optional not boolean', one({ optional: 'yes' }), true],
  ['mapping: invalid scope value', one({ scope: 'createUser' }), true],
  [
    'mapping: functions on remove',
    doc({ type: 'remove', targetPath: '$.out', functions: [{ function: 'toString' }] }),
    true,
  ],
  ['mapping: valueMapping without tuples', doc({ type: 'valueMapping', targetPath: '$.out' }), true],
  [
    'mapping: valueMapping complete',
    doc({
      type: 'valueMapping',
      sourcePaths: ['$.in'],
      targetPath: '$.out',
      valueMappings: [{ key: ['abc'], mappedValue: 'x' }],
    }),
    false,
  ],
  ['mapping: targetVariable only', doc({ sourcePath: '$.in', targetVariable: 'v' }), false],
  ['mapping: neither target nor variable', doc({ sourcePath: '$.in' }), true],
  ['mapping: functions not an array', one({ functions: { function: 'toString' } }), true],
  ['section: skipOperations', { user: { skipOperations: ['x'], mappings: [] } }, true],
  ['section: mappings not an array', { user: { mappings: {} } }, true],
  // The evaluator validates a mapping before it decides to skip it, but does not read an ignored mapping's paths.
  ['mapping: ignored with unknown type', one({ ignore: true, type: 'bogus' }), true],
  [
    'mapping: ignored with misplaced key for its type',
    doc({ ignore: true, type: 'remove', targetPath: '$.o', sourcePath: '$.in' }),
    true,
  ],
  ['mapping: ignored with invalid source path', one({ ignore: true, sourcePath: '$.a[0' }), false],
  ['mapping: remove with a source path', doc({ type: 'remove', targetPath: '$.out', sourcePath: '$.in' }), true],
  [
    'mapping: valueMapping key arity mismatch',
    doc({
      type: 'valueMapping',
      sourcePaths: ['$.in', '$.in'],
      targetPath: '$.out',
      valueMappings: [{ key: ['abc'], mappedValue: 1 }],
    }),
    true,
  ],
  [
    'mapping: valueMapping entry without mappedValue',
    doc({ type: 'valueMapping', sourcePaths: ['$.in'], targetPath: '$.out', valueMappings: [{ key: ['abc'] }] }),
    true,
  ],
  // functions: parameters and enums
  ['fn: concatString', fn({ function: 'concatString', prefix: 'a' }), false],
  ['fn: unknown function', fn({ function: 'reverseString' }), true],
  ['fn: unknown parameter', fn({ function: 'toString', foo: 1 }), true],
  ['fn: replaceString complete', fn({ function: 'replaceString', target: 'a', replacement: 'b' }), false],
  ['fn: replaceString missing replacement', fn({ function: 'replaceString', target: 'a' }), true],
  ['fn: substring complete', fn({ function: 'substring', beginIndex: 1 }), false],
  ['fn: substring missing beginIndex', fn({ function: 'substring' }), true],
  ['fn: substring end before begin', fn({ function: 'substring', beginIndex: 2, endIndex: 1 }), true],
  ['fn: substring non-numeric beginIndex', fn({ function: 'substring', beginIndex: 'x' }), true],
  ['fn: encode base64', fn({ function: 'encode', algorithm: 'base64' }), false],
  ['fn: encode missing algorithm', fn({ function: 'encode' }), true],
  ['fn: encode unsupported algorithm', fn({ function: 'encode', algorithm: 'base16' }), true],
  ['fn: convertCountryCode bad format', fn({ function: 'convertCountryCode', outputFormat: 'iso' }, '$.in'), true],
  ['fn: convertCountryCode missing format', fn({ function: 'convertCountryCode' }), true],
  ['fn: compositeId complete', fn({ function: 'compositeId', separator: ':', subId: 'x' }), false],
  ['fn: compositeId bad separator', fn({ function: 'compositeId', separator: '|', subId: 'x' }), true],
  ['fn: compositeId bad subId path', fn({ function: 'compositeId', separator: ':', subId: '$.a[0' }), true],
  ['fn: elementAt complete', fn({ function: 'elementAt', index: 1 }, '$.a'), false],
  ['fn: elementAt missing index', fn({ function: 'elementAt' }, '$.a'), true],
  ['fn: function and type conflict', fn({ function: 'toString', type: 'concatString' }), true],
  ['fn: applyOnElements not boolean', fn({ function: 'toString', applyOnElements: 'yes' }), true],
  ['fn: assignToAttribute without applyOnAttribute', fn({ function: 'toString', assignToAttribute: 'x' }), true],
  ['fn: function condition incomplete', fn({ function: 'toString', condition: '$.n ==' }), true],
  ['fn: unsafe key parameter', fn({ function: 'putIfAbsent', key: '__proto__', defaultValue: 1 }, '$.obj'), true],
  // functions: regular expressions
  ['regex: group', fn({ function: 'getMatchedRegexGroup', regex: '(b)', groupIndex: 1 }), false],
  ['regex: inline flag', fn({ function: 'matchRegex', regex: '(?i)ABC' }), false],
  ['regex: unicode class', fn({ function: 'matchRegex', regex: '\\p{Alpha}+' }), false],
  ['regex: unbalanced group', fn({ function: 'matchRegex', regex: '(' }), true],
  ['regex: lookbehind', fn({ function: 'matchRegex', regex: '(?<=a)b' }), true],
  ['regex: possessive quantifier', fn({ function: 'matchRegex', regex: 'a++' }), true],
  ['regex: negative lookahead', fn({ function: 'matchRegex', regex: '(?!x)' }), true],
  [
    'regex: replaceAll with group reference',
    fn({ function: 'replaceAllString', regex: '(b)', replacement: '<$1>' }),
    false,
  ],
  // functions: dates
  [
    'date: reformat',
    fn({ function: 'manipulateDate', sourceDateFormat: 'yyyy-MM-dd', targetDateFormat: 'dd/MM/yyyy', days: 1 }, '$.d'),
    false,
  ],
  [
    'date: shift hours on a date-only source',
    fn({ function: 'manipulateDate', sourceDateFormat: 'yyyy-MM-dd', hours: 1 }, '$.d'),
    true,
  ],
  [
    'date: target needs a field the source lacks',
    fn({ function: 'manipulateDate', sourceDateFormat: 'yyyy-MM-dd', targetDateFormat: 'HH:mm' }, '$.d'),
    true,
  ],
  [
    'date: unknown pattern letter',
    fn({ function: 'manipulateDate', sourceDateFormat: 'yyyy-MM-dd', targetDateFormat: 'yyyy-QQ' }, '$.d'),
    true,
  ],
  [
    'date: amount not an integer',
    fn({ function: 'manipulateDate', sourceDateFormat: 'yyyy-MM-dd', days: 1.5 }, '$.d'),
    true,
  ],
  // functions: password
  [
    'password: valid constraints',
    doc({
      targetPath: '$.out',
      functions: [
        {
          function: 'randomPassword',
          passwordLength: 12,
          minimumNumberOfLowercaseLetters: 2,
          minimumNumberOfUppercaseLetters: 2,
          minimumNumberOfDigits: 2,
          minimumNumberOfSpecialSymbols: 1,
        },
      ],
    }),
    false,
  ],
  [
    'password: minimums exceed length',
    doc({
      targetPath: '$.out',
      functions: [
        {
          function: 'randomPassword',
          passwordLength: 3,
          minimumNumberOfLowercaseLetters: 2,
          minimumNumberOfUppercaseLetters: 2,
          minimumNumberOfDigits: 2,
          minimumNumberOfSpecialSymbols: 1,
        },
      ],
    }),
    true,
  ],
];

const errorsOf = (document) =>
  analyzeTransformation(JSON.stringify(document, null, 2)).filter((found) => found.severity === 'error');

for (const [name, document, fails] of cases) {
  test(`parity: ${name}`, () => {
    const entity = runPipeline({ data: DATA, source: document, mode: 'source' }).entities[0];
    assert.equal(
      Boolean(entity.error),
      fails,
      `the case table says the engine ${fails ? 'fails' : 'succeeds'}; it ${entity.error ? `failed: ${entity.error}` : 'succeeded'}`,
    );
    const found = errorsOf(document);
    assert.equal(
      found.length > 0,
      fails,
      fails
        ? 'the engine fails but the editor reports no error'
        : `the engine succeeds but the editor reports: ${found.map((item) => item.message).join(' | ')}`,
    );
  });
}

test('parity corpus is large enough to matter', () => {
  assert.ok(cases.length >= 60, `${cases.length} cases`);
});

// ---- import graph --------------------------------------------------------------------------------------------

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const FORBIDDEN_FILES = [
  'engine/index.js',
  'engine/pipeline.js',
  'engine/functions/countries.js',
  'engine/functions/conversions.js',
  'engine/functions/index.js',
  'engine/timezones.json',
];
const FORBIDDEN_PACKAGES = ['i18n-iso-countries', 'country-region-data', 'jsonpath-plus'];

function importsOf(file) {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(/(?:import|export)\s[^'";]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g)].map(
    (match) => match[1] ?? match[2],
  );
}

test('the editor cannot reach the evaluator barrel, datasets or heavy packages', () => {
  const seen = new Set();
  const queue = ['editor/analyze.js', 'editor/completions.js', 'editor/hover.js', 'editor/syntax.js'].map((file) =>
    resolve(root, file),
  );
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !file.endsWith('.js')) continue;
    seen.add(file);
    for (const specifier of importsOf(file)) {
      if (!specifier.startsWith('.')) {
        assert.ok(!FORBIDDEN_PACKAGES.includes(specifier), `${file} imports ${specifier}`);
        continue;
      }
      const resolved = resolve(dirname(file), specifier);
      const relative = resolved.slice(root.length + 1).replaceAll('\\', '/');
      assert.ok(!FORBIDDEN_FILES.includes(relative), `${file} imports ${relative}`);
      queue.push(resolved);
    }
  }
  assert.ok(seen.size > 8, 'the walk should have visited the editor and engine validators');
});
