import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExpression, runPipeline } from '../src/engine/index.js';

const doc = (...mappings) => ({ user: { mappings } });
const run = (data, mappings, extra = {}) => runPipeline({ data, source: doc(...mappings), mode: 'source', ...extra });
const first = (result) => result.entities[0];
const output = (data, mappings, extra) => first(run(data, mappings, extra)).output;
const failure = (data, mappings, extra) => {
  const entity = first(run(data, mappings, extra));
  assert.ok(entity.error, `expected an error, got ${JSON.stringify(entity.output)}`);
  return entity;
};
const nested = (depth, leaf = 1) => {
  let value = leaf;
  for (let i = 0; i < depth; i++) value = [value];
  return value;
};

// ---------------------------------------------------------------- context inside path filters

test('a context value in an unquoted filter operand is resolved by the condition parser, not pasted into the path', () => {
  const data = {
    items: [
      { n: 'x', v: 1 },
      { n: 'y', v: 2 },
    ],
    nums: [{ n: 1 }, { n: 2 }],
  };
  const context = { properties: { want: 'y' }, variables: { two: 2 } };
  // Text substitution would give `@.n == y`, an identifier the condition language rejects.
  assert.deepEqual(output(data, [{ sourcePath: '$.items[?(@.n == %want%)].v', targetPath: '$.v' }], { context }), {
    v: 2,
  });
  // A ${variable} keeps its type inside the filter: 2 matches the number, not the text "2".
  assert.deepEqual(output(data, [{ sourcePath: '$.nums[?(@.n == ${two})]', targetPath: '$.n' }], { context }), {
    n: { n: 2 },
  });
  assert.deepEqual(
    output(
      data,
      [
        {
          type: 'valueMapping',
          sourcePaths: ['$.items[?(@.n == %want%)].v'],
          valueMappings: [{ key: [[2]], mappedValue: 'found' }],
          targetPath: '$.mapped',
        },
      ],
      { context },
    ),
    { mapped: 'found' },
  );
  assert.deepEqual(evaluateExpression({ data, expression: '$.items[?(@.n == %want%)].v', context }), [2]);
});

test('missing context inside a filter is an error even when the filter has no candidate', () => {
  const entity = failure({ items: [] }, [{ sourcePath: '$.items[?(@.n == %want%)]', targetPath: '$.x' }]);
  assert.equal(entity.error, 'source mapping 1: Missing context property: want');
  assert.equal(entity.errorDetail.code, 'MISSING_CONTEXT');
  assert.throws(
    () => evaluateExpression({ data: { items: [] }, expression: '$.items[?(@.n == ${gone})]' }),
    /Missing context variable: gone/,
  );
});

test('a percent sign or ${ inside a filter regex or string literal is text, not a reference', () => {
  const data = { items: [{ n: '50% off' }, { n: 'plain' }, { n: '${raw}' }] };
  assert.deepEqual(output(data, [{ sourcePath: '$.items[?(@.n =~ /50%.*%?/)].n', targetPath: '$.v' }]), {
    v: '50% off',
  });
  assert.deepEqual(
    output(data, [{ sourcePath: "$.items[?(@.n == '${raw}')].n", targetPath: '$.v' }], {
      context: { variables: { raw: 'plain' } },
    }),
    { v: 'plain' },
  );
  // Outside filters substitution still applies to quoted names.
  assert.deepEqual(
    output({ 'a.b': 7 }, [{ sourcePath: "$['%key%']", targetPath: '$.v' }], {
      context: { properties: { key: 'a.b' } },
    }),
    { v: 7 },
  );
});

test('a quoted name that looks like a filter is not parsed as one', () => {
  const data = { '[?(': 3 };
  assert.deepEqual(output(data, [{ sourcePath: "$['[?(']", targetPath: '$.v' }]), { v: 3 });
});

test('an unclosed filter is a path error', () => {
  const entity = failure({ a: [] }, [{ sourcePath: '$.a[?(@.b == 1', targetPath: '$.x' }]);
  assert.equal(entity.errorDetail.code, 'PATH_ERROR');
});

// ---------------------------------------------------------------- target path writes and removals

