import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExpression } from '../src/engine/index.js';

const check = (data, expression, context = {}) => evaluateExpression({ data, expression, kind: 'condition', context });
const context = {
  variables: { n: 5, text: 'x%y', obj: { b: 2, a: 1 }, list: [1, 2] },
  properties: { p: 'abc', 'q.r': 7 },
};

test('operators are recognised by token kind, never by quoted string content', () => {
  const data = { b: '', s: 'hi' };
  assert.equal(check(data, '$.b empty true'), true);
  assert.equal(check(data, '$.b EMPTY true'), true);
  assert.throws(() => check(data, "$.b 'empty' true"), /Unsupported condition token/);
  assert.throws(() => check(data, "$.b '==' ''"), /Unsupported condition token/);
  assert.throws(() => check(data, "$.s '&&' true"), /Unsupported condition token/);
  assert.throws(() => check(data, "$.s || '&&' $.s"), /Unexpected condition token|Unsupported condition token/);
});

test('quoted punctuation is data and cannot close groups, arrays or calls', () => {
  const data = { s: ')', t: ',', u: ']' };
  assert.equal(check(data, "$.s == ')'"), true);
  assert.equal(check(data, "($.s == ')')"), true);
  assert.equal(check(data, "$.t in [',', 'a']"), true);
  assert.equal(check(data, "$.u in [']', '[']"), true);
  assert.equal(check(data, "'(' == '('"), true);
  assert.throws(() => check(data, "($.s == 'x' ')'"), /Expected \)/);
  assert.throws(() => check(data, "$.t in ['a' ',' 'b']"), /Expected \]/);
});

test('${variable} and %property% become typed values outside literals', () => {
  assert.equal(check({ n: 5 }, '$.n == ${n}', context), true);
  assert.equal(check({ n: '5' }, '$.n === ${n}', context), false);
  assert.equal(check({}, '${n} > 4', context), true);
  assert.equal(check({ a: 7 }, '$.a == %q.r%', context), true);
  assert.equal(check({ a: '7' }, '$.a === %q.r%', context), false);
  assert.equal(check({ s: 'abc' }, '$.s == %p%', context), true);
  assert.equal(check({ o: { a: 1, b: 2 } }, '$.o == ${obj}', context), true);
  assert.equal(check({ x: 2 }, '$.x in ${list}', context), true);
});

test('a substituted string is a value, not condition syntax', () => {
  const tricky = {
    properties: { p: "a' || 'b", q: ') || true || (' },
    variables: { v: "' || $.k == 'x" },
  };
  assert.equal(check({ k: 'x', s: "a' || 'b" }, '$.s == %p%', tricky), true);
  assert.equal(check({ k: 'x', s: 'zzz' }, '$.s == %p%', tricky), false);
  assert.equal(check({ k: 'x', s: 'zzz' }, '$.s == %q%', tricky), false);
  assert.equal(check({ k: 'x', s: "' || $.k == 'x" }, '$.s == ${v}', tricky), true);
  assert.equal(check({ k: 'x', s: 'no' }, '$.s == ${v}', tricky), false);
});

test('inside string literals the context text is substituted, inside regex literals nothing is', () => {
  assert.equal(check({ s: 'abc!' }, "$.s == '%p%!'", context), true);
  assert.equal(check({ s: 'x%y' }, "$.s == '${text}'", context), true);
  assert.equal(check({ s: '5' }, "$.s == '${n}'", context), true);
  // `%p%` inside a regex is pattern text, not a property reference.
  assert.equal(check({ s: 'a%p%b' }, '$.s =~ /a%p%b/'), true);
  assert.equal(check({ s: 'aabcb' }, '$.s =~ /a%p%b/', context), false);
  assert.equal(check({ s: 'cost 5%' }, '$.s =~ /.*5%/'), true);
  assert.equal(check({ s: '${n}' }, '$.s =~ /\\$\\{n\\}/', context), true);
  // A single percent sign or a lone `%` in a string is plain text.
  assert.equal(check({ s: '100%' }, "$.s == '100%'"), true);
  assert.equal(check({ s: '50% off' }, "$.s == '50% off'"), true);
});

test('missing context raises the documented errors', () => {
  assert.throws(() => check({}, '$.a == %nope%'), /Missing context property: nope/);
  assert.throws(() => check({}, '$.a == ${nope}'), /Missing context variable: nope/);
  assert.throws(() => check({}, "$.a == 'x%nope%'"), /Missing context property: nope/);
  assert.throws(() => check({}, "$.a == '${nope}'"), /Missing context variable: nope/);
  assert.throws(() => check({}, '$.a[?(@.b == %nope%)] empty true'), /Missing context property: nope/);
});

