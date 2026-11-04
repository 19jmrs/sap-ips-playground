import test from 'node:test';
import assert from 'node:assert/strict';
import { readPath } from '../src/engine/index.js';
import { assertSafePath } from '../src/engine/util.js';

const read = (data, path, env) => readPath(data, path, env);

test('unsafe property guard rejects real segments only, not names that contain the words', () => {
  const data = { constructorName: 'a', prototypeId: 'b', __proto_x: 1, list: [{ constructorName: 'c' }] };
  assert.equal(read(data, '$.constructorName'), 'a');
  assert.equal(read(data, "$['prototypeId']"), 'b');
  assert.deepEqual(read(data, '$.list[?(@.constructorName == "c")]'), [{ constructorName: 'c' }]);
  // A string literal in a filter is data, not a property segment.
  assert.deepEqual(read(data, "$.list[?(@.constructorName == 'constructor')]"), []);
  for (const path of [
    '$.constructor',
    '$.a.__proto__.b',
    "$['constructor']",
    '$["prototype"]',
    "$['a', 'constructor']",
    "$['con\\u0073tructor']",
    '$..prototype',
    '$.list[?(@.constructor)]',
    "$.list[?(@['__proto__'] == 1)]",
    '$.list[?(@.a == 1 && $.constructor)]',
    '$.list[?(@.a)].constructor',
  ]) {
    assert.throws(() => read(data, path), /Unsafe property in JSONPath/, path);
  }
});

test('assertSafePath names the offending segment and the caller context', () => {
  assert.doesNotThrow(() => assertSafePath('$.constructorName[0].prototypeId', 'targetPath'));
  assert.throws(() => assertSafePath("$.a['__proto__']", 'targetPath'), /Unsafe property in targetPath: __proto__/);
  assert.throws(() => assertSafePath('$.groups[?(@.constructor)]', 'targetPath'), /targetPath: constructor/);
});

test('negative indices, index unions and slices follow Jayway', () => {
  const data = { a: [1, 2, 3, 4, 5] };
  assert.equal(read(data, '$.a[-1]'), 5);
  assert.equal(read(data, '$.a[-5]'), 1);
  assert.equal(read(data, '$.a[-6]'), undefined);
  assert.equal(read(data, '$.a[5]'), undefined);
  assert.deepEqual(read(data, '$.a[0,-1]'), [1, 5]);
  assert.deepEqual(read(data, '$.a[-2:]'), [4, 5]);
  assert.deepEqual(read(data, '$.a[:-1]'), [1, 2, 3, 4]);
  assert.deepEqual(read(data, '$.a[:2]'), [1, 2]);
  assert.deepEqual(read(data, '$.a[1:3]'), [2, 3]);
  assert.deepEqual(read(data, '$.a[-3:-1]'), [3, 4]);
  assert.deepEqual(read(data, '$.a[3:99]'), [4, 5]);
  assert.deepEqual(read(data, '$.a[9:]'), []);
});

test('slices whose meaning is version dependent in Jayway are explicit errors', () => {
  const data = { a: [1, 2, 3, 4, 5] };
  assert.throws(() => read(data, '$.a[1:-1]'), /mixes negative and non-negative/);
  assert.throws(() => read(data, '$.a[::2]'), /steps are not part of the Jayway dialect/);
  assert.throws(() => read(data, '$.a[0:4:2]'), /steps are not part of the Jayway dialect/);
});

test('bracket names: escapes, spaces, colons and unions', () => {
  const data = {
    "it's": 1,
    'a b': { 'c:d': 2 },
    'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': { department: 'Sales' },
    o: { x: 1, y: 2 },
  };
  assert.equal(read(data, "$['it\\'s']"), 1);
  assert.equal(read(data, '$["a b"]["c:d"]'), 2);
  assert.equal(read(data, "$['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'].department"), 'Sales');
  assert.equal(read(data, '$.urn:x'), undefined);
  // A leaf multi-name selection merges into one object, a missing name is skipped.
  assert.deepEqual(read(data, "$.o['x','y','z']"), { x: 1, y: 2 });
});

