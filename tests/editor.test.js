import test from 'node:test';
import assert from 'node:assert/strict';
import { examples } from '../src/examples.js';
import { runPipeline } from '../src/engine/index.js';
import { functionParameters, parameterEnums, requiredParameters } from '../src/engine/catalog.js';
import { analyze, analyzeContext, analyzeExpression, analyzeTransformation } from '../src/editor/analyze.js';
import { completionsAt } from '../src/editor/completions.js';
import { hoverAt } from '../src/editor/hover.js';
import { parseJson } from '../src/editor/json.js';
import { shapeOf } from '../src/editor/paths.js';

const mapping = (body) => JSON.stringify({ user: { mappings: [{ targetPath: '$.out', ...body }] } }, null, 2);
const withFunction = (fn) => mapping({ sourcePath: '$.in', functions: [fn] });

// Diagnostics as { severity, code, text } where text is exactly the highlighted source substring.
function diagnose(text, analyzer = analyzeTransformation) {
  return analyzer(text).map(({ from, to, severity, code, message }) => ({
    severity,
    code,
    text: text.slice(from, to),
    message,
  }));
}
const errors = (found) => found.filter((item) => item.severity === 'error');

// Completion at the `|` marker.
function complete(kind, marked, config = {}) {
  const pos = marked.indexOf('|');
  const text = marked.replace('|', '');
  const found = completionsAt(kind, text, pos, config);
  return (
    found && { ...found, replaced: text.slice(found.from, found.to), labels: found.options.map((item) => item.label) }
  );
}

const payload = {
  Resources: [
    {
      id: '1',
      userName: 'alex',
      'urn:ietf:params:scim:schemas:core:2.0:User': { x: 1 },
      emails: [{ value: 'a@example.com', primary: true }],
    },
    { id: '2', userName: 'sam', nickName: 'sammy', emails: [] },
  ],
};

test('diagnostic ranges select the exact offending substring', () => {
  const cases = [
    [mapping({ sourcePath: '$.a', bogus: true }), 'unknown-key', '"bogus"'],
    [mapping({ sourcePath: 'userName' }), 'jsonpath-start', 'userName'],
    [mapping({ sourcePath: '$.a[?(@.b == 1' }), 'jsonpath-filter', '[?(@.b == 1'],
    [mapping({ sourcePath: '$.a', type: 'upsert' }), 'mapping-type', '"upsert"'],
    [mapping({ sourcePath: '$.a', optional: 'yes' }), 'type-boolean', '"yes"'],
    [mapping({ sourcePath: '$.a', condition: '($.a == 1' }), 'condition-syntax', '('],
    [mapping({ sourcePath: '$.a', condition: '$.a == "x' }), 'condition-syntax', '\\"x'],
    [mapping({ sourcePath: '$.a', condition: '$.a = 1' }), 'condition-syntax', '='],
    [mapping({ sourcePath: '$.a', condition: '$.a == yes' }), 'condition-syntax', 'yes'],
    [mapping({ sourcePath: '$.a', condition: '$.a =~ "x"' }), 'condition-syntax', '\\"x\\"'],
    [mapping({ sourcePath: '$.a', constant: 1 }), 'source-count', '"constant"'],
    [
      mapping({ sourcePath: '$.a', type: 'remove', functions: [{ function: 'toString' }] }),
      'functions-on-type',
      '"functions"',
    ],
    [mapping({ sourcePath: '$.a', functions: [{ function: 'toLowerCase' }] }), 'unknown-function', '"toLowerCase"'],
    [mapping({ sourcePath: '$.a', functions: [{ function: 'toString', prefix: 'x' }] }), 'unknown-key', '"prefix"'],
    [JSON.stringify({ user: { mappings: [], skipOperations: ['create'] } }), 'skip-operations', '"skipOperations"'],
  ];
  for (const [text, code, expected] of cases) {
    const hit = diagnose(text).find((item) => item.code === code);
    assert.ok(hit, `${code} expected for ${expected}`);
    assert.equal(hit.text, expected, code);
  }
});

test('ranges stay exact when the string contains escapes', () => {
  const text = '{"user":{"mappings":[{"sourcePath":"$.a","targetPath":"$.t","condition":"$.a == \\"x\\" && # 1"}]}}';
  const hit = diagnose(text).find((item) => item.code === 'condition-syntax');
  assert.equal(hit?.text, '#');
});

test('missing properties are reported on the object brace, not offset 0', () => {
  const text = `{\n  "user": {\n    "mappings": [\n      { "optional": true }\n    ]\n  }\n}`;
  const found = analyzeTransformation(text).filter((item) => ['source-count', 'missing-target'].includes(item.code));
  assert.equal(found.length, 2);
  for (const item of found) assert.equal(text.slice(item.from, item.to), '{');
  assert.ok(found.every((item) => item.from === text.indexOf('{ "optional"')));
});

test('target path rules distinguish what the evaluator can write', () => {
  const ok = ['$.a', '$.a.b[0]', "$['a b'].c", '$.a[*].b', '$.emails[?(@.value)].x', '$'];
  for (const path of ok) assert.deepEqual(errors(diagnose(mapping({ sourcePath: '$.a', targetPath: path }))), [], path);
  const bad = ['$.a[*].b[*]', '$.a[?(@.x == 1)]', '$.a..b', 'a.b', '$.a[1:2]'];
  for (const path of bad)
    assert.ok(
      errors(diagnose(mapping({ sourcePath: '$.a', targetPath: path }))).some((item) => /target/.test(item.code)),
      path,
    );
  // remove accepts wildcard paths, rename does not.
  assert.deepEqual(errors(diagnose(mapping({ type: 'remove', targetPath: '$.a[*].b' }))), []);
  assert.ok(errors(diagnose(mapping({ type: 'rename', targetPath: '$.a[*].b', constant: 'n' }))).length);
});