test('removal supports [*] on arrays and objects, and a wildcard in the middle', () => {
  const copy = { sourcePath: '$', targetPath: '$' };
  assert.deepEqual(output({ emails: ['a', 'b'], k: 1 }, [copy, { type: 'remove', targetPath: '$.emails[*]' }]), {
    emails: [],
    k: 1,
  });
  assert.deepEqual(output({ obj: { a: 1, b: 2 } }, [copy, { type: 'remove', targetPath: '$.obj[*]' }]), { obj: {} });
  assert.deepEqual(
    output({ a: [{ b: 1, c: 2 }, { c: 3 }, 'text', null] }, [copy, { type: 'remove', targetPath: '$.a[*].b' }]),
    { a: [{ c: 2 }, { c: 3 }, 'text', null] },
  );
  assert.deepEqual(output({ a: [{ b: [1, 2] }, { b: [3] }] }, [copy, { type: 'remove', targetPath: '$.a[*].b[0]' }]), {
    a: [{ b: [2] }, { b: [] }],
  });
});

test('removing something that is not there changes nothing and creates no parents', () => {
  const copy = { sourcePath: '$', targetPath: '$' };
  assert.deepEqual(output({ k: 1 }, [copy, { type: 'remove', targetPath: '$.a.b' }]), { k: 1 });
  assert.deepEqual(output({ k: 1 }, [copy, { type: 'remove', targetPath: '$.a[*].b' }]), { k: 1 });
  assert.deepEqual(output({ list: [1] }, [copy, { type: 'remove', targetPath: '$.list[5]' }]), { list: [1] });
  assert.deepEqual(output({ list: [1, 2, 3] }, [copy, { type: 'remove', targetPath: '$.list[1]' }]), {
    list: [1, 3],
  });
  assert.deepEqual(output({}, [{ type: 'remove', targetPath: '$' }]), {});
});

test('removal on filters and unsafe segments is rejected explicitly', () => {
  const unsupported = failure({ a: 1 }, [{ type: 'remove', targetPath: '$.a[?(@.x)]' }]);
  assert.equal(unsupported.errorDetail.code, 'UNSUPPORTED');
  const unsafe = failure({ a: 1 }, [{ type: 'remove', targetPath: '$.__proto__.polluted' }]);
  assert.match(unsafe.error, /Unsafe property in targetPath: __proto__/);
  assert.equal({}.polluted, undefined);
});

test('names that merely contain a reserved word are valid target paths', () => {
  assert.deepEqual(
    output({ v: 1 }, [
      { sourcePath: '$.v', targetPath: '$.constructorName' },
      { sourcePath: '$.v', targetPath: '$.prototypeId[0]' },
    ]),
    { constructorName: 1, prototypeId: [1] },
  );
});

test('wildcard writes map array members one to one and merge into existing members', () => {
  const data = { values: ['a', 'b'] };
  assert.deepEqual(output(data, [{ sourcePath: '$.values', targetPath: '$.emails[*].value' }]), {
    emails: [{ value: 'a' }, { value: 'b' }],
  });
  assert.deepEqual(
    output(data, [
      { sourcePath: '$.values', targetPath: '$.emails[*].value' },
      { constant: ['W', 'H'], targetPath: '$.emails[*].type' },
    ]),
    {
      emails: [
        { value: 'a', type: 'W' },
        { value: 'b', type: 'H' },
      ],
    },
  );
  assert.deepEqual(output(data, [{ sourcePath: '$.values', targetPath: '$.plain[*]' }]), { plain: ['a', 'b'] });
});

test('a projection writes one attribute per member and fails when the target is not an array', () => {
  assert.deepEqual(
    output({ g: ['one', 'two'] }, [
      { sourcePath: '$.g', preserveArrayWithSingleElement: true, targetPath: '$.groups[?(@.value)]' },
    ]),
    { groups: [{ value: 'one' }, { value: 'two' }] },
  );
  const entity = failure({ g: ['one'] }, [
    { constant: 'text', targetPath: '$.groups' },
    { sourcePath: '$.g', targetPath: '$.groups[?(@.value)]' },
  ]);
  assert.equal(entity.errorDetail.code, 'PATH_ERROR');
  assert.match(entity.error, /Projected target must be an array/);
});

test('nested wildcards in a write are unsupported, not guessed', () => {
  const entity = failure({ v: [[1]] }, [
    { sourcePath: '$.v', preserveArrayWithSingleElement: true, targetPath: '$.a[*].b[*].c' },
  ]);
  assert.equal(entity.errorDetail.code, 'UNSUPPORTED');
  assert.match(entity.error, /Nested \[\*\] wildcards/);
});

test('an index past the end of an array is rejected instead of padding it with nulls', () => {
  const append = output({ v: 'x' }, [
    { constant: 'first', targetPath: '$.list[0]' },
    { sourcePath: '$.v', targetPath: '$.list[1]' },
  ]);
  assert.deepEqual(append, { list: ['first', 'x'] });

  const entity = failure({ v: 'x' }, [{ sourcePath: '$.v', targetPath: '$.list[3]' }]);
  assert.equal(entity.errorDetail.code, 'PATH_ERROR');
  assert.match(entity.error, /Target index 3 is beyond the array length 0/);
});