test('definite paths return one value, other paths return a list', () => {
  const data = { a: { b: null }, list: [{ k: 1 }, { k: 2 }], empty: [] };
  assert.equal(read(data, '$.a.b'), null);
  assert.equal(read(data, '$.a.missing'), undefined);
  assert.equal(read(data, '$.a.b.c'), undefined);
  assert.deepEqual(read(data, '$.empty'), []);
  assert.deepEqual(read(data, '$.list[*].k'), [1, 2]);
  assert.deepEqual(read(data, '$.nothing[*]'), []);
  assert.deepEqual(read(data, '$..k'), [1, 2]);
  assert.deepEqual(read(data, '$.list[0,1].k'), [1, 2]);
});

test('filters: nested, tails, unions of tests, existence and quoted metacharacters', () => {
  const data = {
    sel: 'x',
    list: [{ a: 'x', b: 1, t: ['u'] }, { a: 'y', t: ['v', 'w'] }, { c: 0, a: 'z', b: false }, { b: null }],
    items: [
      { id: 'x', sub: [{ k: 1 }, { k: 2 }] },
      { id: 'y', sub: [{ k: 3 }] },
    ],
  };
  assert.deepEqual(read(data, "$.list[?(@.a == 'x' || @.b)]"), [data.list[0], data.list[2], data.list[3]]);
  assert.deepEqual(read(data, '$.list[?(!@.b)]'), [data.list[1]]);
  assert.deepEqual(read(data, "$.list[?(@.a == 'x')].t"), [['u']]);
  assert.deepEqual(read(data, '$.list[?(@.a)].t[0]'), ['u', 'v']);
  assert.deepEqual(read(data, '$.items[?(@.id == $.sel)].sub[?(@.k > 1)]'), [{ k: 2 }]);
  assert.deepEqual(read(data, '$.items[*].sub[?(@.k >= 2)].k'), [2, 3]);
  assert.deepEqual(read(data, '$.items[?(@.sub[?(@.k == 3)])].id'), ['x', 'y']);
  assert.deepEqual(read({ l: [{ a: "it's ]) [" }, { a: 'z' }] }, '$.l[?(@.a == "it\'s ]) [")]'), [{ a: "it's ]) [" }]);
  assert.deepEqual(read({ l: [{ a: "it's ]) [" }] }, "$.l[?(@.a == 'it\\'s ]) [')]"), [{ a: "it's ]) [" }]);
});

test('the root reference inside a filter in a tail refers to the document root', () => {
  const data = {
    sel: 'y',
    items: [
      { id: 'x', refs: [{ ref: 'x' }, { ref: 'y' }] },
      { id: 'y', refs: [{ ref: 'y' }] },
    ],
  };
  assert.deepEqual(read(data, '$.items[?(@.id == "x")].refs[?(@.ref == $.sel)]'), [{ ref: 'y' }]);
});

test('an existence test inside a filter is true for null, false, 0 and empty values', () => {
  const data = { l: [{ a: 0 }, { a: false }, { a: null }, { a: '' }, {}] };
  assert.deepEqual(read(data, '$.l[?(@.a)]'), [{ a: 0 }, { a: false }, { a: null }, { a: '' }]);
  assert.deepEqual(read(data, '$.l[?(!@.a)]'), [{}]);
  assert.deepEqual(read(data, '$.l[?(!(@.a))]'), [{}]);
  assert.deepEqual(read({ l: [{ a: 0, b: 1 }, { a: 1 }, { b: 2 }] }, '$.l[?(@.a && @.b)]'), [{ a: 0, b: 1 }]);
  assert.deepEqual(read({ l: [{ a: 0, b: 1 }, { a: 1 }, { b: 2 }] }, '$.l[?((@.a) || (@.b))]').length, 3);
  // Combining after a comparison must not reuse the previous operand's existence result.
  assert.deepEqual(read({ l: [{ a: 1 }, { a: 2 }] }, '$.l[?(@.a == 1 && @.a && @.a)]'), [{ a: 1 }]);
});