test('mapping type requirements follow the evaluator', () => {
  const codes = (body) => errors(diagnose(mapping(body))).map((item) => item.code);
  assert.ok(codes({ type: 'rename', targetPath: '$.a' }).includes('missing-constant'));
  assert.ok(codes({ type: 'rename', targetPath: '$.a', constant: 5 }).includes('rename-constant'));
  assert.ok(codes({ type: 'valueMapping', targetPath: '$.a' }).includes('value-mapping'));
  assert.ok(codes({ sourcePath: '$.a', sourcePaths: ['$.b'] }).includes('needs-value-mapping'));
  // An ignored mapping is still validated: the evaluator rejects a key its type does not act on.
  assert.deepEqual(codes({ sourcePath: '$.a', ignore: true, type: 'valueMapping' }), ['type-key']);
  assert.deepEqual(codes({ sourcePath: '$.a', ignore: true, type: 'bogus' }), ['mapping-type']);
  assert.deepEqual(codes({ sourcePath: '$.a[0', ignore: true }), []);
  const compact = JSON.stringify({
    user: {
      mappings: [
        {
          type: 'valueMapping',
          targetPath: '$.t',
          sourcePaths: ['$.a', '$.b'],
          valueMappings: [{ key: ['x'], mappedValue: 1 }],
        },
      ],
    },
  });
  const arity = diagnose(compact).find((item) => item.code === 'value-mapping-arity');
  assert.equal(arity?.severity, 'error');
  assert.equal(arity?.text, '["x"]');
  // Only a leading randomPassword may omit the source.
  assert.deepEqual(
    codes({
      functions: [
        {
          function: 'randomPassword',
          passwordLength: 8,
          minimumNumberOfLowercaseLetters: 1,
          minimumNumberOfUppercaseLetters: 1,
          minimumNumberOfDigits: 1,
          minimumNumberOfSpecialSymbols: 0,
        },
      ],
    }),
    [],
  );
  assert.ok(codes({ functions: [{ function: 'toString' }] }).includes('source-count'));
  assert.ok(codes({ sourcePath: '$.a', targetPath: undefined }).includes('missing-target'));
});

// Sample valid parameters per function, plus an input that reaches the parameter checks in the evaluator.
const fixtures = {
  concatString: { input: 'a', params: { prefix: 'p' } },
  replaceString: { input: 'abc', params: { target: 'a', replacement: 'b' } },
  replaceFirstString: { input: 'abc', params: { regex: 'a', replacement: 'b' } },
  replaceLastString: { input: 'abc', params: { regex: 'a', replacement: 'b' } },
  replaceAllString: { input: 'abc', params: { regex: 'a', replacement: 'b' } },
  toUpperCaseString: { input: 'abc', params: {} },
  toLowerCaseString: { input: 'ABC', params: {} },
  substring: { input: 'abc', params: { beginIndex: 0, endIndex: 2 } },
  splitStringToArray: { input: 'a,b', params: { separator: ',' } },
  elementAt: { input: [1, 2], params: { index: 0 } },
  toString: { input: 'abc', params: {} },
  getMatchedRegexGroup: { input: 'abc', params: { regex: '(a)', groupIndex: 1 } },
  matchRegex: { input: 'abc', params: { regex: 'a' } },
  encode: { input: 'abc', params: { algorithm: 'base64' } },
  decode: { input: 'YWJj', params: { algorithm: 'base64' } },
  compositeId: { input: 'a', params: { separator: ':', subId: 'b' } },
  putIfAbsent: { input: { a: 1 }, params: { key: 'k', defaultValue: 1 } },
  putIfPresent: { input: { a: 1 }, params: { key: 'a', defaultValue: 2 } },
  copyMapEntry: { input: { a: 1 }, params: { sourceKey: 'a', targetKey: 'b' } },
  renameMapEntry: { input: { a: 1 }, params: { sourceKey: 'a', targetKey: 'b' } },
  resolveEntityIds: { input: 'a', params: {}, context: { resolutions: { user: { a: 'b' } } } },
  randomPassword: {
    input: 'x',
    params: {
      passwordLength: 8,
      minimumNumberOfLowercaseLetters: 1,
      minimumNumberOfUppercaseLetters: 1,
      minimumNumberOfDigits: 1,
      minimumNumberOfSpecialSymbols: 1,
    },
  },
  convertCountryCode: { input: 'DE', params: { outputFormat: 'alpha3' } },
  manipulateDate: { input: '2020-01-02 03:04:05.006', params: { days: 1 } },
  convertCountryRegion: {
    input: { country: 'DE', region: 'BE' },
    params: { outputFormat: 'alpha2', inputAttributes: ['country', 'region'], outputAttribute: 'r' },
  },
  convertLocaleCode: { input: 'EN', params: { outputFormat: 'bcp47' }, context: { localeMappings: [['EN', 'en-US']] } },
  convertTimezoneCode: { input: 'CET', params: { outputFormat: 'iana' } },
};

function runEngine(name, params, fixture) {
  const doc = {
    user: { mappings: [{ constant: fixture.input, targetPath: '$.out', functions: [{ function: name, ...params }] }] },
  };
  return runPipeline({ data: {}, source: doc, mode: 'source', context: fixture.context ?? {} }).entities[0];
}