test('a name cannot be written on an array and an index cannot be written on an object', () => {
  const onArray = failure({ v: 1 }, [
    { sourcePath: '$.v', targetPath: '$.list[0]' },
    { sourcePath: '$.v', targetPath: '$.list.name' },
  ]);
  assert.match(onArray.error, /source mapping 2: Cannot write property "name" on an array/);
  const onObject = failure({ v: 1 }, [
    { sourcePath: '$.v', targetPath: '$.obj.name' },
    { sourcePath: '$.v', targetPath: '$.obj[0]' },
  ]);
  assert.match(onObject.error, /source mapping 2: Cannot write index \[0\] on an object/);
});

test('rename moves the key and reports a missing or root target', () => {
  assert.deepEqual(
    output({ name: { last: 'Smith' } }, [
      { sourcePath: '$', targetPath: '$' },
      { type: 'rename', targetPath: '$.name.last', constant: 'family' },
    ]),
    { name: { family: 'Smith' } },
  );
  const missing = failure({}, [{ type: 'rename', targetPath: '$.a', constant: 'b' }]);
  assert.equal(missing.errorDetail.code, 'MISSING_SOURCE');
  assert.deepEqual(output({}, [{ type: 'rename', targetPath: '$.a', constant: 'b', optional: true }]), {});
  assert.match(failure({}, [{ type: 'rename', targetPath: '$', constant: 'b' }]).error, /document root/);
});

// ---------------------------------------------------------------- mapping semantics

test('a constant is never "missing": empty arrays and null are written', () => {
  assert.deepEqual(output({}, [{ constant: [], targetPath: '$.list' }]), { list: [] });
  assert.deepEqual(output({}, [{ constant: null, targetPath: '$.nothing' }]), { nothing: null });
  assert.deepEqual(output({}, [{ constant: [], defaultValue: ['d'], targetPath: '$.list' }]), { list: [] });
});

test('missing, empty array and null are told apart by optional and defaultValue', () => {
  const data = { empty: [], nothing: null, text: '' };
  assert.deepEqual(output(data, [{ sourcePath: '$.absent', defaultValue: 'd', targetPath: '$.v' }]), { v: 'd' });
  assert.deepEqual(output(data, [{ sourcePath: '$.empty', defaultValue: 'd', targetPath: '$.v' }]), { v: 'd' });
  assert.deepEqual(output(data, [{ sourcePath: '$.empty', optional: true, targetPath: '$.v' }]), {});
  // null and '' are values: they are written, and defaultValue does not replace them.
  assert.deepEqual(output(data, [{ sourcePath: '$.nothing', defaultValue: 'd', targetPath: '$.v' }]), { v: null });
  assert.deepEqual(output(data, [{ sourcePath: '$.text', defaultValue: 'd', targetPath: '$.v' }]), { v: '' });
  assert.deepEqual(output(data, [{ sourcePath: '$.absent', defaultValue: null, targetPath: '$.v' }]), { v: null });
  const entity = failure(data, [{ sourcePath: '$.empty', targetPath: '$.v' }]);
  assert.equal(entity.error, 'source mapping 1: Required source value missing: $.empty');
  assert.equal(entity.errorDetail.code, 'MISSING_SOURCE');
});

test('single-element arrays collapse unless preserveArrayWithSingleElement is set', () => {
  const data = { a: [{ b: 1 }], one: ['x'], two: ['x', 'y'] };
  assert.deepEqual(output(data, [{ sourcePath: '$.a[*].b', targetPath: '$.v' }]), { v: 1 });
  assert.deepEqual(
    output(data, [{ sourcePath: '$.a[*].b', preserveArrayWithSingleElement: true, targetPath: '$.v' }]),
    {
      v: [1],
    },
  );
  assert.deepEqual(output(data, [{ sourcePath: '$.one', targetPath: '$.v' }]), { v: 'x' });
  assert.deepEqual(output(data, [{ sourcePath: '$.two', targetPath: '$.v' }]), { v: ['x', 'y'] });
  // A scalar stays a scalar when the flag is set; the flag never invents an array.
  assert.deepEqual(
    output({ s: 'x' }, [{ sourcePath: '$.s', preserveArrayWithSingleElement: true, targetPath: '$.v' }]),
    {
      v: 'x',
    },
  );
});