test('an existence test follows Jayway: no missing property on the way, a definite path found something', () => {
  const data = {
    items: [
      { id: 'x', sub: [{ k: 1 }] },
      { id: 'y', sub: [{ k: 3 }] },
    ],
  };
  // An indefinite path that selects nothing still exists, as long as nothing on its way is missing.
  assert.deepEqual(read(data, '$.items[?(@.sub[?(@.k == 3)])].id'), ['x', 'y']);
  assert.deepEqual(read(data, '$.items[?(@.sub[?(@.k > 9)])].id'), ['x', 'y']);
  assert.deepEqual(read(data, '$.items[?(@.sub[*].k)].id'), ['x', 'y']);
  assert.deepEqual(read(data, '$.items[?(@.sub[*].zz)].id'), []);
  assert.deepEqual(read(data, '$.items[?(@.zz[*])].id'), []);

  const item = { arr: [{ k: 1 }, { k: 2 }, { j: 3 }], ea: [], obj: { k: 1 }, a: 5, n: null };
  const exists = (path) => read({ x: [item] }, `$.x[?(${path})]`).length === 1;
  // Each expectation was taken from Jayway JsonPath 2.9.0.
  for (const path of ['@.ea[*]', '@.ea[?(@.k)]', '@.arr[5:9]', '@..zz', '@.arr[*]', '@.arr[-1]', '@.n', '@.obj.*']) {
    assert.equal(exists(path), true, path);
  }
  for (const path of ['@.arr[*].k', "@['a','m']", '@.arr[5]', '@.arr[-9]', '@.m.length()', '@.n.x', '@.a.x']) {
    assert.equal(exists(path), false, path);
  }
});

test('a filter on an object tests the object itself (Jayway PredicatePathToken)', () => {
  const data = { o: { x: 1, y: { z: 2 } } };
  assert.deepEqual(read(data, '$.o[?(@.x == 1)]'), [data.o]);
  assert.deepEqual(read(data, '$.o[?(@.x == 2)]'), []);
});

test('a filter after recursive descent selects children of every match', () => {
  const data = { a: { book: [{ p: 1 }, { p: 20 }] }, b: { book: [{ p: 30 }] } };
  assert.deepEqual(read(data, '$..book[?(@.p > 10)]'), [{ p: 20 }, { p: 30 }]);
  assert.deepEqual(read(data, '$..book[?(@.p > 10)].p'), [20, 30]);
});

test('filters on primitives and unsupported filter forms are explicit', () => {
  const data = { s: 'text', n: null, num: 3, o: { x: 1 } };
  assert.throws(() => read(data, '$.s[?(@ == 1)]'), /cannot be applied to a string value/);
  assert.throws(() => read(data, '$.n[?(@.a)]'), /cannot be applied to a null value/);
  assert.throws(() => read(data, '$.o.x[?(@.a)]'), /cannot be applied to a number value/);
  // A missing path has no value to filter, and indefinite scans skip primitives silently.
  assert.deepEqual(read(data, '$.nothing[?(@.a)]'), []);
  assert.deepEqual(read(data, '$.*[?(@.x == 1)]'), [data.o]);
  assert.throws(() => read(data, '$..[?(@.x)]'), /recursive descent directly followed by a filter/);
  assert.throws(() => read(data, '$.o[?@.x]'), /must be written \[\?\(condition\)\]/);
  assert.throws(() => read(data, '$.o[?(@.x == 1'), /unclosed filter/);
  assert.throws(() => read(data, '$.o[?(@.x == 1) ]x'), /unexpected/);
});

test('non-Jayway extensions of JavaScript JSONPath libraries are rejected, not approximated', () => {
  const data = { a: [1, 2], o: { x: 1 } };
  assert.throws(() => read(data, '$.o~'), /Unsupported or invalid JSONPath/);
  assert.throws(() => read(data, '$.a.^'), /Unsupported or invalid JSONPath/);
  assert.throws(() => read(data, '$.a[(@.length-1)]'), /unsupported bracket expression/);
  assert.throws(() => read(data, '$.a.sort()'), /Unsupported JSONPath function/);
  assert.throws(() => read(data, '$.a .b'), /Unsupported or invalid JSONPath/);
});