test('fixtures cover every catalog function and are accepted by both engine and editor', () => {
  assert.deepEqual(Object.keys(fixtures).sort(), Object.keys(functionParameters).sort());
  for (const [name, fixture] of Object.entries(fixtures)) {
    const result = runEngine(name, fixture.params, fixture);
    assert.equal(result.error, undefined, `${name}: ${result.error}`);
    const doc = JSON.stringify(
      {
        user: {
          mappings: [
            { constant: fixture.input, targetPath: '$.out', functions: [{ function: name, ...fixture.params }] },
          ],
        },
      },
      null,
      1,
    );
    assert.deepEqual(errors(diagnose(doc)), [], name);
  }
});

test('requiredParameters matches the evaluator: omitting any one fails in the engine and in the editor', () => {
  for (const [name, required] of Object.entries(requiredParameters)) {
    const fixture = fixtures[name];
    for (const missing of required) {
      const params = Object.fromEntries(Object.entries(fixture.params).filter(([key]) => key !== missing));
      const result = runEngine(name, params, fixture);
      assert.match(
        result.error ?? '',
        new RegExp(`requires ${missing}|requires`),
        `${name} without ${missing} should fail in the engine`,
      );
      const hit = diagnose(withFunction({ function: name, ...params })).find(
        (item) => item.code === 'required-parameter',
      );
      assert.ok(hit, `${name} without ${missing}`);
      assert.equal(hit.severity, 'error');
      assert.match(hit.message, new RegExp(`"${missing}"`));
      assert.equal(hit.text, `"${name}"`);
    }
    // Optional parameters the evaluator tolerates missing never raise a required-parameter error.
    const optional = functionParameters[name].filter((key) => !required.includes(key));
    for (const key of optional) {
      const params = Object.fromEntries(Object.entries(fixture.params).filter(([k]) => k !== key));
      assert.equal(
        diagnose(withFunction({ function: name, ...params })).filter((item) => item.code === 'required-parameter')
          .length,
        0,
        `${name}/${key}`,
      );
    }
  }
});

test('enumerated parameter values are rejected like the evaluator rejects them', () => {
  for (const [name, enums] of Object.entries(parameterEnums)) {
    for (const [key, allowed] of Object.entries(enums)) {
      for (const value of allowed) {
        const params = { ...fixtures[name].params, [key]: value };
        assert.deepEqual(errors(diagnose(withFunction({ function: name, ...params }))), [], `${name}.${key}=${value}`);
      }
      const params = { ...fixtures[name].params, [key]: 'bogus' };
      assert.ok(runEngine(name, params, fixtures[name]).error, `engine rejects ${name}.${key}`);
      const hit = diagnose(withFunction({ function: name, ...params })).find((item) => item.code === 'enum-value');
      assert.equal(hit?.text, '"bogus"', `${name}.${key}`);
      assert.match(hit.message, new RegExp(`"${allowed[0]}"`));
    }
  }
});

test('function-specific value rules', () => {
  const fn = (body) => diagnose(withFunction(body));
  assert.equal(
    fn({ function: 'substring', beginIndex: '1' }).find((item) => item.code === 'type-integer')?.text,
    '"1"',
  );
  assert.ok(fn({ function: 'substring', beginIndex: 3, endIndex: 1 }).some((item) => item.code === 'substring-range'));
  assert.ok(
    fn({ function: 'replaceAllString', regex: '(?!x)', replacement: '' }).some((item) => item.code === 'regex'),
  );
  assert.ok(fn({ function: 'matchRegex', regex: '(' }).some((item) => item.code === 'regex'));
  assert.ok(
    fn({ function: 'manipulateDate', sourceDateFormat: 'yyyy-MM-dd hh' }).some((item) => item.code === 'date-format'),
  );
  assert.ok(fn({ function: 'manipulateDate', days: 1.5 }).some((item) => item.code === 'type-integer'));
  assert.ok(fn({ function: 'compositeId', separator: '-', subId: 'x' }).some((item) => item.code === 'enum-value'));
  assert.ok(fn({ function: 'toString', assignToAttribute: 'x' }).some((item) => item.code === 'function-attribute'));
  assert.ok(fn({ function: 'toString', applyOnElements: 'yes' }).some((item) => item.code === 'type-boolean'));
  assert.ok(fn({ function: 'toString', type: 'matchRegex' }).some((item) => item.code === 'function-conflict'));
  assert.ok(fn({ function: 'toString', condition: '$.a ==' }).some((item) => item.code === 'condition-syntax'));
  assert.ok(
    fn({
      function: 'convertCountryRegion',
      outputFormat: 'alpha2',
      inputAttributes: ['country'],
      outputAttribute: 'r',
    }).some((item) => item.code === 'input-attributes'),
  );
  const password = (extra) =>
    fn({
      function: 'randomPassword',
      passwordLength: 4,
      minimumNumberOfLowercaseLetters: 1,
      minimumNumberOfUppercaseLetters: 1,
      minimumNumberOfDigits: 1,
      minimumNumberOfSpecialSymbols: 1,
      ...extra,
    }).filter((item) => item.code === 'password-length');
  assert.equal(password({}).length, 0);
  assert.equal(password({ passwordLength: 3 }).length, 1);
  assert.equal(password({ specialSymbols: '' }).length, 1);
  assert.equal(
    password({
      minimumNumberOfLowercaseLetters: 0,
      minimumNumberOfUppercaseLetters: 0,
      minimumNumberOfDigits: 0,
      minimumNumberOfSpecialSymbols: 0,
    }).length,
    1,
  );
  // The engine fails on the same inputs.
  assert.ok(
    runEngine('randomPassword', { ...fixtures.randomPassword.params, passwordLength: 3 }, fixtures.randomPassword)
      .error,
  );
});