test('valueMapping: unmatched or missing tuples use defaultValue (including null), optional skips, else error', () => {
  const mapping = (extra) => ({
    type: 'valueMapping',
    sourcePaths: ['$.a', '$.b'],
    valueMappings: [{ key: ['x', 'y'], mappedValue: 'hit' }],
    targetPath: '$.v',
    ...extra,
  });
  assert.deepEqual(output({ a: 'x', b: 'y' }, [mapping({})]), { v: 'hit' });
  assert.deepEqual(output({ a: 'x' }, [mapping({ defaultValue: null })]), { v: null });
  assert.deepEqual(output({ a: 'x' }, [mapping({ optional: true })]), {});
  // A missing source value does not match a null key.
  assert.deepEqual(
    output({ a: 'x' }, [
      mapping({ valueMappings: [{ key: ['x', null], mappedValue: 'null-hit' }], defaultValue: 'd' }),
    ]),
    { v: 'd' },
  );
  const entity = failure({ a: 'x' }, [mapping({})]);
  assert.equal(entity.errorDetail.code, 'MISSING_SOURCE');
});

test('valueMapping entries that can never match are configuration errors', () => {
  const base = { type: 'valueMapping', sourcePaths: ['$.a'], targetPath: '$.v' };
  assert.match(
    failure({ a: 'x' }, [{ ...base, valueMappings: [{ key: 'x', mappedValue: 'm' }] }]).error,
    /key must be an array with one value per sourcePath/,
  );
  assert.match(
    failure({ a: 'x' }, [{ ...base, valueMappings: [{ key: ['x', 'y'], mappedValue: 'm' }] }]).error,
    /key must be an array with one value per sourcePath/,
  );
  assert.match(failure({ a: 'x' }, [{ ...base, valueMappings: [{ key: ['x'] }] }]).error, /requires mappedValue/);
});

test('keys a mapping type does not act on are rejected, not silently ignored', () => {
  for (const [mapping, key] of [
    [{ type: 'remove', targetPath: '$.a', sourcePath: '$.b' }, 'sourcePath'],
    [{ type: 'remove', targetPath: '$.a', defaultValue: 1 }, 'defaultValue'],
    [{ type: 'rename', targetPath: '$.a', constant: 'b', targetVariable: 'v' }, 'targetVariable'],
    [
      { type: 'valueMapping', sourcePaths: ['$.a'], valueMappings: [], targetPath: '$.v', targetVariable: 'v' },
      'targetVariable',
    ],
    [{ type: 'valueMapping', sourcePaths: ['$.a'], valueMappings: [], targetPath: '$.v', constant: 1 }, 'constant'],
  ]) {
    const entity = failure({ a: 1 }, [mapping]);
    assert.equal(entity.errorDetail.code, 'INVALID_CONFIG');
    assert.match(entity.error, new RegExp(`${key} has no effect on a ${mapping.type} mapping`));
  }
});

test('an unknown mapping type is an error even when the mapping is ignored or out of scope', () => {
  const ignored = failure({}, [{ type: 'merge', ignore: true }]);
  assert.equal(ignored.errorDetail.code, 'UNSUPPORTED');
  assert.equal(ignored.error, 'source mapping 1: Unsupported mapping type: merge');
  const outOfScope = failure({}, [{ type: 'merge', constant: 1, targetPath: '$.a', scope: 'createEntity' }], {
    context: { operation: 'patchEntity' },
  });
  assert.equal(outOfScope.errorDetail.code, 'UNSUPPORTED');
});

test('scope is validated: a misspelt operation fails instead of silently skipping the mapping', () => {
  const mappings = (scope) => [{ constant: 1, targetPath: '$.a', scope }];
  for (const scope of ['createEntiy', 5, [], ['createEntity', 'update']]) {
    const entity = failure({}, mappings(scope), { context: { operation: 'createEntity' } });
    assert.equal(entity.errorDetail.code, 'INVALID_CONFIG', JSON.stringify(scope));
  }
  assert.deepEqual(output({}, mappings(['patchEntity', 'createEntity']), { context: { operation: 'createEntity' } }), {
    a: 1,
  });
  assert.equal(
    failure({}, mappings('createEntity')).errorDetail.code,
    'MISSING_CONTEXT',
    'a scope without context.operation cannot be evaluated',
  );
});

test('operation selects mappings: unscoped run on create, only scoped ones on patch and delete', () => {
  const mappings = [
    { constant: 'u', targetPath: '$.unscoped' },
    { constant: 'c', targetPath: '$.create', scope: 'createEntity' },
    { constant: 'p', targetPath: '$.patch', scope: ['patchEntity'] },
    { constant: 'd', targetPath: '$.delete', scope: 'deleteEntity' },
  ];
  const on = (operation) => output({}, mappings, { context: { operation } });
  assert.deepEqual(on('createEntity'), { unscoped: 'u', create: 'c' });
  assert.deepEqual(on('patchEntity'), { patch: 'p' });
  assert.deepEqual(on('deleteEntity'), { delete: 'd' });
  assert.deepEqual(output({}, [mappings[0]]), { unscoped: 'u' });
});