test('context inside a path reference is resolved outside filters; filter bodies keep their types', () => {
  assert.equal(check({ abc: 1 }, '$.%p% == 1', context), true);
  assert.equal(check({ x: { 5: 'v' } }, "$.x['${n}'] == 'v'", context), true);
  assert.equal(check({ l: [{ n: 5 }, { n: 6 }] }, '$.l[?(@.n == ${n})].length() == 1', context), true);
  assert.equal(check({ l: [{ s: 'abc' }] }, '$.l[?(@.s == %p%)].length() == 1', context), true);
  assert.equal(check({ l: [{ s: 'abc' }] }, "$.l[?(@.s == '%p%')].length() == 1", context), true);
});

test('equality is structural and independent of object key order', () => {
  const data = { o: { a: 1, b: { c: [1, { d: 2 }] } }, same: { b: { c: [1, { d: 2 }] }, a: 1 }, arr: [1, 2] };
  assert.equal(check(data, '$.o == $.same'), true);
  assert.equal(check(data, '$.o != $.same'), false);
  assert.equal(check(data, '$.o === $.same'), true);
  assert.equal(check({ x: { a: 1, b: 2 }, y: { a: 1, b: 3 } }, '$.x == $.y'), false);
  assert.equal(check({ x: { a: 1 }, y: { a: 1, b: null } }, '$.x == $.y'), false);
  assert.equal(check({ x: [1, 2], y: [2, 1] }, '$.x == $.y'), false);
  assert.equal(check(data, '$.arr == [1, 2]'), true);
  // Jayway converts a numeric string to a number for ==; === keeps the types apart.
  assert.equal(check({ x: 1 }, "$.x == '1'"), true);
  assert.equal(check({ x: 1 }, "$.x === '1'"), false);
  assert.equal(check({ x: 1 }, "$.x != '1'"), false);
  assert.equal(check({ x: 1 }, "$.x == 'one'"), false);
  assert.equal(check({ x: 1 }, "$.x == ''"), false);
  assert.equal(check({ x: 1 }, '$.x == true'), false);
});

test('IN, NIN, SUBSETOF, ANYOF, NONEOF, contains compare members structurally', () => {
  const data = { o: { a: 1, b: 2 }, pool: [{ b: 2, a: 1 }, { c: 3 }], tags: ['a', 'b'] };
  assert.equal(check(data, '$.o in $.pool'), true);
  assert.equal(check(data, '$.o nin $.pool'), false);
  assert.equal(check(data, '$.pool contains $.o'), true);
  assert.equal(check(data, '[$.o] subsetof $.pool'), true);
  assert.equal(check(data, '$.pool anyof [$.o]'), true);
  assert.equal(check(data, '$.pool noneof [$.o]'), false);
  assert.equal(check(data, "$.tags subsetof ['a', 'b', 'c']"), true);
  assert.equal(check(data, "$.tags subsetof ['a']"), false);
  assert.equal(check(data, "$.tags anyof ['z', 'b']"), true);
  assert.equal(check(data, "$.tags noneof ['z']"), true);
  assert.equal(check(data, "'a' in $.tags"), true);
  assert.equal(check({ x: 1 }, "$.x in ['1', 2]"), true);
  assert.equal(check({ x: 1 }, "$.x in ['one', 2]"), false);
  // As in Jayway 2.9.0, a non-list right side makes IN, NIN, SUBSETOF, ANYOF and NONEOF all false.
  assert.equal(check(data, "'a' in 'abc'"), false);
  assert.equal(check(data, "'a' nin 'abc'"), false);
  assert.equal(check(data, "'a' nin ['b']"), true);
  assert.equal(check(data, '$.tags subsetof $.missing'), false);
  assert.equal(check(data, '$.tags noneof $.missing'), false);
});

test('contains needs a string for string input; list members compare like ==', () => {
  assert.equal(check({ s: 'hello' }, "$.s contains 'ell'"), true);
  assert.equal(check({ s: 'undefined' }, '$.s contains $.missing'), false);
  assert.equal(check({ s: 'a1b' }, '$.s contains 1'), false);
  assert.equal(check({ s: 5 }, "$.s contains '5'"), false);
  assert.equal(check({ l: [1, 2] }, '$.l contains 1'), true);
  assert.equal(check({ l: [1, 2] }, "$.l contains '1'"), true);
  assert.equal(check({ l: [1, 2] }, "$.l contains 'one'"), false);
});

