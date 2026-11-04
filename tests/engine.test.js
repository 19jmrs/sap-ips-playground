import test from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline, evaluateExpression, detectEntityPath } from '../src/engine/index.js';
const doc = (...mappings) => ({ user: { mappings } });
const run = (data, source, extra = {}) => runPipeline({ data, source, mode: 'source', ...extra });
const expression = (data, expression) => evaluateExpression({ data, expression, kind: 'condition' });
const output = (result) => result.entities[0].output;

test('SAP AD source -> common JSON -> target reference pattern', () => {
  const source = doc(
    { sourcePath: '$.sAMAccountName[0]', targetPath: '$.userName' },
    { sourcePath: '$.sn[0]', targetPath: '$.name.familyName' },
    { sourcePath: '$.memberOf', preserveArrayWithSingleElement: true, targetPath: '$.groups[?(@.value)]' },
  );
  const target = doc(
    { sourcePath: '$.userName', targetPath: '$.userName' },
    { sourcePath: '$.name.familyName', targetPath: '$.name.familyName' },
    { sourcePath: '$.groups[*].value', preserveArrayWithSingleElement: true, targetPath: '$.members[?(@.value)]' },
  );
  const result = runPipeline({
    data: { sAMAccountName: ['jsmith'], sn: ['Smith'], memberOf: ['group1'] },
    source,
    target,
    mode: 'chain',
    debug: true,
  });
  assert.equal(result.summary.succeeded, 1);
  assert.deepEqual(output(result), {
    userName: 'jsmith',
    name: { familyName: 'Smith' },
    members: [{ value: 'group1' }],
  });
  assert.deepEqual(result.entities[0].sourceOutput.groups, [{ value: 'group1' }]);
  assert.equal(result.entities[0].trace.length, 6);
});
test('batch continues after individual failure', () => {
  const result = run(
    { Resources: [{ userName: 'one' }, { id: 'bad' }, { userName: 'three' }] },
    doc({ sourcePath: '$.userName', targetPath: '$.userName' }),
    { entityPath: '$.Resources', debug: true },
  );
  assert.deepEqual(result.summary, { total: 3, succeeded: 2, failed: 1, skipped: 0 });
  assert.match(result.entities[1].error, /source mapping 1: Required/);
  assert.equal(result.entities[1].trace[0].status, 'error');
  assert.equal(result.entities[2].output.userName, 'three');
});
test('target only and group section', () => {
  const result = runPipeline({
    data: { displayName: 'Group' },
    mode: 'target',
    entityType: 'group',
    target: { group: { mappings: [{ sourcePath: '$.displayName', targetPath: '$.name' }] } },
  });
  assert.deepEqual(output(result), { name: 'Group' });
  assert.equal(result.entities[0].sourceOutput, undefined);
});
test('constants, optional, defaults, singleton arrays', () => {
  const result = run(
    { emails: ['one'] },
    doc(
      { constant: ['User'], targetPath: '$.schemas' },
      { sourcePath: '$.absent', optional: true, targetPath: '$.ignored' },
      { sourcePath: '$.missing', defaultValue: false, targetPath: '$.active' },
      { sourcePath: '$.emails', targetPath: '$.email' },
      { sourcePath: '$.emails', preserveArrayWithSingleElement: true, targetPath: '$.emails' },
    ),
  );
  assert.deepEqual(output(result), { schemas: ['User'], active: false, email: 'one', emails: ['one'] });
});
test('function chaining with trace and function descriptor type alias', () => {
  const result = run(
    { name: 'JSmith' },
    doc({
      sourcePath: '$.name',
      targetPath: '$.email',
      functions: [{ type: 'toLowerCaseString' }, { function: 'concatString', prefix: 'ips_', suffix: '@example.com' }],
    }),
    { debug: true },
  );
  assert.equal(output(result).email, 'ips_jsmith@example.com');
  assert.equal(result.entities[0].trace[0].functions[0].after, 'jsmith');
});
test('mapping and entity conditions are manual pure evaluation and skipped output', () => {
  const source = doc({ constant: true, condition: '$.active == true', targetPath: '$.active' });
  source.user.condition = '$.userName EMPTY false';
  const result = run([{ userName: 'one', active: true }, { active: true }], source);
  assert.equal(result.summary.skipped, 1);
  assert.deepEqual(output(result), { active: true });
  assert.equal(result.entities[1].output, undefined);
});
test('official condition patterns: empty, regex, boolean, equality to empty array', () => {
  const data = {
    userName: 'explorer',
    emails: [{ value: 'a@example.com', primary: false }],
    groups: [{ display: 'ABC-team' }],
  };
  assert.equal(expression(data, '$.emails[?(@.primary == true)].value == []'), true);
  assert.equal(expression(data, '$.userName =~ /.*explorer.*/'), true);
  assert.equal(expression(data, '($.groups EMPTY false) && ($.groups[?(@.display =~ /ABC.*/)] empty false)'), true);
  assert.equal(expression(data, '($.emails.length() > 0) && ($.name.familyName EMPTY false)'), false);
  assert.equal(expression(data, 'isValidEmail($.emails[0].value)'), true);
});
test('JSONPath values, recursion, slicing, filter nesting and dotted SCIM keys', () => {
  const data = {
    Resources: [
      { active: true, roles: [{ display: 'a' }] },
      { active: false, roles: [] },
    ],
    'urn:test': { value: 7 },
  };
  assert.deepEqual(
    evaluateExpression({ data, expression: '$.Resources[?(@.roles[?(@.display == "a")] EMPTY false)]' }),
    [data.Resources[0]],
  );
  assert.equal(evaluateExpression({ data, expression: "$['urn:test'].value" }), 7);
  assert.deepEqual(evaluateExpression({ data, expression: '$..active' }), [true, false]);
  assert.deepEqual(evaluateExpression({ data: [1, 2, 3], expression: '$[0:2]' }), [1, 2]);
});
test('user supplied property substitution and scoped variables', () => {
  const result = run(
    { name: 'one' },
    doc(
      { constant: '${externalId}', targetPath: '$.id' },
      { sourcePath: '$.name', targetPath: '$.email', functions: [{ function: 'concatString', suffix: '@%domain%' }] },
    ),
    { context: { variables: { externalId: 5 }, properties: { domain: 'example.com' } } },
  );
  assert.deepEqual(output(result), { id: 5, email: 'one@example.com' });
  assert.match(
    run({}, doc({ sourceVariable: 'missing', targetPath: '$.id' })).entities[0].error,
    /Missing context variable/,
  );
  const chain = runPipeline({
    data: {},
    source: doc({ constant: 'set', targetVariable: 'temporary' }),
    target: doc({ sourceVariable: 'temporary', targetPath: '$.id' }),
    mode: 'chain',
  });
  assert.match(chain.entities[0].error, /Missing context variable/);
});
test('root copy then remove, scope requires context, supplied resolutions', () => {
  assert.deepEqual(
    output(run({ a: 1, b: 2 }, doc({ sourcePath: '$', targetPath: '$' }, { type: 'remove', targetPath: '$.b' }))),
    { a: 1 },
  );
  assert.match(
    run({}, doc({ constant: 1, scope: 'createEntity', targetPath: '$.a' })).entities[0].error,
    /context.operation/,
  );
  assert.deepEqual(
    output(
      run(
        { id: 'source' },
        doc({ sourcePath: '$.id', targetPath: '$.id', functions: [{ function: 'resolveEntityIds' }] }),
        { context: { resolutions: { user: { source: 'target' } } } },
      ),
    ),
    { id: 'target' },
  );
});
test('array function attributes and map functions preserve object values', () => {
  const result = run(
    { values: [{ name: 'one' }, { name: 'two' }] },
    doc({
      sourcePath: '$.values',
      preserveArrayWithSingleElement: true,
      targetPath: '$.values',
      functions: [
        { function: 'toUpperCaseString', applyOnElements: true, applyOnAttribute: 'name', assignToAttribute: 'upper' },
      ],
    }),
  );
  assert.deepEqual(output(result), {
    values: [
      { name: 'one', upper: 'ONE' },
      { name: 'two', upper: 'TWO' },
    ],
  });
  assert.deepEqual(
    output(
      run(
        { x: { a: 1 } },
        doc({
          sourcePath: '$.x',
          targetPath: '$.x',
          functions: [{ function: 'renameMapEntry', sourceKey: 'a', targetKey: 'b' }],
        }),
      ),
    ),
    { x: { b: 1 } },
  );
});
test('split projection, substring and base64 round trip', () => {
  assert.deepEqual(
    output(
      run(
        { countries: 'Serbia,Germany' },
        doc({
          sourcePath: '$.countries',
          targetPath: '$.countries[?(@.name)]',
          functions: [{ function: 'splitStringToArray', separator: ',' }],
        }),
      ),
    ),
    { countries: [{ name: 'Serbia' }, { name: 'Germany' }] },
  );
  assert.equal(
    output(
      run(
        { id: 'hello' },
        doc({
          sourcePath: '$.id',
          targetPath: '$.id',
          functions: [
            { function: 'encode', algorithm: 'base64' },
            { function: 'decode', algorithm: 'base64' },
            { function: 'toString' },
          ],
        }),
      ),
    ).id,
    'hello',
  );
});
test('unsupported syntax and unsafe paths fail closed', () => {
  for (const mapping of [
    { sourcePath: '$.name', targetPath: '$.__proto__.polluted' },
    { sourcePath: '$.name', targetVariable: '__proto__' },
    { constant: 1, targetPath: '$.name', invented: true },
    { constant: 1, targetPath: '$.name', functions: [{ function: 'unknown' }] },
    { constant: 1, targetPath: '$.name', type: 'valueMapping' },
  ]) {
    assert.equal(run({ name: 'one' }, doc(mapping)).summary.failed, 1);
  }
  assert.equal({}.polluted, undefined);
  assert.throws(
    () => evaluateExpression({ data: {}, expression: 'process.exit()', kind: 'condition' }),
    /Unsupported conditional function/,
  );
  assert.throws(() => evaluateExpression({ data: [1], expression: '$[(@.length-1)]' }), /invalid JSONPath|Unsupported/);
});
test('entity detection and path failure', () => {
  assert.equal(detectEntityPath({ Resources: [] }), '$.Resources');
  assert.equal(detectEntityPath({ d: { results: [] } }), '$.d.results');
  assert.equal(detectEntityPath({ name: 'a' }), '$');
  assert.throws(() => run({}, doc(), { entityPath: '$.absent' }), /matched nothing/);
});
test('official valueMapping and rename patterns', () => {
  assert.equal(
    output(
      run(
        { country: 'US', city: 'New York' },
        doc({
          sourcePaths: ['$.country', '$.city'],
          defaultValue: 'UTC',
          targetPath: '$.timezone',
          type: 'valueMapping',
          valueMappings: [{ key: ['US', 'New York'], mappedValue: 'EST' }],
        }),
      ),
    ).timezone,
    'EST',
  );
  assert.equal(
    output(
      run(
        {},
        doc({
          sourcePaths: ['$.country', '$.city'],
          defaultValue: 'UTC',
          targetPath: '$.timezone',
          type: 'valueMapping',
          valueMappings: [],
        }),
      ),
    ).timezone,
    'UTC',
  );
  assert.deepEqual(
    output(
      run(
        { name: { lastName: 'Smith' } },
        doc(
          { sourcePath: '$', targetPath: '$' },
          { targetPath: '$.name.lastName', constant: 'familyName', type: 'rename', optional: true },
        ),
      ),
    ),
    { name: { familyName: 'Smith' } },
  );
});
test('official ISO country and region examples', () => {
  const transform = doc({
    sourcePath: '$.addresses',
    preserveArrayWithSingleElement: true,
    targetPath: '$.addresses',
    functions: [
      {
        function: 'convertCountryCode',
        inputAttributes: ['country'],
        outputAttribute: 'country',
        outputFormat: 'alpha2',
      },
      {
        function: 'convertCountryRegion',
        inputAttributes: ['country', 'region'],
        outputAttribute: 'region',
        outputFormat: 'fullName',
      },
    ],
  });
  assert.deepEqual(output(run({ addresses: [{ country: 'United States', region: 'US-AL' }] }, transform)), {
    addresses: [{ country: 'US', region: 'Alabama' }],
  });
  assert.match(
    run({ addresses: [{ country: 'Missingland', region: 'AL' }] }, transform).entities[0].error,
    /Unknown country/,
  );
});
test('official timezone examples and ordered first match', () => {
  const convert = (value, outputFormat) =>
    output(
      run(
        { timezone: value },
        doc({
          sourcePath: '$.timezone',
          targetPath: '$.timezone',
          functions: [{ function: 'convertTimezoneCode', outputFormat }],
        }),
      ),
    ).timezone;
  assert.equal(convert('America/Phoenix', 'sap'), 'MSTNO');
  assert.equal(convert('AST', 'iana'), 'America/Halifax');
  assert.equal(convert('not-a-zone', 'sap'), 'CET');
  assert.equal(convert('not-a-zone', 'iana'), 'Europe/Berlin');
});
test('locale requires authoritative supplied master data and applies documented fallback', () => {
  const transform = doc({
    sourcePath: '$.locale',
    targetPath: '$.locale',
    functions: [{ function: 'convertLocaleCode', outputFormat: 'bcp47' }],
  });
  assert.match(run({ locale: 'EN' }, transform).entities[0].error, /context.localeMappings/);
  assert.equal(
    output(
      run({ locale: 'DE' }, transform, {
        context: {
          localeMappings: [
            ['EN', 'en-US'],
            ['DE', 'de-DE'],
          ],
        },
      }),
    ).locale,
    'de-DE',
  );
  assert.equal(
    output(run({ locale: 'EO' }, transform, { context: { localeMappings: [['EN', 'en-US']] } })).locale,
    'en-US',
  );
});
test('date reference patterns and explicit unsupported Java patterns', () => {
  const convert = (value, f) =>
    run(
      { date: value },
      doc({ sourcePath: '$.date', targetPath: '$.date', functions: [{ function: 'manipulateDate', ...f }] }),
    );
  assert.equal(
    output(
      convert('Date(1262908800000)', {
        sourceDateFormat: 'Date(milliseconds)',
        targetDateFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'",
      }),
    ).date,
    '2010-01-08T00:00:00Z',
  );
  assert.equal(
    output(convert('2024-01-31', { sourceDateFormat: 'yyyy-MM-dd', months: 1, targetDateFormat: 'yyyy-MM-dd' })).date,
    '2024-02-29',
  );
  assert.match(convert('date', { sourceDateFormat: 'EEEE' }).entities[0].error, /Unsupported Java date token/);
});
test('base32, random password constraints, intrinsic map-array functions', () => {
  assert.equal(
    output(
      run(
        { id: 'USERNAME' },
        doc({ sourcePath: '$.id', targetPath: '$.id', functions: [{ function: 'encode', algorithm: 'base32' }] }),
      ),
    ).id,
    'KVJUKUSOIFGUK===',
  );
  const password = output(
    run(
      {},
      doc({
        constant: '',
        targetPath: '$.password',
        functions: [
          {
            function: 'randomPassword',
            passwordLength: 12,
            minimumNumberOfLowercaseLetters: 2,
            minimumNumberOfUppercaseLetters: 2,
            minimumNumberOfDigits: 2,
            minimumNumberOfSpecialSymbols: 2,
          },
        ],
      }),
    ),
  ).password;
  assert.equal(password.length, 12);
  for (const pattern of [/[a-z]/g, /[A-Z]/g, /\d/g, /[~!@#$%^&*()_+]/g]) assert.ok(password.match(pattern).length >= 2);
  assert.deepEqual(
    output(
      run(
        { items: [{ a: 1 }, { a: 2 }] },
        doc({
          sourcePath: '$.items',
          targetPath: '$.items',
          functions: [{ function: 'copyMapEntry', sourceKey: 'a', targetKey: 'b' }],
        }),
      ),
    ).items,
    [
      { a: 1, b: 1 },
      { a: 2, b: 2 },
    ],
  );
});
test('filter root references, function conditions on mapped values, wildcard removal', () => {
  const data = { selected: 'a', items: [{ id: 'a' }, { id: 'b' }] };
  assert.deepEqual(evaluateExpression({ data, expression: '$.items[?(@.id == $.selected)]' }), [{ id: 'a' }]);
  const mapped = run(
    { items: [{ name: 'one' }, { name: 'two' }] },
    doc(
      {
        sourcePath: '$.items',
        targetPath: '$.items',
        functions: [
          {
            function: 'toUpperCaseString',
            applyOnElements: true,
            applyOnAttribute: 'name',
            condition: "@.name == 'one'",
          },
        ],
      },
      { type: 'remove', targetPath: '$.items[*].name' },
    ),
  );
  assert.deepEqual(output(mapped), { items: [{}, {}] });
});
test('operation scope follows documented patch/delete selection', () => {
  const source = doc(
    { constant: 'unscoped', targetPath: '$.a' },
    { constant: 'delete', targetPath: '$.a', scope: 'deleteEntity' },
  );
  source.user.condition = 'false';
  assert.deepEqual(output(run({}, source, { context: { operation: 'deleteEntity' } })), { a: 'delete' });
  assert.equal(run({}, source, { context: { operation: 'createEntity' } }).summary.skipped, 1);
});
test('remaining deterministic function behavior and descriptor validation', () => {
  const apply = (value, f, context = {}) =>
    run(
      { value },
      doc({ sourcePath: '$.value', preserveArrayWithSingleElement: true, targetPath: '$.value', functions: [f] }),
      { context },
    );
  for (const [value, f, expected] of [
    ['red red', { function: 'replaceString', target: 'red', replacement: 'blue' }, 'blue blue'],
    ['a1-a2-a3', { function: 'replaceFirstString', regex: 'a\\d', replacement: 'b' }, 'b-a2-a3'],
    ['a1-a2-a3', { function: 'replaceLastString', regex: 'a\\d', replacement: 'b' }, 'a1-a2-b'],
    ['a1-a2-a3', { function: 'replaceAllString', regex: 'a\\d', replacement: 'b' }, 'b-b-b'],
    ['username', { function: 'substring', beginIndex: 0, endIndex: 4 }, 'user'],
    [[4, 5], { function: 'elementAt', index: 1 }, 5],
    ['id:123', { function: 'getMatchedRegexGroup', regex: 'id:(\\d+)', groupIndex: 1 }, '123'],
    ['abc123', { function: 'matchRegex', regex: '[a-z]+\\d+' }, true],
    ['johnsmith', { function: 'compositeId', separator: ':', subId: 'e0123456' }, 'johnsmith:e0123456'],
    [[{ a: 1 }, {}], { function: 'putIfAbsent', key: 'a', defaultValue: 2 }, [{ a: 1 }, { a: 2 }]],
    [[{ a: 1 }, {}], { function: 'putIfPresent', key: 'a', defaultValue: 2 }, [{ a: 2 }, {}]],
    ['KVJUKUSOIFGUK===', { function: 'decode', algorithm: 'base32' }, [85, 83, 69, 82, 78, 65, 77, 69]],
  ])
    assert.deepEqual(output(apply(value, f)).value, expected, f.function);
  assert.match(apply('name', { function: 'substring', beginIndex: 8 }).entities[0].error, /indices out of range/);
  assert.match(
    apply('name', { function: 'replaceAllString', regex: '(?!a)', replacement: 'b' }).entities[0].error,
    /Negative lookahead/,
  );
  assert.match(
    apply({}, { function: 'putIfAbsent', key: ['__proto__'], defaultValue: { polluted: true } }).entities[0].error,
    /unsafe/,
  );
  assert.equal({}.polluted, undefined);
});
test('conditional function variants and missing group context', () => {
  const data = {
    displayName: 'APP-role',
    'urn:ietf:params:scim:schemas:extension:sap:2.0:Group': { supportedOperations: ['readOnly'], applicationId: 'app' },
  };
  const check = (expression, context = {}) => evaluateExpression({ data, expression, context, kind: 'condition' });
  assert.equal(check('isRegularGroup()'), false);
  assert.equal(check('isApplicationSpecificGroup()', { properties: { 'ips.application.id': 'app' } }), true);
  assert.throws(() => check('isApplicationSpecificGroup()'), /Missing context property/);
  assert.equal(check('isAttributeWithOptionalPrefix($.displayName, prefix)'), true);
  assert.equal(check('isAttributeWithMandatoryPrefix($.displayName, prefix)'), false);
  assert.equal(
    check('isAttributeWithMandatoryPrefix($.displayName, prefix)', { properties: { prefix: 'APP-' } }),
    true,
  );
  assert.equal(
    check('isAttributeWithOptionalPrefix($.displayName, prefix)', { properties: { prefix: 'OTHER-' } }),
    false,
  );
});
test('randomPassword generator needs no source, misplaced entity keys fail closed', () => {
  const result = run(
    {},
    doc({
      targetPath: '$.password',
      functions: [
        {
          function: 'randomPassword',
          passwordLength: 4,
          minimumNumberOfLowercaseLetters: 1,
          minimumNumberOfUppercaseLetters: 1,
          minimumNumberOfDigits: 1,
          minimumNumberOfSpecialSymbols: 1,
        },
      ],
    }),
  );
  assert.equal(output(result).password.length, 4);
  assert.match(
    run({}, { user: { mappings: [] }, condition: 'false' }).entities[0].error,
    /Unsupported transformation property: condition/,
  );
});
test('conditions short circuit runtime-only branch evaluation', () => {
  assert.equal(expression({}, 'isRegularGroup() || isApplicationSpecificGroup()'), true);
  assert.equal(expression({}, 'false && isApplicationSpecificGroup()'), false);
  assert.equal(expression({}, 'true || (false && isApplicationSpecificGroup())'), true);
  assert.throws(() => expression({}, 'true || (false && )'), /Unexpected condition token|Incomplete condition/);
});

test('trace retains per-member function conditions and the failing function', () => {
  const source = doc({
    sourcePath: '$.names',
    preserveArrayWithSingleElement: true,
    targetPath: '$.names',
    functions: [{ function: 'toUpperCaseString', applyOnElements: true, condition: '@ != "skip"' }],
  });
  const result = run({ names: ['one', 'skip'] }, source, { debug: true });
  assert.deepEqual(output(result).names, ['ONE', 'skip']);
  assert.deepEqual(
    result.entities[0].trace[0].functions[0].conditions.map((c) => c.result),
    [true, false],
  );
  const failure = run(
    { name: 'a' },
    doc({ sourcePath: '$.name', targetPath: '$.name', functions: [{ function: 'substring', beginIndex: 5 }] }),
    { debug: true },
  );
  assert.match(failure.entities[0].trace[0].functions[0].error, /indices out of range/);
});