test('entity condition is skipped for deleteEntity but ignore still excludes the entity or mapping', () => {
  const conditional = {
    user: { condition: 'false', mappings: [{ constant: 1, scope: 'deleteEntity', targetPath: '$.a' }] },
  };
  const delet = runPipeline({ data: {}, source: conditional, mode: 'source', context: { operation: 'deleteEntity' } });
  assert.deepEqual(first(delet).output, { a: 1 });
  const create = runPipeline({ data: {}, source: conditional, mode: 'source', context: { operation: 'createEntity' } });
  assert.equal(create.summary.skipped, 1);

  const ignoredEntity = { user: { ignore: true, mappings: [{ constant: 1, targetPath: '$.a' }] } };
  const ignored = runPipeline({
    data: {},
    source: ignoredEntity,
    mode: 'source',
    context: { operation: 'deleteEntity' },
  });
  assert.equal(ignored.summary.skipped, 1);
  assert.deepEqual(
    output({}, [{ constant: 1, scope: 'deleteEntity', ignore: true, targetPath: '$.a' }], {
      context: { operation: 'deleteEntity' },
    }),
    {},
  );
});

test('a mapping condition may use %property% and ${variable}; missing context is reported with its code', () => {
  const mapping = { constant: 1, targetPath: '$.a', condition: '%flag% == true && ${count} > 1' };
  assert.deepEqual(output({}, [mapping], { context: { properties: { flag: true }, variables: { count: 2 } } }), {
    a: 1,
  });
  assert.deepEqual(output({}, [mapping], { context: { properties: { flag: false }, variables: { count: 2 } } }), {});
  const entity = failure({}, [mapping], { context: { variables: { count: 2 } } });
  assert.equal(entity.error, 'source mapping 1: Missing context property: flag');
  assert.equal(entity.errorDetail.code, 'MISSING_CONTEXT');
  const broken = failure({}, [{ constant: 1, targetPath: '$.a', condition: '$.x ==' }]);
  assert.equal(broken.errorDetail.code, 'CONDITION_ERROR');
});

test('targetVariable is visible to later mappings of the same stage and to nothing else', () => {
  assert.deepEqual(
    output({ a: 'v' }, [
      { sourcePath: '$.a', targetVariable: 'tmp' },
      { sourceVariable: 'tmp', targetPath: '$.copy' },
      { constant: 'prefix-${tmp}', targetPath: '$.joined' },
    ]),
    { copy: 'v', joined: 'prefix-v' },
  );
  // Reading a variable before it is set fails; ordering matters.
  const early = failure({ a: 'v' }, [
    { sourceVariable: 'tmp', targetPath: '$.copy' },
    { sourcePath: '$.a', targetVariable: 'tmp' },
  ]);
  assert.equal(early.errorDetail.code, 'MISSING_CONTEXT');
  assert.equal(early.errorDetail.mappingIndex, 0);
  // A mapping may write the output and a variable at once.
  assert.deepEqual(
    output({ a: 'v' }, [
      { sourcePath: '$.a', targetVariable: 'tmp', targetPath: '$.first' },
      { sourceVariable: 'tmp', targetPath: '$.second' },
    ]),
    { first: 'v', second: 'v' },
  );
});

test('variables never leak between entities, between stages or into the caller context', () => {
  const context = { variables: { seed: 'S' } };
  const result = runPipeline({
    data: [{ id: 1 }, { id: 2, other: 'o' }],
    source: doc(
      { sourcePath: '$.id', targetVariable: 'last' },
      { sourcePath: '$.other', optional: true, targetVariable: 'seed' },
      { sourceVariable: 'seed', targetPath: '$.seed' },
    ),
    target: doc({ sourceVariable: 'last', targetPath: '$.last' }),
    mode: 'chain',
    context,
  });
  // The target stage starts from the supplied context only, so `last` is unknown there.
  assert.deepEqual(result.summary, { total: 2, succeeded: 0, failed: 2, skipped: 0 });
  assert.equal(result.entities[1].errorDetail.stage, 'target');

  const source = runPipeline({
    data: [{ id: 1, other: 'o' }, { id: 2 }],
    source: doc(
      { sourcePath: '$.other', optional: true, targetVariable: 'seed' },
      { sourceVariable: 'seed', targetPath: '$.seed' },
    ),
    mode: 'source',
    context,
  });
  // Entity 1 overwrote `seed`; entity 2 still sees the caller's value, not entity 1's.
  assert.deepEqual(
    source.entities.map((entity) => entity.output.seed),
    ['o', 'S'],
  );
  assert.deepEqual(context, { variables: { seed: 'S' } });
});