test('ordering compares number with number and string with string, anything else is false', () => {
  assert.equal(check({}, "'10' < '9'"), true);
  assert.equal(check({}, '10 < 9'), false);
  assert.equal(check({}, '9 < 10'), true);
  assert.equal(check({}, "'a' < 'b'"), true);
  assert.equal(check({}, "'B' < 'a'"), true);
  assert.equal(check({}, '2.5 >= 2.5'), true);
  assert.equal(check({}, "'abc' >= 'abc'"), true);
  assert.equal(check({}, "'abc' <= 'abd'"), true);
  assert.equal(check({ n: null }, '$.n >= 0'), false);
  assert.equal(check({ n: null }, '$.n <= 0'), false);
  assert.equal(check({ n: null }, '$.n < 1'), false);
  assert.equal(check({}, '$.missing < 1'), false);
  assert.equal(check({}, '$.missing >= 1'), false);
  assert.equal(check({ s: '5' }, '$.s > 1'), false);
  assert.equal(check({ s: '5' }, '$.s < 10'), false);
  assert.equal(check({ b: true }, '$.b > 0'), false);
  assert.equal(check({ a: [1], b: [2] }, '$.a < $.b'), false);
  assert.equal(check({ a: [1], b: [2] }, '$.a <= $.b'), false);
  assert.equal(check({ a: 1 }, '$.a > null'), false);
});

test('missing path and explicit null are different values', () => {
  const data = { n: null, e: '', arr: [], zero: 0, o: {} };
  assert.equal(check(data, '$.n == null'), true);
  assert.equal(check(data, '$.missing == null'), false);
  assert.equal(check(data, '$.missing != null'), true);
  assert.equal(check(data, '$.n != null'), false);
  // A missing operand equals nothing, not even another missing operand (Jayway UndefinedNode).
  assert.equal(check(data, '$.missing == $.alsoMissing'), false);
  assert.equal(check(data, '$.missing != $.alsoMissing'), true);
  assert.equal(check(data, '$.missing === $.alsoMissing'), false);
  assert.equal(check(data, '$.n == $.missing'), false);
  // EMPTY applies to strings and arrays; null, a missing path, numbers and booleans are neither empty nor non-empty.
  for (const path of ['$.e', '$.arr']) {
    assert.equal(check(data, `${path} EMPTY true`), true, path);
    assert.equal(check(data, `${path} EMPTY false`), false, path);
  }
  for (const path of ['$.missing', '$.n', '$.zero']) {
    assert.equal(check(data, `${path} EMPTY true`), false, path);
    assert.equal(check(data, `${path} EMPTY false`), false, path);
  }
  assert.equal(check({ s: 'x', l: [1] }, '$.s EMPTY false'), true);
  assert.equal(check({ s: 'x', l: [1] }, '$.l EMPTY false'), true);
  assert.throws(() => check(data, '$.o EMPTY true'), /EMPTY applies to strings and arrays/);
  // Outside filters a bare path is a truthiness test; inside filters it is an existence test.
  assert.equal(check({ a: false }, '$.a'), false);
  assert.equal(check({ a: 0 }, '$.a'), false);
  assert.equal(check({ a: 'x' }, '$.a'), true);
  assert.equal(check({ l: [{ a: false }] }, '$.l[?(@.a)].length() == 1'), true);
  assert.equal(check({ l: [{ a: null }, {}] }, '$.l[?(@.a)].length() == 1'), true);
});

test('EMPTY requires a boolean and SIZE applies to strings and arrays only', () => {
  assert.throws(() => check({ s: '' }, "$.s EMPTY 'true'"), /EMPTY must be followed by true or false/);
  assert.throws(() => check({ s: '' }, '$.s EMPTY 1'), /EMPTY must be followed by true or false/);
  assert.equal(check({ s: 'ab', a: [1, 2, 3], o: { x: 1 } }, '$.s SIZE 2'), true);
  assert.equal(check({ s: 'ab', a: [1, 2, 3], o: { x: 1 } }, '$.a SIZE 3'), true);
  assert.equal(check({ s: 'ab', a: [1, 2, 3], o: { x: 1 } }, '$.o SIZE 1'), false);
  assert.equal(check({ n: 5 }, '$.n SIZE 0'), false);
  assert.equal(check({ n: null }, '$.n SIZE 0'), false);
  assert.equal(check({}, '$.missing SIZE 0'), false);
  assert.equal(check({ b: false }, '$.b SIZE 0'), false);
});