test('conditions: valid forms pass, invalid forms give one precise error', () => {
  const valid = [
    '$.active == true',
    '$.name.givenName =~ /^A.*/i && !($.emails size 0)',
    '$.emails[?(@.primary == true)].value contains "a@example.com"',
    '$.roles anyof ["admin", "owner"] || $.x empty true',
    'isValidEmail($.emails[0].value) && isAttributeWithOptionalPrefix($.id, ips.prefix)',
    '$.a.length() > 2',
    '$.id == "${entityIdSourceSystem}" && $.x == %prop%',
    '@.value == 1',
  ];
  for (const condition of valid)
    assert.deepEqual(
      diagnose(mapping({ sourcePath: '$.a', condition })).filter((item) => item.severity === 'error'),
      [],
      condition,
    );
  const invalid = [
    ['$.a == 1 &&', 'condition-syntax'],
    ['($.a == 1', 'condition-syntax'],
    ['$.a == 1)', 'condition-syntax'],
    ['$.a == [1, 2', 'condition-syntax'],
    ['$.a =~ /abc', 'condition-syntax'],
    ['$.a =~ /(/', 'condition-regex'],
    ['$.a =~ /(?!x)/', 'condition-regex'],
    ['$.a == 1 $.b', 'condition-syntax'],
    ['', 'condition-syntax'],
  ];
  for (const [condition, code] of invalid) {
    const found = errors(diagnose(mapping({ sourcePath: '$.a', condition })));
    assert.equal(found.length, 1, condition);
    assert.equal(found[0].code, code, condition);
  }
  // The evaluator accepts these syntactically but fails when it reaches them: warnings, not errors.
  const unknown = diagnose(mapping({ sourcePath: '$.a', condition: 'isAdmin($.a)' }));
  assert.deepEqual(
    unknown.map((item) => [item.severity, item.text]),
    [['warning', 'isAdmin']],
  );
  assert.equal(diagnose(mapping({ sourcePath: '$.a', condition: 'isRegularGroup($.a)' }))[0].severity, 'warning');
});

test('conditions in JSONPath filters are checked in place', () => {
  const found = diagnose(mapping({ sourcePath: '$.emails[?(@.primary == )].value' }));
  assert.equal(found[0].code, 'condition-syntax');
  assert.equal(found[0].severity, 'error');
  assert.deepEqual(diagnose(mapping({ sourcePath: '$.emails[?(@.primary == true)].value' })), []);
  assert.equal(diagnose(mapping({ sourcePath: '$.a.foo()' }))[0].code, 'jsonpath-function');
  assert.deepEqual(diagnose(mapping({ sourcePath: '$.a.length()' })), []);
  assert.equal(diagnose(mapping({ sourcePath: '$.a[0' }))[0].severity, 'error');
  assert.equal(diagnose(mapping({ sourcePath: '$.__proto__.a' }))[0].code, 'jsonpath-unsafe');
});

test('document structure: sections, flat documents and entity keys', () => {
  assert.equal(diagnose('[]')[0].code, 'document-type');
  assert.equal(diagnose('{"usr":{"mappings":[]},"user":{"mappings":[]}}')[0].text, '"usr"');
  assert.deepEqual(errors(diagnose('{"mappings":[{"sourcePath":"$.a","targetPath":"$.b"}]}')), []);
  assert.equal(diagnose('{"user":{}}')[0].code, 'missing-mappings');
  assert.equal(diagnose('{"user":{"mappings":{}}}')[0].text, '{}');
  assert.equal(diagnose('{"user":{"ignore":true}}').length, 0);
  assert.equal(diagnose('{"user":{"mappings":[],"condition":"$.a =="}}')[0].code, 'condition-syntax');
  assert.equal(diagnose('{"user":{"mappings":[1]}}')[0].text, '1');
  const duplicate = diagnose('{"user":{"mappings":[{"sourcePath":"$.a","sourcePath":"$.b","targetPath":"$.c"}]}}')[0];
  assert.equal(duplicate.code, 'duplicate-key');
  assert.equal(duplicate.severity, 'warning');
});

test('shipped examples produce no diagnostics at all', () => {
  for (const example of examples) {
    for (const stage of ['source', 'target']) {
      for (const spacing of [0, 2]) {
        const text = JSON.stringify(example[stage], null, spacing);
        assert.deepEqual(analyze('transformation', text), [], `${example.id}/${stage}`);
      }
    }
    assert.deepEqual(analyze('context', JSON.stringify(example.context, null, 2)), [], example.id);
  }
});

test('runtime context diagnostics', () => {
  const ctx = (value) => diagnose(JSON.stringify(value, null, 1), analyzeContext);
  assert.deepEqual(
    ctx({
      variables: { a: 1 },
      properties: { 'ips.application.id': 'x' },
      operation: 'createEntity',
      resolutions: { user: { a: 'b' } },
      localeMappings: [['EN', 'en-US']],
    }),
    [],
  );
  assert.deepEqual(
    ctx({ variables: [] }).map((item) => [item.severity, item.text]),
    [['error', '[]']],
  );
  assert.deepEqual(
    ctx({ operation: 'create' }).map((item) => [item.severity, item.text]),
    [['error', '"create"']],
  );
  assert.deepEqual(
    ctx({ variable: {} }).map((item) => [item.severity, item.text]),
    [['warning', '"variable"']],
  );
  assert.match(ctx({ variable: {} })[0].message, /variables/);
  assert.equal(ctx({ localeMappings: [['EN']] })[0].severity, 'warning');
  assert.equal(diagnose('[]', analyzeContext)[0].code, 'document-type');
});