test('mapping validation: wrong value types and unknown keys name the problem', () => {
  for (const [mapping, pattern] of [
    [{ constant: 1, targetPath: '$.a', optional: 'yes' }, /optional must be boolean/],
    [{ constant: 1, targetPath: 5 }, /targetPath must be a string/],
    [{ constant: 1, targetPath: '$.a', functions: {} }, /functions must be an array/],
    [{ constant: 1, targetPath: '$.a', invented: true }, /Unsupported mapping property: invented/],
    [{ constant: 1 }, /requires targetPath or targetVariable/],
    [{ sourcePath: '$.a', constant: 1, targetPath: '$.a' }, /exactly one of sourcePath/],
  ]) {
    const entity = failure({ a: 1 }, [mapping]);
    assert.equal(entity.errorDetail.code, 'INVALID_CONFIG', entity.error);
    assert.match(entity.error, pattern);
  }
  assert.equal(failure({ a: 1 }, [null]).errorDetail.code, 'INVALID_CONFIG');
});

// ---------------------------------------------------------------- structured errors

test('errorDetail mirrors entity.error: stage, 0-based mapping, failing function, code, bare message', () => {
  const entity = failure({ name: 'a' }, [
    { constant: 'ok', targetPath: '$.ok' },
    {
      sourcePath: '$.name',
      targetPath: '$.name',
      functions: [{ function: 'toUpperCaseString' }, { function: 'substring', beginIndex: 5 }],
    },
  ]);
  assert.equal(entity.error, 'source mapping 2: substring indices out of range');
  assert.deepEqual(entity.errorDetail, {
    stage: 'source',
    mappingIndex: 1,
    function: 'substring',
    code: 'FUNCTION_ERROR',
    message: 'substring indices out of range',
  });
  assert.equal(first(run({ a: 1 }, [{ sourcePath: '$.a', targetPath: '$.a' }])).errorDetail, undefined);
});

test('every failure class gets its code, and errors outside a mapping have no mapping index', () => {
  const codeOf = (result) => result.entities[0].errorDetail;
  assert.equal(codeOf(run({}, [{ sourcePath: '$.a', targetPath: '$.a' }])).code, 'MISSING_SOURCE');
  assert.equal(
    codeOf(run({}, [{ constant: 1, targetPath: '$.a', functions: [{ function: 'nope' }] }])).code,
    'FUNCTION_ERROR',
  );
  assert.equal(codeOf(run({}, [{ sourcePath: '$[', targetPath: '$.a' }])).code, 'PATH_ERROR');
  assert.equal(codeOf(run({}, [{ constant: 1, targetPath: 'a' }])).code, 'PATH_ERROR');
  assert.equal(codeOf(run({}, [{ constant: '${missing}', targetPath: '$.a' }])).code, 'MISSING_CONTEXT');
  assert.equal(codeOf(run({}, [{ constant: 1, targetPath: '$.a', type: 'merge' }])).code, 'UNSUPPORTED');

  const entityInvalid = runPipeline({ data: [1, 'two', null, [3]], source: doc(), mode: 'source' });
  for (const entity of entityInvalid.entities) {
    assert.deepEqual(entity.errorDetail, {
      stage: null,
      mappingIndex: null,
      function: null,
      code: 'ENTITY_INVALID',
      message: 'Entity must be a JSON object',
    });
    assert.equal(entity.error, 'Entity must be a JSON object');
  }

  const noTarget = runPipeline({ data: {}, source: doc(), mode: 'chain' });
  assert.deepEqual(first(noTarget).errorDetail, {
    stage: 'target',
    mappingIndex: null,
    function: null,
    code: 'INVALID_CONFIG',
    message: 'Missing target transformation',
  });
  assert.equal(first(noTarget).error, 'Missing target transformation');

  const lifecycle = runPipeline({
    data: {},
    source: { user: { mappings: [], skipOperations: ['create'] } },
    mode: 'source',
  });
  assert.equal(first(lifecycle).errorDetail.code, 'UNSUPPORTED');
  assert.equal(first(lifecycle).errorDetail.stage, 'source');

  const badCondition = runPipeline({ data: {}, source: { user: { condition: 'x ==', mappings: [] } }, mode: 'source' });
  assert.equal(first(badCondition).errorDetail.code, 'CONDITION_ERROR');
  assert.equal(first(badCondition).errorDetail.mappingIndex, null);
});