test('a dead branch does not judge placeholder operands', () => {
  assert.equal(check({}, 'true || $.a EMPTY $.flag'), true);
  assert.equal(check({}, "false && $.a EMPTY 'x'"), false);
  assert.throws(() => check({}, "true && $.a EMPTY 'x'"), /EMPTY must be followed/);
});

test('object literals are not part of the supported condition language', () => {
  assert.throws(() => check({ o: { a: 1 } }, "$.o == {'a': 1}"), /Object literals are not supported in conditions/);
  assert.throws(() => check({ o: { a: 1 } }, '$.o in [{"a": 1}]'), /Object literals are not supported in conditions/);
});

test('array literals may end with a path reference', () => {
  const data = { a: 1, b: 2, l: [1, 2] };
  assert.equal(check(data, '[$.a, $.b] == $.l'), true);
  assert.equal(check(data, '$.a in [$.b, $.a]'), true);
  assert.equal(check(data, '$.l subsetof [$.b, $.a]'), true);
  assert.equal(check(data, '[] == []'), true);
});

test('regex operator matches strings, numbers, booleans and list members only', () => {
  assert.equal(check({ s: 'explorer' }, '$.s =~ /.*plor.*/'), true);
  assert.equal(check({ s: 'EXPLORER' }, '$.s =~ /explorer/i'), true);
  assert.equal(check({ n: 123 }, '$.n =~ /12./'), true);
  assert.equal(check({ b: true }, '$.b =~ /true/'), true);
  assert.equal(check({ l: ['ax', 'by'] }, '$.l =~ /b./'), true);
  assert.equal(check({ l: ['ax', 'by'] }, '$.l =~ /z/'), false);
  // Objects and missing values have no text to match, they must not match through coercion.
  assert.equal(check({ o: { a: 1 } }, '$.o =~ /object/'), false);
  assert.equal(check({ o: { a: 1 } }, '$.o =~ /.+/'), false);
  assert.equal(check({}, '$.missing =~ /undefined/'), false);
  assert.equal(check({ n: null }, '$.n =~ /null/'), false);
  assert.throws(() => check({ s: 'a' }, "$.s =~ 'a'"), /Regex comparison requires/);
});

test('regex operator matches the whole value, like Java Matcher.matches', () => {
  assert.equal(check({ s: 'abc' }, '$.s =~ /b/'), false);
  assert.equal(check({ s: 'abc' }, '$.s =~ /^b/'), false);
  assert.equal(check({ s: 'abc' }, '$.s =~ /.*b.*/'), true);
  assert.equal(check({ s: 'abc' }, '$.s =~ /a|ab|abc/'), true);
  assert.equal(check({ s: 'abc' }, '$.s =~ /ABC/i'), true);
  assert.equal(check({ s: 'a\nb' }, '$.s =~ /a.b/s'), true);
  assert.equal(check({ s: 'a\nb' }, '$.s =~ /a/m'), false);
  assert.equal(check({ l: ['ab', 'c'] }, '$.l =~ /a/'), false);
});

test('aggregate path methods work in comparisons and fail loudly on bad input', () => {
  assert.equal(check({ n: [1, 2, 3] }, '$.n.sum() == 6'), true);
  assert.equal(check({ n: [1, 2, 3] }, '$.n.avg() >= 2'), true);
  assert.equal(check({ n: [1, 2, 3] }, '$.n.max() > $.n.min()'), true);
  assert.throws(() => check({ n: ['a'] }, '$.n.sum() > 0'), /sum\(\) requires numeric values but found "a"/);
  assert.throws(() => check({ n: [] }, '$.n.max() > 0'), /max\(\) cannot be applied to an empty array/);
  assert.throws(() => check({ n: 5 }, '$.n.length() > 0'), /length\(\) requires an array, object or string/);
});

test('boolean structure: nesting, negation, precedence', () => {
  const data = { a: true, b: false };
  assert.equal(check(data, '!($.a && $.b)'), true);
  assert.equal(check(data, '$.a || $.b && $.b'), true);
  assert.equal(check(data, '($.a || $.b) && $.b'), false);
  assert.equal(check(data, '!$.b && $.a'), true);
  assert.equal(check(data, '$.a == true && $.b == false'), true);
  assert.throws(() => check(data, '$.a &&'), /Incomplete condition/);
  assert.throws(() => check(data, '$.a $.b'), /Unsupported condition token/);
  assert.throws(() => check(data, 'unknownWord'), /Unsupported condition identifier/);
});