test('expression diagnostics: path vs condition, warnings when the kind is unknown', () => {
  const expr = (text) => diagnose(text, analyzeExpression);
  assert.deepEqual(expr('$.Resources[*].userName'), []);
  assert.deepEqual(expr('  $.a[?(@.b == 1)].c  '), []);
  assert.deepEqual(expr('$.a == true && $.b size 2'), []);
  assert.deepEqual(expr(''), []);
  assert.deepEqual(
    expr('userName').map((item) => [item.severity, item.code]),
    [['warning', 'condition-syntax']],
  );
  assert.deepEqual(
    expr('$.a[?(@.b ==)]').map((item) => item.severity),
    ['error'],
  );
  const open = expr('$.a == (1');
  assert.deepEqual(
    open.map((item) => [item.severity, item.text]),
    [['warning', '(']],
  );
});

// ---- completion ------------------------------------------------------------------------------------------------

test('completion inside objects offers only valid, absent keys for that object', () => {
  const mappingDoc = (inner) => `{"user":{"mappings":[{${inner}}]}}`;
  const keys = complete('transformation', mappingDoc('"sourcePath": "$.id", | '));
  assert.ok(!keys.labels.includes('sourcePath'));
  assert.ok(!keys.labels.includes('constant'), 'only one source key per mapping');
  assert.ok(!keys.labels.includes('sourcePaths'), 'valueMapping keys are not offered for set');
  assert.ok(keys.labels.includes('targetPath') && keys.labels.includes('functions'));
  assert.equal(keys.options.find((item) => item.label === 'targetPath').insert, '"targetPath": ');
  const valueMapping = complete('transformation', mappingDoc('"type": "valueMapping", | '));
  assert.ok(valueMapping.labels.includes('sourcePaths') && valueMapping.labels.includes('valueMappings'));
  assert.ok(!valueMapping.labels.includes('sourcePath') && !valueMapping.labels.includes('functions'));
  const partial = complete('transformation', mappingDoc('"tar|"'));
  assert.equal(partial.replaced, '"tar"');
  assert.deepEqual(partial.labels, ['targetPath', 'targetVariable']);
  assert.equal(partial.options[0].insert, '"targetPath": ', 'a key without a colon is completed together with it');
  const section = complete('transformation', '{"user":{ | }}');
  assert.ok(section.labels.includes('mappings') && !section.labels.includes('skipOperations'));
  assert.deepEqual(complete('transformation', '{ | }').labels.slice(0, 3), ['user', 'group', 'role']);
  assert.deepEqual(complete('transformation', '{"user":{},|}').labels, ['group', 'role']);
});

test('completion inside a function object is specific to that function', () => {
  const doc = (fn) => `{"user":{"mappings":[{"sourcePath":"$.a","functions":[{${fn}}]}]}}`;
  const replace = complete('transformation', doc('"function": "replaceString", | '));
  assert.deepEqual(replace.labels.slice(0, 2), ['target', 'replacement']);
  assert.ok(!replace.labels.includes('beginIndex') && !replace.labels.includes('function'));
  assert.ok(replace.labels.includes('applyOnElements') && replace.labels.includes('condition'));
  assert.match(replace.options[0].detail, /replaceString\(target, replacement\)/);
  const none = complete('transformation', doc('| '));
  assert.ok(none.labels.includes('function'));
  assert.ok(!none.labels.includes('target'), 'parameters wait for a function name');
  const substring = complete('transformation', doc('"function": "substring", "beginIndex": 1, | '));
  assert.ok(substring.labels.includes('endIndex') && !substring.labels.includes('beginIndex'));
});

test('completion of values: function names, mapping types, enums, scopes, booleans', () => {
  const fnDoc = (inner) => `{"user":{"mappings":[{"sourcePath":"$.a","functions":[{${inner}}]}]}}`;
  const names = complete('transformation', fnDoc('"function": "|"'));
  assert.equal(names.labels.length, Object.keys(functionParameters).length);
  const filtered = complete('transformation', fnDoc('"function": "replaceA|"'));
  assert.deepEqual(filtered.labels, ['replaceAllString']);
  assert.equal(filtered.replaced, 'replaceA');
  assert.deepEqual(complete('transformation', fnDoc('"function": "convertCountryCode", "outputFormat": "|"')).labels, [
    'fullName',
    'alpha2',
    'alpha3',
    'numeric',
  ]);
  assert.deepEqual(complete('transformation', fnDoc('"function": "encode", "algorithm": "b|"')).labels, [
    'base32',
    'base64',
  ]);
  assert.deepEqual(
    complete('transformation', fnDoc('"function": "convertTimezoneCode", "outputFormat": |')).options.map(
      (item) => item.insert,
    ),
    ['"iana"', '"sap"'],
  );
  assert.deepEqual(complete('transformation', '{"user":{"mappings":[{"type": "|"}]}}').labels, [
    'set',
    'remove',
    'rename',
    'valueMapping',
  ]);
  assert.deepEqual(complete('transformation', '{"user":{"mappings":[{"scope": "p|"}]}}').labels, ['patchEntity']);
  assert.deepEqual(complete('transformation', '{"user":{"mappings":[{"optional": |}]}}').labels, ['true', 'false']);
  assert.deepEqual(
    complete('transformation', '{"user":{"mappings":[{"optional": t|}]}}').options.map((item) => item.insert),
    ['true'],
  );
  assert.equal(complete('transformation', '{"user":{"mappings":[{"sourcePath": |}]}}'), null);
  const insert = complete('transformation', '{"user":{"mappings":[{"functions":[ | ]}]}}');
  assert.equal(insert.options.find((item) => item.label === 'substring').insert, '{ "function": "substring" }');
});