test('in a chain the failing stage is reported', () => {
  const result = runPipeline({
    data: { a: 1 },
    source: doc({ sourcePath: '$.a', targetPath: '$.a' }),
    target: doc({ sourcePath: '$.nope', targetPath: '$.b' }),
    mode: 'chain',
  });
  assert.equal(first(result).error, 'target mapping 1: Required source value missing: $.nope');
  assert.equal(first(result).errorDetail.stage, 'target');
  assert.equal(first(result).sourceOutput.a, 1);
});

test('invalid mode, entity type, entity path and context still throw; per-entity problems never do', () => {
  assert.throws(() => runPipeline({ data: {}, mode: 'sideways' }), /Invalid execution mode/);
  assert.throws(() => runPipeline({ data: {}, mode: 'source', entityType: 'device' }), /Invalid entity type/);
  assert.throws(() => runPipeline({ data: {}, mode: 'source', entityPath: '$.none' }), /matched nothing/);
  assert.throws(() => runPipeline({ data: {}, mode: 'source', context: [] }), /Context must be an object/);
  assert.throws(
    () => runPipeline({ data: {}, mode: 'source', context: { operation: 'upsert' } }),
    /context.operation must be/,
  );
  const result = runPipeline({
    data: [{}, 5, { a: 1 }],
    source: doc({ sourcePath: '$.a', targetPath: '$.a' }),
    mode: 'source',
  });
  assert.deepEqual(result.summary, { total: 3, succeeded: 1, failed: 2, skipped: 0 });
});

// ---------------------------------------------------------------- trace cost

test('without debug a failing mapping keeps a partial trace record, without copied values', () => {
  const entity = failure({ name: 'a' }, [
    {
      sourcePath: '$.name',
      targetPath: '$.name',
      functions: [{ function: 'toUpperCaseString' }, { function: 'substring', beginIndex: 5 }],
    },
  ]);
  assert.equal(entity.trace.length, 1);
  const [record] = entity.trace;
  assert.equal(record.stage, 'source');
  assert.equal(record.mapping, 0);
  assert.equal(record.status, 'error');
  assert.equal(record.error, 'substring indices out of range');
  assert.equal(record.code, 'FUNCTION_ERROR');
  assert.deepEqual(record.functions, [{ name: 'substring', error: 'substring indices out of range' }]);
  assert.equal('read' in record, false);
  assert.equal('written' in record, false);
});

test('without debug successful mappings leave no trace; with debug the trace carries values and steps', () => {
  const mappings = [
    {
      sourcePath: '$.name',
      targetPath: '$.name',
      functions: [{ function: 'toLowerCaseString' }, { function: 'concatString', suffix: '!' }],
    },
  ];
  assert.deepEqual(first(run({ name: 'AB' }, mappings)).trace, []);

  const [record] = first(run({ name: 'AB' }, mappings, { debug: true })).trace;
  assert.equal(record.status, 'written');
  assert.equal(record.read, 'AB');
  assert.equal(record.written, 'ab!');
  assert.deepEqual(
    record.functions.map((step) => [step.name, step.before, step.after]),
    [
      ['toLowerCaseString', 'AB', 'ab'],
      ['concatString', 'ab', 'ab!'],
    ],
  );
  assert.equal(record.functions[1].configuration.suffix, '!');
});

test('trace values are copies: later mappings do not change what an earlier record shows', () => {
  const entity = first(
    run(
      { list: [{ a: 1 }, { a: 2 }] },
      [
        { sourcePath: '$.list', targetPath: '$.copy' },
        { constant: 'changed', targetPath: '$.copy[0].a' },
      ],
      { debug: true },
    ),
  );
  assert.deepEqual(entity.trace[0].written, [{ a: 1 }, { a: 2 }]);
  assert.deepEqual(entity.output.copy[0], { a: 'changed' });
  assert.deepEqual(entity.input.list[0], { a: 1 });
});

test('debug never changes output, errors or summary', () => {
  const data = [{ n: 'a', list: ['x'] }, { n: 'b' }, 7];
  const mappings = [
    { sourcePath: '$.n', targetPath: '$.n', functions: [{ function: 'toUpperCaseString' }] },
    { sourcePath: '$.list', optional: true, targetPath: '$.list' },
    { sourcePath: '$.list', defaultValue: ['d', 'e'], targetPath: '$.other' },
  ];
  const strip = (result) => ({
    summary: result.summary,
    entities: result.entities.map(({ trace, ...entity }) => entity),
  });
  assert.deepEqual(strip(run(data, mappings, { debug: false })), strip(run(data, mappings, { debug: true })));
});