test('a single dot directly before a bracket is skipped, as in Jayway 2.9.0', () => {
  const data = {
    emails: [
      { value: 'a@x', display: 'A', primary: true, type: 'work' },
      { value: 'b@x', primary: false },
    ],
    name: { given: 'G', family: 'F' },
  };
  const projected = [
    { value: 'a@x', display: 'A', primary: true },
    { value: 'b@x', primary: false },
  ];
  assert.deepEqual(read(data, "$.emails[*].['value','display','primary']"), projected);
  assert.deepEqual(
    read(data, "$.emails[*].['value','display','primary']"),
    read(data, "$.emails[*]['value','display','primary']"),
  );
  assert.deepEqual(read(data, "$.emails[*].['value']"), ['a@x', 'b@x']);
  assert.deepEqual(read(data, "$.name.['given','family']"), { given: 'G', family: 'F' });
  assert.deepEqual(read(data, '$.emails.[0]'), data.emails[0]);
  assert.deepEqual(read(data, '$.emails.[*]'), data.emails);
  assert.equal(read(data, "$.emails.['value']"), undefined, 'a property name on an array finds nothing');
  // A dot is still rejected when nothing valid follows it.
  assert.throws(() => read(data, '$.emails[*].'), /Unsupported or invalid JSONPath/);
  assert.throws(() => read(data, '$.emails..'), /Unsupported or invalid JSONPath/);
});

test('path aggregates compute numbers and never return NaN or Infinity', () => {
  const data = {
    n: [1, 2.5, 4],
    one: 7,
    empty: [],
    mixed: [1, 'a'],
    big: [1.7e308, 1.7e308],
    bool: [true],
    text: ['3'],
  };
  assert.equal(read(data, '$.n.sum()'), 7.5);
  assert.equal(read(data, '$.n.avg()'), 2.5);
  assert.equal(read(data, '$.n.min()'), 1);
  assert.equal(read(data, '$.n.max()'), 4);
  assert.equal(read(data, '$.n.first()'), 1);
  assert.equal(read(data, '$.n.last()'), 4);
  assert.equal(read(data, '$.one.max()'), 7);
  assert.equal(read(data, '$.empty.sum()'), 0);
  assert.equal(read(data, '$.empty.first()'), undefined);
  for (const method of ['min', 'max', 'avg']) {
    assert.throws(
      () => read(data, `$.empty.${method}()`),
      new RegExp(`${method}\\(\\) cannot be applied to an empty array`),
    );
    assert.throws(() => read(data, `$.nothing[*].${method}()`), /empty array/);
  }
  for (const method of ['min', 'max', 'sum', 'avg']) {
    assert.throws(
      () => read(data, `$.mixed.${method}()`),
      new RegExp(`${method}\\(\\) requires numeric values but found "a"`),
    );
    assert.throws(() => read(data, `$.text.${method}()`), /found "3"/);
    assert.throws(() => read(data, `$.bool.${method}()`), /found true/);
    assert.throws(() => read(data, `$.absent.${method}()`), /found a missing value/);
  }
  assert.throws(() => read(data, '$.big.sum()'), /sum\(\) result is out of numeric range/);
  assert.throws(() => read(data, '$.big.avg()'), /avg\(\) result is out of numeric range/);
});

test('length() counts members, rejects scalars that have no length', () => {
  const data = { a: [1, 2, 3], o: { x: 1, y: 2 }, s: 'text', n: 12345, b: true, nil: null };
  assert.equal(read(data, '$.a.length()'), 3);
  assert.equal(read(data, '$.o.length()'), 2);
  assert.equal(read(data, '$.s.length()'), 4);
  assert.equal(read(data, '$.nil.length()'), 0);
  assert.equal(read(data, '$.absent.length()'), 0);
  assert.equal(read(data, '$.a[?(@ > 1)].length()'), 2);
  assert.throws(() => read(data, '$.n.length()'), /length\(\) requires an array, object or string but found 12345/);
  assert.throws(() => read(data, '$.b.size()'), /size\(\) requires an array, object or string but found true/);
});

test('a method in the middle of a path is an unsupported function, not a property lookup', () => {
  assert.throws(() => read({ a: [1] }, '$.a.length().x'), /Unsupported JSONPath function/);
});

test('filter conditions see context variables and properties through the env', () => {
  const env = { variables: { wanted: 'y' }, properties: { limit: 2 } };
  const data = {
    l: [
      { id: 'x', n: 1 },
      { id: 'y', n: 3 },
    ],
  };
  assert.deepEqual(read(data, '$.l[?(@.id == ${wanted})]', env), [data.l[1]]);
  assert.deepEqual(read(data, '$.l[?(@.n > %limit%)]', env), [data.l[1]]);
  assert.deepEqual(read(data, "$.l[?(@.id == '${wanted}')]", env), [data.l[1]]);
});