test('completion in the runtime context editor', () => {
  assert.deepEqual(complete('context', '{ | }').labels, [
    'variables',
    'properties',
    'operation',
    'resolutions',
    'localeMappings',
  ]);
  assert.deepEqual(complete('context', '{ "variables": {}, | }').labels, [
    'properties',
    'operation',
    'resolutions',
    'localeMappings',
  ]);
  assert.deepEqual(complete('context', '{ "operation": "|" }').labels, ['createEntity', 'patchEntity', 'deleteEntity']);
  assert.ok(complete('context', '{ "variables": { | } }').labels.includes('entityIdTargetSystem'));
  assert.ok(complete('context', '{ "properties": { "|" } }').labels.includes('ips.application.id'));
  assert.equal(complete('context', '{ "operation": "createEntity", "variables": { "a": "|" } }'), null);
});

test('completion in condition strings and expression mode', () => {
  const inCondition = complete('transformation', '{"user":{"mappings":[{"condition": "$.a e|"}]}}');
  assert.deepEqual(inCondition.labels, ['empty']);
  assert.equal(inCondition.replaced, 'e');
  const functions = complete('expression', 'isRe|');
  assert.deepEqual(functions.labels, ['isRegularGroup']);
  assert.equal(functions.options[0].insert, 'isRegularGroup(');
  const operators = complete('expression', '$.a |', { explicit: true });
  assert.ok(['==', '&&', 'contains', 'in'].every((label) => operators.labels.includes(label)));
  assert.equal(complete('expression', '$.a |'), null, 'nothing is offered unprompted after whitespace');
  assert.equal(complete('expression', '$.a == "e|"'), null, 'no operators inside a string literal');
  const property = complete('expression', 'isAttributeWithOptionalPrefix($.a, |', { explicit: true });
  assert.ok(property.labels.includes('ips.application.id'));
  // Variables declared with targetVariable are suggested for sourceVariable and ${...}.
  const doc = '{"user":{"mappings":[{"sourcePath":"$.a","targetVariable":"myVar"},{"sourceVariable":"my|"}]}}';
  assert.deepEqual(complete('transformation', doc).labels, ['myVar']);
  const placeholder = complete('transformation', '{"user":{"mappings":[{"constant":"x ${cur|}"}]}}');
  assert.deepEqual(
    placeholder.options.map((item) => item.label),
    ['currentDate'],
  );
  assert.equal(placeholder.replaced, 'cur}');
});

test('function condition completes @ from the mapping source and applyOnElements', () => {
  const doc = (extra) =>
    `{"user":{"mappings":[{"sourcePath":"$.Resources[*].emails","functions":[{"function":"toLowerCaseString",${extra}"condition":"@.|"}]}]}}`;
  assert.deepEqual(
    complete('transformation', doc(''), { payload }).labels,
    ['[*]', '[0]'],
    'the member is the array itself without applyOnElements',
  );
  assert.deepEqual(complete('transformation', doc('"applyOnElements":true,'), { payload }).labels, [
    'value',
    'primary',
  ]);
});

// ---- path completion -------------------------------------------------------------------------------------------

test('path completion after a dot follows the typed prefix, arrays and special keys', () => {
  const at = (marked, config) => complete('expression', marked, { payload, ...config });
  const root = at('$.|');
  assert.deepEqual(
    root.labels.slice(0, 3),
    ['Resources', 'id', 'userName'],
    'an expression addresses the payload root first',
  );
  assert.ok(root.labels.includes('Resources'));
  assert.equal(root.replaced, '.');
  const resources = at('$.Resources.|');
  assert.deepEqual(resources.labels, ['[*]', '[0]'], 'an array offers element selectors instead of members');
  assert.equal(resources.replaced, '.');
  const members = at('$.Resources[*].|');
  assert.ok(members.labels.includes('nickName'), 'keys of later members are merged in');
  assert.deepEqual(at('$.Resources[*].us|').labels, ['userName']);
  const special = at('$.Resources[*].urn|');
  assert.equal(special.options[0].insert, "['urn:ietf:params:scim:schemas:core:2.0:User']");
  assert.equal(special.replaced, '.urn');
  assert.deepEqual(at("$.Resources[*]['ur|']").labels, ['urn:ietf:params:scim:schemas:core:2.0:User']);
  assert.deepEqual(at('$.Resources[*].emails[0].|').labels, ['value', 'primary']);
  assert.deepEqual(at('$.Resources[*].emails[?(@.|').labels, ['value', 'primary']);
  assert.equal(at('$.Resources[*].userName.|'), null, 'a string has no members');
  assert.equal(at('$.nope.|'), null);
  assert.deepEqual(at('$.Resources[*].userName == "x" && $.Resources[*].us|').labels, ['userName']);
});