test('a function that reports a fallback marks its trace step', () => {
  const mappings = [
    { sourcePath: '$.tz', targetPath: '$.a', functions: [{ function: 'convertTimezoneCode', outputFormat: 'iana' }] },
    {
      sourcePath: '$.known',
      targetPath: '$.b',
      functions: [{ function: 'convertTimezoneCode', outputFormat: 'iana' }],
    },
  ];
  const [unmapped, mapped] = first(run({ tz: 'Nowhere/Land', known: 'CET' }, mappings, { debug: true })).trace;
  assert.equal(unmapped.functions[0].fallbackUsed, true);
  assert.equal('fallbackUsed' in mapped.functions[0], false);
});

// ---------------------------------------------------------------- robustness

test('deeply nested input, constants, config and paths fail with LIMIT instead of a stack overflow', () => {
  const deepObject = (depth) => {
    let value = {};
    for (let i = 0; i < depth; i++) value = { a: value };
    return value;
  };
  const depth = 200000;
  const cases = {
    'deep entity': () =>
      runPipeline({ data: deepObject(depth), source: doc({ constant: 1, targetPath: '$.a' }), mode: 'source' }),
    'deep value copied through a mapping': () =>
      run({ x: deepObject(depth) }, [{ sourcePath: '$.x', targetPath: '$.y' }]),
    'deep constant': () => run({}, [{ constant: nested(depth), targetPath: '$.a' }]),
    'deep function argument': () =>
      run({ a: 'x' }, [
        { sourcePath: '$.a', targetPath: '$.a', functions: [{ function: 'concatString', prefix: nested(depth) }] },
      ]),
    'deep path': () => run({ a: 1 }, [{ sourcePath: '$.a', targetPath: '$' + '.b'.repeat(depth) }]),
  };
  for (const [label, action] of Object.entries(cases)) {
    let result;
    assert.doesNotThrow(() => (result = action()), label);
    const entity = first(result);
    assert.equal(entity.errorDetail?.code, 'LIMIT', `${label}: ${entity.error}`);
    assert.doesNotMatch(entity.error, /call stack/i, label);
  }
  // The failing entity does not take the rest of the batch down.
  const batch = runPipeline({
    data: [{ x: deepObject(depth) }, { x: 1 }],
    source: doc({ sourcePath: '$.x', targetPath: '$.y' }),
    mode: 'source',
  });
  assert.deepEqual(batch.summary, { total: 2, succeeded: 1, failed: 1, skipped: 0 });
});

test('a context nested too deeply is a clean LIMIT error from runPipeline', () => {
  assert.throws(
    () => runPipeline({ data: {}, source: doc(), mode: 'source', context: { variables: { v: nested(200000) } } }),
    (error) => error.code === 'LIMIT' && !/call stack/i.test(error.message),
  );
});

test('a batch of thousands of small entities is processed entity by entity', () => {
  const total = 5000;
  const data = Array.from({ length: total }, (_, i) => ({ id: `id${i}`, name: `User ${i}`, bad: i % 1000 === 0 }));
  const result = runPipeline({
    data,
    source: doc(
      { sourcePath: '$.id', targetPath: '$.id', targetVariable: 'id' },
      { sourcePath: '$.name', targetPath: '$.name', functions: [{ function: 'toLowerCaseString' }] },
      { sourceVariable: 'id', targetPath: '$.again' },
      { sourcePath: '$.bad', condition: '$.bad == true', targetPath: '$.flag' },
    ),
    mode: 'source',
    context: { properties: { unused: 'x' } },
  });
  assert.deepEqual(result.summary, { total, succeeded: total, failed: 0, skipped: 0 });
  assert.deepEqual(result.entities[4321].output, { id: 'id4321', name: 'user 4321', again: 'id4321' });
  assert.deepEqual(result.entities[3000].output.flag, true);
});

test('the engine never mutates its inputs, document or context', () => {
  const data = { Resources: [{ n: 'a', list: [{ v: 1 }] }] };
  const source = doc(
    { sourcePath: '$.list', preserveArrayWithSingleElement: true, targetPath: '$.list' },
    { constant: 'x', targetPath: '$.list[0].v' },
    { type: 'remove', targetPath: '$.n' },
    { sourcePath: '$.n', targetVariable: 'kept' },
  );
  const context = { variables: { a: 1 }, properties: { b: 2 } };
  const snapshot = JSON.stringify({ data, source, context });
  const result = runPipeline({ data, source, mode: 'source', entityPath: '$.Resources', context });
  assert.equal(JSON.stringify({ data, source, context }), snapshot);
  assert.deepEqual(first(result).output, { list: [{ v: 'x' }] });
});