test('path methods are offered after a partial member name', () => {
  const found = complete('expression', '$.Resources[*].emails.le|', { payload });
  assert.deepEqual(found.labels, ['length()']);
  assert.equal(found.options[0].insert, '.length()');
});

test('path completion marks optional members and handles batch envelopes', () => {
  const optional = complete('expression', '$.Resources[*].|', { payload });
  const detail = (label) => optional.options.find((item) => item.label === label).detail;
  assert.match(detail('nickName'), /optional/);
  assert.doesNotMatch(detail('id'), /optional/);
  assert.match(detail('id'), /string/);
  const envelopes = [
    ['Resources', '$.Resources[*]'],
    ['resources', '$.resources[*]'],
    ['users', '$.users[*]'],
    ['groups', '$.groups[*]'],
    ['value', '$.value[*]'],
    ['results', '$.results[*]'],
    ['entities', '$.entities[*]'],
  ];
  for (const [key, base] of envelopes) {
    const data = { [key]: [{ a: 1 }, { b: 2 }], total: 2 };
    const root = complete('transformation', '{"user":{"mappings":[{"sourcePath":"$.|"}]}}', { payload: data });
    assert.deepEqual(root.labels.slice(0, 2), ['a', 'b'], `${key}: entity-relative first`);
    assert.ok(root.labels.includes(key) && root.labels.includes('total'), key);
    assert.deepEqual(complete('expression', `${base}.|`, { payload: data }).labels, ['a', 'b'], key);
  }
  const odata = { d: { results: [{ a: 1 }] } };
  assert.deepEqual(complete('expression', '$.d.results[*].|', { payload: odata }).labels, ['a']);
  assert.deepEqual(
    complete('transformation', '{"user":{"mappings":[{"sourcePath":"$.|"}]}}', { payload: odata }).labels.slice(0, 2),
    ['a', 'd'],
  );
  const rootArray = [{ a: 1 }, { b: 1 }];
  assert.deepEqual(complete('expression', '$[*].|', { payload: rootArray }).labels, ['a', 'b']);
  assert.deepEqual(
    complete('transformation', '{"user":{"mappings":[{"sourcePath":"$.|"}]}}', { payload: rootArray }).labels.slice(
      0,
      2,
    ),
    ['a', 'b'],
  );
  assert.ok(
    complete('transformation', '{"user":{"mappings":[{"sourcePath":"|"}]}}', {
      payload,
      explicit: true,
    }).labels.includes('$.userName'),
    'an empty path string offers whole paths',
  );
});

test('shape sampling is bounded, memoised and safe on hostile payloads', () => {
  const wide = Object.fromEntries(Array.from({ length: 50_000 }, (_, i) => [`k${i}`, i]));
  const started = performance.now();
  const options = complete('expression', '$.|', { payload: wide });
  assert.ok(performance.now() - started < 1500, 'wide payload stays responsive');
  assert.ok(options.options.length <= 200, 'key count is capped');
  let deep = {};
  for (let i = 0; i < 20_000; i++) deep = { a: deep };
  assert.doesNotThrow(() => complete('expression', '$.a.a.|', { payload: deep }));
  const many = { items: Array.from({ length: 100_000 }, (_, i) => (i === 99_999 ? { late: 1 } : { early: i })) };
  const members = complete('expression', '$.items[*].|', { payload: many });
  assert.deepEqual(members.labels, ['early'], 'only the first 20 members are sampled');
  assert.strictEqual(shapeOf(payload), shapeOf(payload));
  assert.doesNotThrow(() => shapeOf(null));
  assert.doesNotThrow(() => shapeOf('text'));
  assert.equal(complete('expression', '$.|', { payload: undefined }), null);
});

// ---- hover -----------------------------------------------------------------------------------------------------

function hover(kind, text, needle, config = { payload }, offset = 1) {
  const pos = text.indexOf(needle) + offset;
  const hit = hoverAt(kind, text, pos, config);
  return hit && { ...hit, covered: text.slice(hit.from, hit.to) };
}

test('hover explains keys, functions, parameters, enum values and operators', () => {
  const text = JSON.stringify(
    {
      user: {
        mappings: [
          {
            sourcePath: '$.userName',
            condition: '$.active == true && isValidEmail($.emails[0].value)',
            scope: 'createEntity',
            functions: [
              { function: 'substring', beginIndex: 1, endIndex: 3 },
              { function: 'encode', algorithm: 'base64' },
            ],
          },
        ],
      },
    },
    null,
    1,
  );
  assert.equal(hover('transformation', text, '"sourcePath"').covered, '"sourcePath"');
  assert.match(hover('transformation', text, '"sourcePath"').text, /JSONPath/);
  const begin = hover('transformation', text, '"beginIndex"');
  assert.match(begin.text, /integer, required/);
  assert.match(hover('transformation', text, '"endIndex"').text, /integer, optional/);
  assert.match(hover('transformation', text, '"algorithm"').text, /Allowed: base32, base64/);
  assert.match(hover('transformation', text, '"base64"').text, /one of base32, base64/);
  assert.equal(hover('transformation', text, '"substring"').text.split('\n')[0], 'substring(beginIndex, endIndex?)');
  assert.match(hover('transformation', text, 'createEntity').text, /context\.operation/);
  const operator = hover('transformation', text, '==');
  assert.equal(operator.covered, '==');
  assert.match(hover('transformation', text, 'isValidEmail').text, /^isValidEmail\(\$\.path\)/);
  assert.equal(hover('transformation', text, '"unknownKey"'), null);
  assert.equal(hover('data', text, '"sourcePath"'), null);
});

test('hover on source paths shows type and a truncated preview of the payload value', () => {
  const text = JSON.stringify(
    {
      user: {
        mappings: [
          { sourcePath: '$.userName' },
          { sourcePath: '$.emails' },
          { sourcePath: '$.missing' },
          { sourcePath: '$.Resources[*].id' },
        ],
      },
    },
    null,
    1,
  );
  const name = hover('transformation', text, '$.userName');
  assert.equal(name.covered, '$.userName');
  assert.match(name.text, /string/);
  assert.match(name.text, /Preview: "alex"/);
  assert.match(name.text, /1 of 2 sampled|2 of 2 sampled/);
  assert.match(hover('transformation', text, '$.emails').text, /array/);
  assert.match(hover('transformation', text, '$.missing').text, /No value at this path/);
  assert.match(hover('transformation', text, '$.Resources[*].id').text, /2 values, first is string/);
  const long = { Resources: [{ note: 'x'.repeat(500) }] };
  const preview = hover(
    'transformation',
    JSON.stringify({ user: { mappings: [{ sourcePath: '$.note' }] } }),
    '$.note',
    { payload: long },
  ).text;
  assert.ok(preview.split('\n').at(-1).length < 100, 'previews are truncated');
  const expression = hover('expression', '$.Resources[0].emails[0].primary == true', 'Resources');
  assert.equal(expression.covered, '$.Resources[0].emails[0].primary');
  assert.match(expression.text, /boolean/);
  assert.equal(
    hover('expression', '$.a[?(@.b == 1)]', '$.a', { payload }),
    null,
    'filters are not modelled, so nothing is claimed',
  );
});

test('hover in the runtime context editor', () => {
  const text = '{ "variables": { "assignGroup": "g" }, "operation": "patchEntity", "localeMappings": [] }';
  assert.match(hover('context', text, '"variables"').text, /Named values/);
  assert.match(hover('context', text, '"assignGroup"').text, /Documented variable/);
  assert.match(hover('context', text, '"patchEntity"').text, /one of createEntity/);
  assert.equal(hover('context', text, '"g"'), null);
});

// ---- robustness ------------------------------------------------------------------------------------------------

test('partial and malformed documents never throw and still locate what is complete', () => {
  const full = JSON.stringify(
    {
      user: {
        condition: '$.a == 1',
        mappings: [
          {
            sourcePath: '$.a',
            targetPath: '$.b',
            functions: [{ function: 'replaceString', target: 'x', replacement: 'y' }],
          },
          {
            type: 'valueMapping',
            sourcePaths: ['$.a'],
            valueMappings: [{ key: ['1'], mappedValue: 'one' }],
            targetPath: '$.c',
          },
        ],
      },
    },
    null,
    1,
  );
  for (let end = 0; end <= full.length; end++) {
    const prefix = full.slice(0, end);
    for (const kind of ['transformation', 'context', 'expression', 'data']) {
      assert.doesNotThrow(() => analyze(kind, prefix), `${kind} @${end}`);
      assert.doesNotThrow(
        () => completionsAt(kind, prefix, end, { payload, explicit: true }),
        `${kind} complete @${end}`,
      );
      assert.doesNotThrow(() => hoverAt(kind, prefix, Math.max(0, end - 1), { payload }), `${kind} hover @${end}`);
    }
  }
  for (const garbage of [
    '',
    '   ',
    '{',
    '}',
    '{"',
    '{"a"',
    '{"a":',
    '{"a":}',
    '{,}',
    '[,]',
    '{"a":1,,"b"',
    '"unterminated',
    "{'a':1}",
    '{"a":tru}',
    '\u0000',
    '{"user":{"mappings":[{"sourcePath":"\\u00',
    '{"user":{"mappings":[{}}',
  ]) {
    assert.doesNotThrow(() => {
      analyzeTransformation(garbage);
      analyzeContext(garbage);
      for (let pos = 0; pos <= garbage.length; pos++) {
        completionsAt('transformation', garbage, pos, { payload, explicit: true });
        hoverAt('transformation', garbage, pos, { payload });
      }
    }, JSON.stringify(garbage));
  }
  const deep = '['.repeat(50_000);
  assert.doesNotThrow(() => parseJson(deep));
  assert.doesNotThrow(() => analyzeTransformation(deep));
});

test('incomplete objects do not raise missing-property errors while typing', () => {
  assert.deepEqual(diagnose('{"user":{"mappings":[{"sourcePath":"$.a"'), []);
  assert.deepEqual(diagnose('{"user":{"mappings":[{"sourcePath":"$.a", "functions":[{"function":"replaceString"'), []);
  assert.deepEqual(
    diagnose('{"user":{"mappings":[{"sourcePath":"$.a","targetPath":"$.b","functions":[{"function":"substring","'),
    [],
  );
  // Complete siblings of the unfinished part are still checked.
  const found = diagnose('{"user":{"mappings":[{"sourcePath":"x","targetPath":"$.b"},{"sourcePath":"$.a"');
  assert.equal(found[0].text, 'x');
});

test('syntax ranges survive CRLF and unicode text', () => {
  const text =
    '{\r\n  "user": {\r\n    "mappings": [ { "sourcePath": "$.é", "targetPath": "$.t", "note": "ü", "bogus": 1 } ]\r\n  }\r\n}';
  const found = diagnose(text);
  assert.deepEqual(
    found.map((item) => item.text),
    ['"note"', '"bogus"'],
  );
});
