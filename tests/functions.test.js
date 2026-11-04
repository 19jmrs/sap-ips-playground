import test from 'node:test';
import assert from 'node:assert/strict';
import countries from 'i18n-iso-countries';
import countryEnglish from 'i18n-iso-countries/langs/en.json' with { type: 'json' };
import { runPipeline } from '../src/engine/index.js';
import { applyFunction, functionRegistry } from '../src/engine/functions/index.js';
import { environment } from '../src/engine/environment.js';

countries.registerLocale(countryEnglish);

// Runs one function through the real pipeline (sourcePath $.value -> targetPath $.value).
function call(value, config, { context, data } = {}) {
  const result = runPipeline({
    data: data ?? { value },
    mode: 'source',
    source: {
      user: {
        mappings: [
          { sourcePath: '$.value', preserveArrayWithSingleElement: true, targetPath: '$.value', functions: [config] },
        ],
      },
    },
    context,
  });
  const entity = result.entities[0];
  if (entity.error) throw new Error(entity.error);
  return entity.output.value;
}

const fn = (name, config) => (value, extra) => call(value, { function: name, ...config }, extra);
const date = (config) => (value) => call(value, { function: 'manipulateDate', ...config });

// A real run of the function registry entry with a minimal context (no pipeline around it).
function direct(value, config, { env = environment(), note } = {}) {
  return applyFunction(value, config, {}, env, undefined, note);
}

// ---------------------------------------------------------------------------------------------
// Java regex translation
// ---------------------------------------------------------------------------------------------

const replaceAll = (text, regex, replacement = '[$0]') =>
  call(text, { function: 'replaceAllString', regex, replacement });

test('Java regex: accepted constructs translate to exact JavaScript equivalents', () => {
  const cases = [
    ['literal and class escapes', 'a.b*c', '\\Q.b*\\E', 'a[.b*]c'],
    ['\\Q..\\E inside a class', 'a.b', '[\\Q.\\E]', 'a[.]b'],
    ['\\Q without \\E quotes to the end', 'x(y)', '\\Q(y)', 'x[(y)]'],
    ['(?i) leading flag', 'ABC abc', '(?i)abc', '[ABC] [abc]'],
    ['(?s) dot matches newline', 'a\nb', '(?s)a.b', '[a\nb]'],
    ['dot excludes \\n \\r and \\u0085 by default', 'a\nb a\rb a\u0085b', 'a.b', 'a\nb a\rb a\u0085b'],
    ['(?m) caret after newline', 'a\nb', '(?m)^b', 'a\n[b]'],
    ['(?m) dollar before newline', 'a\nb', '(?m)a$', '[a]\nb'],
    ['caret without (?m) is start of input only', 'a\nb', '^b', 'a\nb'],
    ['dollar matches before a final \\n', 'a\n', 'a$', '[a]\n'],
    ['dollar matches before a final \\r\\n', 'a\r\n', 'a$', '[a]\r\n'],
    ['dollar does not match before a non-final newline', 'a\nb', 'a$', 'a\nb'],
    ['\\z is the absolute end', 'a\n', 'a\\z', 'a\n'],
    ['\\Z allows a final terminator', 'a\n', 'a\\Z', '[a]\n'],
    ['\\A is the start of input', 'aa', '\\Aa', '[a]a'],
    ['(?x) ignores whitespace and comments', 'ab12', '(?x) [a-z]+ # letters\n \\d+', '[ab12]'],
    ['stacked leading flags', 'A\nb', '(?i)(?s)a.B', '[A\nb]'],
    ['\\h horizontal whitespace', 'a \tb', 'a\\h+b', '[a \tb]'],
    ['\\s is ASCII whitespace only (no NBSP)', 'a\u00a0b a b', 'a\\sb', 'a\u00a0b [a b]'],
    ['\\v vertical whitespace', 'a\u2028b', 'a\\vb', '[a\u2028b]'],
    ['POSIX \\p{Alpha}', 'ab1é', '\\p{Alpha}+', '[ab]1é'],
    ['POSIX \\p{Upper} negated', 'aB', '\\P{Upper}', '[a]B'],
    ['POSIX \\p{Punct}', 'a,b', '\\p{Punct}', 'a[,]b'],
    ['Unicode category \\p{L}', 'éa1', '\\p{L}+', '[éa]1'],
    ['Unicode category \\pL one-letter form', 'éa1', '\\pL+', '[éa]1'],
    ['Unicode script \\p{IsLatin}', 'aб', '\\p{IsLatin}', '[a]б'],
    ['class escape followed by a literal dash', 'a-.b', '[\\w-.]+', '[a-.b]'],
    ['category inside a class', 'a1-', '[\\p{L}\\d]+', '[a1]-'],
    ['named group and \\k<name>', 'aab', '(?<c>a)\\k<c>', '[aa]b'],
    ['numbered back reference', 'aab', '(a)\\1', '[aa]b'],
    ['back reference followed by a digit', 'aa1', '(a)\\11', '[aa1]'],
    ['positive lookahead', 'a1 ab', 'a(?=1)', '[a]1 ab'],
    ['lazy quantifier', '<a><b>', '<.+?>', '[<a>][<b>]'],
    ['interval quantifiers', 'aaaa', 'a{2,3}', '[aaa]a'],
    ['\\x and \\u escapes', 'A😀', '\\x41|\\uD83D\\uDE00', '[A][😀]'],
    ['\\x{...} code point', '😀', '\\x{1F600}', '[😀]'],
    ['dot matches a whole supplementary character', '😀', '^.$', '[😀]'],
    ['stray ] and } are literals', 'a]}', ']}', 'a[]}]'],
    ['a literal / and -', 'a/b-c', '/b-', 'a[/b-]c'],
    ['class range with escaped bracket', 'a]', '[\\]a]+', '[a]]'],
    ['\\b on ASCII text', 'foo bar', '\\bbar', 'foo [bar]'],
    ['(?iu) folds non-ASCII letters', 'Éa', '(?iu)é', '[É]a'],
  ];
  for (const [label, text, regex, expected] of cases) {
    assert.equal(replaceAll(text, regex), expected, label);
  }
});

test('Java regex: unsupported or ambiguous constructs are rejected with the function and pattern named', () => {
  const rejected = [
    ['(?!a)', /Negative lookahead/],
    ['a(?!b)', /Negative lookahead/],
    ['(?<=a)b', /lookbehind/],
    ['(?<!a)b', /lookbehind/],
    ['(?>a)', /atomic groups/],
    ['a++', /possessive/],
    ['a*+', /possessive/],
    ['a?+', /possessive/],
    ['a{2}+', /possessive/],
    ['a(?i)b', /only supported at the start/],
    ['a(?i:b)', /only supported at the start/],
    ['(?d)a', /UNIX_LINES/],
    ['(?U)a', /UNICODE_CHARACTER_CLASS/],
    ['(?z)a', /unknown inline flag/],
    ['(?#comment)a', /unsupported group construct/],
    ['[a[b]]', /nested character classes/],
    ['[a-z&&[^b]]', /intersection/],
    ['[]a]', /leading \]/],
    ['[^]a]', /leading \]/],
    ['[z-a]', /illegal character range/],
    ['[\\S]', /cannot be used inside a character class/],
    ['[\\P{Alpha}]', /not supported inside a character class/],
    ['[\\b]', /not valid inside a character class/],
    ['\\G', /unsupported or illegal escape/],
    ['\\R', /unsupported or illegal escape/],
    ['\\X', /unsupported or illegal escape/],
    ['\\cA', /unsupported or illegal escape/],
    ['\\012', /unsupported or illegal escape/],
    ['\\E', /unsupported or illegal escape/],
    ['\\q', /unsupported or illegal escape/],
    ['\\b{g}', /boundaries/],
    ['\\p{javaLowerCase}', /unsupported property/],
    ['\\p{InGreek}', /unsupported property/],
    ['\\p{IsNoSuchScript}', /unsupported property/],
    ['(a)\\2', /does not exist/],
    ['\\k<nope>', /named group defined earlier/],
    ['(?<1a>x)', /illegal named group/],
    ['(?<n>a)(?<n>b)', /defined twice/],
    ['(a', /unclosed group/],
    ['a)', /unmatched/],
    ['[a', /unclosed character class/],
    ['a\\', /ends with a backslash/],
    ['a{', /illegal repetition/],
    ['a{,3}', /illegal repetition/],
    ['*a', /Nothing to repeat/],
    ['(?i)é', /non-ASCII pattern characters/],
    ['(?i)\\p{Lower}', /depends on the JDK version/],
  ];
  for (const [regex, reason] of rejected) {
    for (const name of ['matchRegex', 'replaceAllString']) {
      const config = { function: name, regex, ...(name === 'replaceAllString' && { replacement: 'x' }) };
      assert.throws(
        () => call('abc', config),
        (error) => {
          assert.ok(error.message.includes(`${name}:`), `${regex}: names the function`);
          assert.ok(error.message.includes(JSON.stringify(regex)), `${regex}: names the pattern`);
          assert.doesNotMatch(
            error.message,
            /^source mapping 1: Invalid regular expression/,
            `${regex}: raw SyntaxError`,
          );
          assert.match(error.message, reason, regex);
          return true;
        },
      );
    }
  }
});

test('Java regex: patterns that are only exact for ASCII text reject non-ASCII text instead of guessing', () => {
  assert.equal(replaceAll('foo bar', '\\bbar'), 'foo [bar]');
  assert.throws(() => replaceAll('foo é', '\\bfoo'), /cannot be applied safely.*JDK version/);
  assert.throws(() => replaceAll('foo é', 'foo\\B'), /cannot be applied safely/);
  // ſ (U+017F) and K (U+212A) fold onto s and k in JavaScript but not in Java's ASCII-only (?i).
  assert.equal(replaceAll('aS', '(?i)as'), '[aS]');
  assert.throws(() => replaceAll('aſ', '(?i)as'), /cannot be applied safely.*U\+017F/);
  assert.equal(replaceAll('é', '(?i)x'), 'é');
});

test('regex replacement strings use Java syntax, not JavaScript syntax', () => {
  const cases = [
    ['group references', '2024-01-31', '(\\d+)-(\\d+)-(\\d+)', '$3.$2.$1', '31.01.2024'],
    ['$0 is the whole match', 'a1b22', '\\d+', '<$0>', 'a<1>b<22>'],
    ['escaped dollar is a literal', 'price', 'price', '\\$5', '$5'],
    ['escaped backslash', 'a', 'a', '\\\\', '\\'],
    ['backslash escapes any character', 'a', 'a', '\\x\\y', 'xy'],
    ['extra digits only extend a reference to an existing group', 'abc', '(b)', '$10', 'ab0c'],
    ['two-digit reference when the group exists', 'abcdefghijkl', '(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)', '$11', 'kl'],
    ['a group that did not participate is empty', 'ac', '(a)(b)?', '[$2]', '[]c'],
    ['numbers as regex and replacement', 'a14b', 14, 99, 'a99b'],
  ];
  for (const [label, text, regex, replacement, expected] of cases) {
    assert.equal(call(text, { function: 'replaceAllString', regex, replacement }), expected, label);
  }

  // JavaScript-only tokens must error exactly like Java's "illegal group reference", not expand.
  for (const replacement of ['$&', '$`', "$'", '$$', '$<name>', '$x', 'cost $', '$']) {
    assert.throws(
      () => replaceAll('abc', 'b', replacement),
      /invalid replacement.*illegal group reference/,
      replacement,
    );
  }
  assert.throws(() => replaceAll('abc', '(b)', '$2'), /invalid replacement "\$2": no group 2/);
  assert.throws(() => replaceAll('abc', 'b', '$1'), /no group 1/);
  assert.throws(() => replaceAll('abc', 'b', 'x\\'), /character to be escaped is missing/);
  // Like Matcher.appendReplacement, the template is only interpreted when something matched.
  assert.equal(replaceAll('abc', 'z', '$x'), 'abc');
});

test('${name} replacements follow Java when the function runs without variable interpolation in front', () => {
  const run = (replacement, regex = '(?<mid>b)') =>
    functionRegistry.replaceAllString.run(
      'abc',
      {},
      { name: 'replaceAllString', required: (key) => ({ regex, replacement })[key] },
    );
  assert.equal(run('[${mid}]'), 'a[b]c');
  assert.throws(() => run('${nope}'), /no group with name nope/);
  assert.throws(() => run('${mid'), /missing trailing '}'/);
  assert.throws(() => run('${}'), /0 length name/);
  assert.throws(() => run('${1a}'), /starts with digit/);
  // Through the pipeline `${...}` is first resolved as a context variable (documented IPS syntax).
  assert.throws(
    () => call('abc', { function: 'replaceAllString', regex: '(?<mid>b)', replacement: '${mid}' }),
    /Missing context variable: mid/,
  );
});

test('replaceFirst/Last/All with an empty regex follow java.util.regex (match before every character and at the end)', () => {
  assert.equal(call('ab', { function: 'replaceAllString', regex: '', replacement: '-' }), '-a-b-');
  assert.equal(call('ab', { function: 'replaceFirstString', regex: '', replacement: '-' }), '-ab');
  assert.equal(call('ab', { function: 'replaceLastString', regex: '', replacement: '-' }), 'ab-');
  assert.equal(call('', { function: 'replaceAllString', regex: '', replacement: '-' }), '-');
  assert.equal(call('ab', { function: 'matchRegex', regex: '' }), true);
  assert.equal(call('ab', { function: 'getMatchedRegexGroup', regex: '', groupIndex: 0 }), '');
});

test('replaceLastString replaces the last successive match in place, with Java replacement syntax', () => {
  const last = (text, regex, replacement) => call(text, { function: 'replaceLastString', regex, replacement });
  assert.equal(last('a1-a2-a3', 'a\\d', 'b'), 'a1-a2-b');
  assert.equal(last('no digits', '\\d', 'b'), 'no digits');
  // Groups and escapes use Java syntax and the match's own groups.
  assert.equal(last('k1=v1;k2=v2', '(\\w)(\\d)=', '$2$1='), 'k1=v1;2k=v2');
  assert.equal(last('a.b.c', '\\.', '\\$'), 'a.b$c');
  // Context-dependent matches (lookahead/anchors/boundaries) are decided on the full text, not on the matched substring.
  assert.equal(last('a1 a2 a3', 'a(?=\\d)', 'X'), 'a1 a2 X3');
  assert.equal(last('ab', '$', 'X'), 'abX');
  assert.equal(last('ab ab', '^ab', 'X'), 'X ab');
  assert.equal(last('foo foo', '\\bfoo', 'X'), 'foo X');
  // Zero-length: the last match is the empty match at the end of the text.
  assert.equal(last('abc', 'x*', '-'), 'abc-');
  // Overlapping candidates are not considered (successive Matcher.find() results): "aa" in "aaa" is at 0.
  assert.equal(last('aaa', 'aa', 'X'), 'Xa');
  assert.throws(() => last('a', 'a', '$'), /illegal group reference/);
});

test('matchRegex / getMatchedRegexGroup: documented example, group bounds and the unverified find decision', () => {
  const group = (text, regex, groupIndex) => call(text, { function: 'getMatchedRegexGroup', regex, groupIndex });
  // SAP example (Provisioning_Service.pdf p.508): nested path taken from a DN.
  assert.equal(group('CN=test10,OU=subUsers,OU=testUsers', '(?i)cn=.*?,(.*?),OU=testUsers', 1), 'OU=subUsers');
  assert.equal(group('id:123', 'id:(\\d+)', 0), 'id:123');
  assert.equal(group('id:123', '(i)(d)', 2), 'd');
  assert.throws(() => group('abc', '(b)', 2), /no group 2 \(the regex has 1\)/);
  assert.throws(() => group('abc', '(b)', -1), /no group -1/);
  assert.throws(() => group('abc', '(b)', '1'), /groupIndex must be an integer/);
  assert.throws(() => group('abc', '(b)', 1.5), /groupIndex must be an integer/);
  assert.throws(() => group('abc', '(z)', 1), /Function produced no value/);
  // A group that exists but did not take part gives no value (Java: null).
  assert.throws(() => group('ac', 'a(b)?c', 1), /Function produced no value/);

  const matches = (text, regex) => call(text, { function: 'matchRegex', regex });
  // SAP example regex ".*_COMP" (p.514). A substring match is the current, unverified decision.
  assert.equal(matches('SAP_02_COMP', '.*_COMP'), true);
  assert.equal(matches('SAP_02_COMPOSITE', '.*_COMP'), true, 'find semantics: substring matches');
  assert.equal(matches('abc', 'b'), true);
  assert.equal(matches('abc', '^b'), false);
  assert.equal(matches(12, '1'), true, 'numbers are matched by their string form');
});

test('string functions reject null, arrays and objects instead of stringifying them', () => {
  for (const bad of [null, { a: 1 }, ['a']]) {
    for (const config of [
      { function: 'concatString', prefix: 'x' },
      { function: 'replaceString', target: 'a', replacement: 'b' },
      { function: 'replaceAllString', regex: 'a', replacement: 'b' },
      { function: 'matchRegex', regex: 'a' },
      { function: 'substring', beginIndex: 0 },
      { function: 'toUpperCaseString' },
      { function: 'splitStringToArray', separator: ',' },
    ]) {
      assert.throws(
        () => call(bad, config),
        /requires a string, number or boolean input/,
        `${config.function} ${JSON.stringify(bad)}`,
      );
    }
  }
  assert.equal(call('x', { function: 'concatString', prefix: 1, suffix: true }), '1xtrue');
  assert.equal(call(5, { function: 'concatString', prefix: 'n' }), 'n5');
  assert.throws(() => call('x', { function: 'concatString', prefix: { a: 1 } }), /concatString prefix requires/);
  assert.throws(
    () => call('x', { function: 'replaceString', target: ['a'], replacement: 'b' }),
    /target must be a string or number/,
  );
});

// ---------------------------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------------------------

test('encode/decode: SAP example, RFC 4648 vectors and padding options', () => {
  const encode = (value, algorithm, skipPadding) => call(value, { function: 'encode', algorithm, skipPadding });
  // Provisioning_Service.pdf p.506: JOHN*SMITH/Junior -> JJHUQTRKKNGUSVCIF5FHK3TJN5ZA====
  assert.equal(encode('JOHN*SMITH/Junior', 'base32'), 'JJHUQTRKKNGUSVCIF5FHK3TJN5ZA====');
  assert.equal(encode('JOHN*SMITH/Junior', 'base32', true), 'JJHUQTRKKNGUSVCIF5FHK3TJN5ZA');
  const vectors = [
    ['', '', ''],
    ['f', 'MY======', 'Zg=='],
    ['fo', 'MZXQ====', 'Zm8='],
    ['foo', 'MZXW6===', 'Zm9v'],
    ['foob', 'MZXW6YQ=', 'Zm9vYg=='],
    ['fooba', 'MZXW6YTB', 'Zm9vYmE='],
    ['foobar', 'MZXW6YTBOI======', 'Zm9vYmFy'],
  ];
  for (const [text, base32, base64] of vectors) {
    assert.equal(encode(text, 'base32'), base32, `base32 ${text}`);
    assert.equal(encode(text, 'base64'), base64, `base64 ${text}`);
    assert.equal(encode(text, 'base64', true), base64.replace(/=+$/, ''));
    assert.equal(call(base32, { function: 'decode', algorithm: 'base32' }).length, text.length);
  }
  // Decode with skipPadding (SAP example) and chain into toString.
  const roundTrip = (encoded, algorithm, skipPadding) => call(encoded, { function: 'decode', algorithm, skipPadding });
  assert.deepEqual(roundTrip('JJHUQTRKKNGUSVCIF5FHK3TJN5ZA====', 'base32', true), [
    ...Buffer.from('JOHN*SMITH/Junior'),
  ]);
  assert.deepEqual(roundTrip('JJHUQTRKKNGUSVCIF5FHK3TJN5ZA', 'base32', false), [...Buffer.from('JOHN*SMITH/Junior')]);
  assert.deepEqual(roundTrip('Zm9vYg', 'base64'), [...Buffer.from('foob')]);
  assert.deepEqual(roundTrip('Zm9vYg==', 'base64'), [...Buffer.from('foob')]);
  assert.throws(() => encode('x', 'base16'), /Unsupported encode algorithm/);
  assert.throws(
    () => call('x', { function: 'encode', algorithm: 'base64', skipPadding: 'yes' }),
    /skipPadding must be a boolean/,
  );
});

test('encode/decode go through UTF-8 bytes, never Latin-1', () => {
  const text = 'héllo € 😀 日本語';
  const encoded = call(text, { function: 'encode', algorithm: 'base64' });
  assert.equal(encoded, Buffer.from(text).toString('base64'));
  assert.equal(
    call(text, { function: 'encode', algorithm: 'base32' }).replace(/=+$/, '').length,
    Math.ceil((Buffer.byteLength(text) * 8) / 5),
  );
  for (const algorithm of ['base32', 'base64']) {
    const result = runPipeline({
      data: { value: text },
      mode: 'source',
      source: {
        user: {
          mappings: [
            {
              sourcePath: '$.value',
              targetPath: '$.value',
              functions: [
                { function: 'encode', algorithm },
                { function: 'decode', algorithm },
                { function: 'toString' },
              ],
            },
          ],
        },
      },
    });
    assert.equal(result.entities[0].output.value, text, algorithm);
  }
  assert.throws(() => call('a\ud800b', { function: 'encode', algorithm: 'base64' }), /unpaired surrogate/);
  assert.equal(call(123, { function: 'encode', algorithm: 'base64' }), Buffer.from('123').toString('base64'));
});

test('encode validates byte arrays for base32 and base64 (integers 0-255 only)', () => {
  for (const algorithm of ['base32', 'base64']) {
    const encode = (bytes) => call(bytes, { function: 'encode', algorithm });
    const bytes = [0, 255, 16, 128];
    assert.deepEqual(call(encode(bytes), { function: 'decode', algorithm }), bytes, `${algorithm} round trip`);
    for (const bad of [[256], [-1], [1.5], ['a'], [null], [1, 2, 300], [NaN]]) {
      assert.throws(() => encode(bad), /byte array must contain integers 0-255/, `${algorithm} ${JSON.stringify(bad)}`);
    }
    assert.throws(() => encode(null), /requires a string, number or boolean input/);
    assert.throws(() => encode({ a: 1 }), /requires a string, number or boolean input/);
  }
  assert.equal(call([102, 111, 111], { function: 'encode', algorithm: 'base64' }), 'Zm9v');
  assert.equal(call([102, 111, 111], { function: 'encode', algorithm: 'base32' }), 'MZXW6===');
  // A byte value above 255 used to bleed into the base32 buffer / wrap modulo 256 in base64.
  assert.throws(() => call([256 + 102], { function: 'encode', algorithm: 'base64' }), /integers 0-255/);
});

test('decode rejects malformed input and bad padding explicitly', () => {
  const decode = (value, algorithm) => call(value, { function: 'decode', algorithm });
  const bad64 = [
    ['abc$', /unexpected character "\$"/],
    ['Zm9v YmFy', /unexpected character " "/],
    ['Zm9v\n', /unexpected character/],
    ['Zm-_', /URL-safe base64 is not supported/],
    ['Q', /length 1 is impossible/],
    ['QQ=', /wrong amount of '=' padding/],
    ['QQ===', /wrong amount of '=' padding/],
    ['Zm9v=', /wrong amount of '=' padding/],
    ['QQ=Q', /padding may only appear at the end/],
    ['=', /wrong amount|impossible/],
    ['é', /unexpected character/],
  ];
  for (const [input, reason] of bad64)
    assert.throws(() => decode(input, 'base64'), reason, `base64 ${JSON.stringify(input)}`);
  const bad32 = [
    ['mzxw6===', /base32 symbols are upper case/],
    ['MZXW1===', /unexpected character "1"/],
    ['MZXW6==', /wrong amount of '=' padding/],
    ['MZXW6====', /wrong amount of '=' padding/],
    ['M', /impossible/],
    ['MZX', /impossible/],
    ['MZXW6Y=Q', /padding may only appear at the end/],
  ];
  for (const [input, reason] of bad32)
    assert.throws(() => decode(input, 'base32'), reason, `base32 ${JSON.stringify(input)}`);
  assert.throws(() => decode(123, 'base64'), /requires a string input/);
  assert.throws(() => decode(null, 'base64'), /requires a string input/);
  assert.deepEqual(decode('', 'base64'), []);
  assert.deepEqual(decode('', 'base32'), []);
});

test('toString decodes UTF-8 strictly and coerces non-arrays explicitly', () => {
  const toText = (value) => call(value, { function: 'toString' });
  assert.equal(toText([0xe2, 0x82, 0xac]), '€');
  assert.equal(toText([0xf0, 0x9f, 0x98, 0x80]), '😀');
  assert.equal(direct([], { function: 'toString' }), '');
  assert.equal(toText([0xef, 0xbb, 0xbf, 0x61]), '\ufeffa', 'a BOM is kept, like new String(bytes, UTF_8)');
  for (const malformed of [[0xff], [0xc3], [0xc0, 0x80], [0xed, 0xa0, 0x80], [0xe2, 0x82]]) {
    assert.throws(() => toText(malformed), /not valid UTF-8/, JSON.stringify(malformed));
  }
  assert.throws(() => toText([256]), /integers 0-255/);
  assert.throws(() => toText(['a']), /integers 0-255/);
  assert.equal(toText('plain'), 'plain');
  assert.equal(toText(42), '42');
  assert.equal(toText(true), 'true');
  assert.throws(() => direct(null, { function: 'toString' }), /requires a string, number or boolean input/);
  assert.throws(() => toText({ a: 1 }), /requires a string, number or boolean input/);
});

// ---------------------------------------------------------------------------------------------
// Country conversions
// ---------------------------------------------------------------------------------------------

const countryCode = (value, outputFormat) => call(value, { function: 'convertCountryCode', outputFormat });

test('convertCountryCode accepts alpha-2, alpha-3, numeric, English names and case variants identically', () => {
  const ambiguousNames = new Set(['congo']);
  const names = countries.getNames('en', { select: 'all' });
  assert.ok(Object.keys(names).length >= 249);
  for (const [alpha2, nameList] of Object.entries(names)) {
    const alpha3 = countries.alpha2ToAlpha3(alpha2);
    const numeric = countries.alpha2ToNumeric(alpha2);
    const spellings = [alpha2, alpha2.toLowerCase(), alpha3, alpha3.toLowerCase(), numeric];
    for (const name of [nameList].flat()) {
      if (ambiguousNames.has(name.toLowerCase())) continue;
      spellings.push(name, name.toUpperCase(), name.toLowerCase());
    }
    for (const spelling of spellings) {
      assert.equal(countryCode(spelling, 'alpha2'), alpha2, `${spelling} -> ${alpha2}`);
    }
    assert.equal(countryCode(alpha2, 'alpha3'), alpha3);
    assert.equal(countryCode(alpha2, 'numeric'), numeric);
  }
  assert.equal(countryCode(840, 'alpha2'), 'US', 'JSON integer numeric code');
  assert.equal(countryCode(4, 'numeric'), '004', 'numeric output keeps leading zeros');
  assert.equal(countryCode(4, 'alpha2'), 'AF');
});

test('convertCountryCode: documented United States example, ambiguous and unknown inputs fail cleanly', () => {
  // Provisioning_Service.pdf p.478: "United States" -> US / USA / 840 / United States.
  assert.equal(countryCode('United States', 'alpha2'), 'US');
  assert.equal(countryCode('United States', 'alpha3'), 'USA');
  assert.equal(countryCode('United States', 'numeric'), '840');
  assert.equal(countryCode('United States', 'fullName'), 'United States');
  assert.equal(countryCode('de', 'fullName'), 'Germany');
  assert.throws(() => countryCode('Congo', 'alpha2'), /Ambiguous country name "Congo": CG, CD/);
  for (const unknown of ['Missingland', '', ' US', 'XX', 'ZZZ', '999', '84', 'USAA', '(+', '.*', '$1', 'undefined']) {
    assert.throws(
      () => countryCode(unknown, 'alpha2'),
      (error) => {
        assert.match(error.message, /Unknown country/, JSON.stringify(unknown));
        assert.doesNotMatch(error.message, /Invalid regular expression/);
        return true;
      },
    );
  }
  for (const bad of [null, {}, true, 1.5]) {
    assert.throws(() => countryCode(bad, 'alpha2'), /requires a country name or code/, JSON.stringify(bad));
  }
  assert.throws(
    () => call('US', { function: 'convertCountryCode', outputFormat: 'alpha4' }),
    /Invalid convertCountryCode outputFormat/,
  );
});

test('convertCountryCode inputAttributes: single name or list, object result, safe keys', () => {
  const convert = (value, config) =>
    call(value, { function: 'convertCountryCode', outputFormat: 'alpha2', outputAttribute: 'iso', ...config });
  // SAP: inputAttributes is a "single value or list of address attributes".
  assert.deepEqual(convert({ country: 'Germany' }, { inputAttributes: 'country' }), { country: 'Germany', iso: 'DE' });
  assert.deepEqual(convert({ country: 'Germany' }, { inputAttributes: ['country'] }), {
    country: 'Germany',
    iso: 'DE',
  });
  assert.deepEqual(convert({ issuingCountry: 'FR' }, { inputAttributes: ['country', 'issuingCountry'] }), {
    issuingCountry: 'FR',
    iso: 'FR',
  });
  assert.deepEqual(convert([{ country: 'Germany' }, { country: 'France' }], { inputAttributes: ['country'] }), [
    { country: 'Germany', iso: 'DE' },
    { country: 'France', iso: 'FR' },
  ]);
  assert.throws(() => convert({ other: 'x' }, { inputAttributes: ['country'] }), /input attribute missing/);
  assert.throws(
    () => convert({ country: 'Germany' }, { inputAttributes: [] }),
    /inputAttributes must be an attribute name/,
  );
  assert.throws(
    () => convert({ country: 'Germany' }, { inputAttributes: 5 }),
    /inputAttributes must be an attribute name/,
  );
  assert.throws(() => convert('Germany', { inputAttributes: ['country'] }), /requires an object/);
  assert.throws(
    () => convert({ country: 'Germany' }, { inputAttributes: ['country'], outputAttribute: '__proto__' }),
    /Unsafe|unsafe/,
  );
});

test('convertCountryRegion: country spellings, region codes/names, dataset defects', () => {
  const region = (country, regionInput, outputFormat = 'alpha2') =>
    call(
      { country, region: regionInput },
      {
        function: 'convertCountryRegion',
        inputAttributes: ['country', 'region'],
        outputAttribute: 'region',
        outputFormat,
      },
    ).region;
  // Provisioning_Service.pdf p.479: "US-AL or only AL" -> US-AL / Alabama.
  for (const input of ['US-AL', 'AL', 'us-al', 'al', 'Alabama', 'alabama']) {
    assert.equal(region('US', input, 'alpha2'), 'US-AL', input);
    assert.equal(region('United States', input, 'fullName'), 'Alabama', input);
  }
  for (const country of ['US', 'us', 'USA', 'usa', '840', 840, 'United States']) {
    assert.equal(region(country, 'AL'), 'US-AL', String(country));
  }
  // The dataset stores some codes with the country prefix ("DK-84"); the result must not double it.
  assert.equal(region('DK', '84'), 'DK-84');
  assert.equal(region('DK', 'DK-84'), 'DK-84');
  assert.equal(region('DK', 'Hovedstaden'), 'DK-84');
  // Regions without any ISO code in the dataset: names work, codes cannot be produced or matched.
  assert.equal(region('PR', 'San Juan', 'fullName'), 'San Juan');
  assert.throws(() => region('PR', 'San Juan', 'alpha2'), /has no ISO 3166-2 code/);
  assert.throws(() => region('PR', 'undefined', 'fullName'), /Unknown region: undefined for country PR/);
  assert.throws(() => region('MK', '', 'fullName'), /Unknown region/);
  // Failure modes are explicit, never a SyntaxError or an undefined leaking into a pattern.
  assert.throws(() => region('Missingland', 'AL'), /Unknown country: Missingland/);
  assert.throws(() => region('(+', 'AL'), /Unknown country: \(\+/);
  assert.throws(() => region('.*', 'AL'), /Unknown country/);
  assert.throws(() => region(undefined, 'AL'), /requires a country name or code/);
  assert.throws(() => region('DE', 'AL'), /Unknown region: AL for country DE/);
  assert.throws(() => region('DE', 'US-AL'), /Unknown region/);
  assert.throws(() => region('US', 'ZZ'), /Unknown region: ZZ for country US/);
  assert.throws(() => region('US', undefined), /Unknown region/);
  assert.throws(() => region('US', ''), /Unknown region/);
  assert.throws(() => region('US', 5), /Unknown region/);
  assert.throws(() => region('Congo', 'AL'), /Ambiguous country name/);
});

// ---------------------------------------------------------------------------------------------
// Timezone / locale conversions
// ---------------------------------------------------------------------------------------------

test('convertTimezoneCode reports when the documented fallback replaced the value', () => {
  const notes = [];
  const note = (key, value) => notes.push([key, value]);
  const convert = (value, outputFormat) => direct(value, { function: 'convertTimezoneCode', outputFormat }, { note });

  assert.equal(convert('America/Phoenix', 'sap'), 'MSTNO');
  assert.equal(convert('AST', 'iana'), 'America/Halifax');
  assert.deepEqual(notes, [], 'mapped values leave no note');

  assert.equal(convert('not-a-zone', 'sap'), 'CET');
  assert.deepEqual(notes.splice(0), [['fallbackUsed', true]]);
  assert.equal(convert('not-a-zone', 'iana'), 'Europe/Berlin');
  assert.deepEqual(notes.splice(0), [['fallbackUsed', true]]);
  assert.equal(convert(null, 'iana'), 'Europe/Berlin');
  assert.deepEqual(notes.splice(0), [['fallbackUsed', true]]);
  // Without a hook the function still works (the hook is optional).
  assert.equal(direct('not-a-zone', { function: 'convertTimezoneCode', outputFormat: 'sap' }), 'CET');
  // applyOnElements notes every element that fell back.
  assert.deepEqual(
    direct(
      ['AST', 'zzz', 'yyy'],
      { function: 'convertTimezoneCode', outputFormat: 'sap', applyOnElements: true },
      { note },
    ),
    ['AST', 'CET', 'CET'],
  );
  assert.equal(notes.length, 2);
  assert.throws(() => convert('AST', 'windows'), /Invalid convertTimezoneCode outputFormat/);
});

test('convertLocaleCode: mapped values, documented English fallback is observable, table errors are explicit', () => {
  const mappings = [
    ['EN', 'en-US'],
    ['DE', 'de-DE'],
  ];
  const notes = [];
  const convert = (value, outputFormat, localeMappings = mappings) =>
    direct(
      value,
      { function: 'convertLocaleCode', outputFormat },
      { env: environment({ localeMappings }), note: (k, v) => notes.push([k, v]) },
    );

  assert.equal(convert('DE', 'bcp47'), 'de-DE');
  assert.equal(convert('de-DE', 'iso639'), 'DE');
  assert.equal(convert('de-DE', 'bcp47'), 'de-DE');
  assert.deepEqual(notes, []);

  // SAP: languages without a mapping (EO, IA, IO) are mapped to English.
  assert.equal(convert('EO', 'bcp47'), 'en-US');
  assert.equal(convert('EO', 'iso639'), 'EN');
  assert.equal(convert(null, 'iso639'), 'EN');
  assert.deepEqual(notes.splice(0), [
    ['fallbackUsed', true],
    ['fallbackUsed', true],
    ['fallbackUsed', true],
  ]);

  // English comes from the supplied table: no EN row means no invented BCP 47 code.
  assert.equal(convert('EO', 'iso639', [['DE', 'de-DE']]), 'EN');
  assert.throws(() => convert('EO', 'bcp47', [['DE', 'de-DE']]), /needs an EN entry/);
  assert.throws(() => convert('DE', 'bcp47', [['DE']]), /localeMappings\[0\] must be an \[ISO639, BCP47\] pair/);
  assert.throws(() => convert('DE', 'bcp47', [['DE', 1]]), /localeMappings\[0\]/);
  assert.throws(() => convert('DE', 'bcp47', ['DE']), /localeMappings\[0\]/);
  assert.throws(() => convert('DE', 'bcp47', null), /requires context.localeMappings/);
  assert.throws(() => convert('DE', 'xx'), /Invalid convertLocaleCode outputFormat/);
});

// ---------------------------------------------------------------------------------------------
// manipulateDate
// ---------------------------------------------------------------------------------------------

test('manipulateDate: SAP documented formats and examples', () => {
  // p.510/512: "2018-02-28 11:00:00.000" -> "02/28/2018"; days "3" and hours "+2" are strings.
  assert.equal(
    date({ sourceDateFormat: 'yyyy-MM-dd HH:mm:ss.SSS', targetDateFormat: 'MM/dd/yyyy' })('2018-02-28 11:00:00.000'),
    '02/28/2018',
  );
  assert.equal(
    date({ targetDateFormat: 'yyyy-MM-dd HH:mm:ss.SSS', days: '3', hours: '+2' })('2018-02-28 11:00:00.000'),
    '2018-03-03 13:00:00.000',
  );
  // Default source format is the currentDate format.
  assert.equal(date({ targetDateFormat: 'yyyy-MM-dd' })('2018-02-28 11:00:00.000'), '2018-02-28');
  // p.511 notes: yyyy-MM-dd'T'HH:mm:ss'Z', d MMM uuuu, HH:mm dd/MM/yyyy.
  assert.equal(
    date({ sourceDateFormat: "yyyy-MM-dd'T'HH:mm:ss'Z'", targetDateFormat: 'HH:mm dd/MM/yyyy' })(
      '2024-03-05T07:08:09Z',
    ),
    '07:08 05/03/2024',
  );
  assert.equal(date({ sourceDateFormat: 'd MMM uuuu', targetDateFormat: 'yyyy-MM-dd' })('5 Mar 2024'), '2024-03-05');
  assert.equal(date({ sourceDateFormat: 'yyyy-MM-dd', targetDateFormat: 'd MMMM uuuu' })('2024-03-05'), '5 March 2024');
  assert.equal(
    date({ sourceDateFormat: 'HH:mm dd/MM/yyyy', targetDateFormat: "yyyy-MM-dd'T'HH:mm" })('07:08 05/03/2024'),
    '2024-03-05T07:08',
  );
});

test('manipulateDate: leap years, month-end clamping and ordering of the shifts', () => {
  const shift = (value, config) =>
    date({ sourceDateFormat: 'yyyy-MM-dd', targetDateFormat: 'yyyy-MM-dd', ...config })(value);
  // Leap years (divisible by 4, not by 100 unless by 400).
  assert.equal(shift('2024-02-28', { days: 1 }), '2024-02-29');
  assert.equal(shift('2023-02-28', { days: 1 }), '2023-03-01');
  assert.equal(shift('2100-02-28', { days: 1 }), '2100-03-01');
  assert.equal(shift('2000-02-28', { days: 1 }), '2000-02-29');
  assert.equal(shift('2024-02-29', { years: 1 }), '2025-02-28');
  assert.equal(shift('2024-02-29', { years: 4 }), '2028-02-29');
  assert.equal(shift('2024-12-31', { days: 1 }), '2025-01-01');
  assert.equal(shift('2024-12-31', { days: 365 }), '2025-12-31');
  assert.equal(shift('2024-12-31', { days: 366 }), '2026-01-01');
  // Month-end clamping like java.time plusMonths / Calendar.add.
  assert.equal(shift('2024-01-31', { months: 1 }), '2024-02-29');
  assert.equal(shift('2023-01-31', { months: 1 }), '2023-02-28');
  assert.equal(shift('2024-03-31', { months: -1 }), '2024-02-29');
  assert.equal(shift('2024-05-31', { months: 1 }), '2024-06-30');
  assert.equal(shift('2024-01-31', { months: 12 }), '2025-01-31');
  assert.equal(shift('2024-01-31', { months: 25 }), '2026-02-28');
  // Negative amounts, including across year boundaries.
  assert.equal(shift('2024-03-01', { days: -1 }), '2024-02-29');
  assert.equal(shift('2024-01-15', { months: -13 }), '2022-12-15');
  assert.equal(shift('2024-01-01', { days: -1 }), '2023-12-31');
  assert.equal(shift('2024-01-01', { years: -2023 }), '0001-01-01');
  // years, months, days are applied in that order, each step on the previous result.
  assert.equal(shift('2023-01-31', { months: 1, days: -1 }), '2023-02-27', 'months before days: 02-28 then -1');
  assert.equal(shift('2024-02-29', { years: 1, months: 1 }), '2025-03-28', 'years clamp to 02-28 first');
  // String amounts as in the SAP examples.
  assert.equal(shift('2024-01-10', { days: '+2', months: '-1' }), '2023-12-12');
  assert.equal(shift('2024-01-10', { days: 0 }), '2024-01-10');
});

test('manipulateDate: time-of-day shifts carry across days with negative offsets', () => {
  const shift = (value, config) =>
    date({ sourceDateFormat: 'yyyy-MM-dd HH:mm:ss', targetDateFormat: 'yyyy-MM-dd HH:mm:ss', ...config })(value);
  assert.equal(shift('2024-02-28 23:30:00', { hours: 1 }), '2024-02-29 00:30:00');
  assert.equal(shift('2024-03-01 00:30:00', { hours: -1 }), '2024-02-29 23:30:00');
  assert.equal(shift('2024-01-01 00:00:00', { minutes: -1 }), '2023-12-31 23:59:00');
  assert.equal(shift('2024-01-01 00:00:00', { seconds: -1 }), '2023-12-31 23:59:59');
  assert.equal(shift('2024-01-01 12:00:00', { hours: -25 }), '2023-12-31 11:00:00');
  assert.equal(shift('2024-01-01 12:00:00', { minutes: 61, seconds: 3601 }), '2024-01-01 14:01:01');
  assert.equal(shift('2024-01-01 00:00:00', { days: 1, hours: -1 }), '2024-01-01 23:00:00');
  assert.equal(shift('0001-01-01 00:00:00', { seconds: 1 }), '0001-01-01 00:00:01');
});

test('manipulateDate: invalid dates are rejected, never rolled over or clamped', () => {
  const parse = date({ sourceDateFormat: 'yyyy-MM-dd', targetDateFormat: 'yyyy-MM-dd' });
  for (const invalid of [
    '2023-02-30',
    '2023-02-29',
    '2100-02-29',
    '2024-02-30',
    '2024-04-31',
    '2024-13-01',
    '2024-00-10',
    '2024-01-00',
    '2024-01-32',
    '0000-01-01',
  ]) {
    assert.throws(() => parse(invalid), /Invalid date/, invalid);
  }
  assert.equal(parse('2024-02-29'), '2024-02-29');
  assert.equal(parse('2000-02-29'), '2000-02-29');
  const time = date({ sourceDateFormat: 'HH:mm:ss', targetDateFormat: 'HH:mm:ss' });
  for (const invalid of ['24:00:00', '12:60:00', '12:00:60'])
    assert.throws(() => time(invalid), /Invalid date/, invalid);
  for (const mismatch of ['2024-1-01', '2024-01-01 ', ' 2024-01-01', '2024-01-01T00', '24-01-01', 'garbage', '']) {
    assert.throws(() => parse(mismatch), /does not match sourceDateFormat/, JSON.stringify(mismatch));
  }
  assert.throws(() => parse(null), /requires a string or number input/);
  assert.throws(() => parse({ a: 1 }), /requires a string or number input/);
  assert.throws(
    () => date({ sourceDateFormat: 'yyyy-MM-dd', years: 8000, targetDateFormat: 'yyyy-MM-dd' })('2024-01-01'),
    /does not fit/,
  );
  assert.throws(
    () => date({ sourceDateFormat: 'yyyy-MM-dd', days: -1, targetDateFormat: 'yyyy-MM-dd' })('0001-01-01'),
    /does not fit/,
  );
  assert.throws(
    () => date({ sourceDateFormat: 'yyyy-MM-dd', days: 1, targetDateFormat: 'yyyy-MM-dd' })('9999-12-31'),
    /does not fit/,
  );
  for (const amount of [1.5, 'abc', '', ' 1', '1.5', '1e2', '0x10', null, true, [1], {}, 2 ** 60]) {
    assert.throws(
      () => date({ sourceDateFormat: 'yyyy-MM-dd', days: amount, targetDateFormat: 'yyyy-MM-dd' })('2024-01-01'),
      /days must be an integer/,
      JSON.stringify(amount),
    );
  }
});

test('manipulateDate: token subset (2-digit years, 12-hour clock, English names, fractions, quotes)', () => {
  const convert = (sourceDateFormat, targetDateFormat, value, extra) =>
    date({ sourceDateFormat, targetDateFormat, ...extra })(value);
  // 2-digit years are java.time reduced values based on 2000.
  assert.equal(convert('dd/MM/yy', 'yyyy-MM-dd', '05/03/24'), '2024-03-05');
  assert.equal(convert('yyyy-MM-dd', 'dd/MM/yy', '1999-03-05'), '05/03/99');
  // 12-hour clock needs AM/PM.
  assert.equal(convert('hh:mm a', 'HH:mm', '07:05 PM'), '19:05');
  assert.equal(convert('hh:mm a', 'HH:mm', '12:30 AM'), '00:30');
  assert.equal(convert('hh:mm a', 'HH:mm', '12:30 PM'), '12:30');
  assert.equal(convert('h:mm a', 'HH:mm', '1:05 AM'), '01:05');
  assert.equal(convert('HH:mm', 'h:mm a', '00:05'), '12:05 AM');
  assert.equal(convert('HH:mm', 'hh:mm a', '13:05'), '01:05 PM');
  assert.equal(convert('HH:mm', 'hh:mm a', '12:00'), '12:00 PM');
  assert.throws(() => convert('hh:mm', 'HH:mm', '07:05'), /hh\/h without a \(AM\/PM\)/);
  assert.throws(() => convert('hh:mm a', 'HH:mm', '00:05 AM'), /clock hour 0 is not 1-12/);
  assert.throws(() => convert('hh:mm a', 'HH:mm', '13:05 PM'), /clock hour 13/);
  assert.throws(() => convert('HH:mm a', 'HH:mm', '13:05 AM'), /conflicts with AM/);
  assert.throws(() => convert('mm a', 'mm', '05 AM'), /a \(AM\/PM\) without an hour token/);
  assert.throws(
    () => convert('yyyy-MM-dd hh a', 'HH', '2024-01-01 07 pm'),
    /does not match/,
    'AM/PM is case-sensitive',
  );
  // English month and weekday names (day of week is output-only).
  assert.equal(convert('yyyy-MM-dd', 'EEEE, d MMMM yyyy', '2024-03-05'), 'Tuesday, 5 March 2024');
  assert.equal(convert('yyyy-MM-dd', 'EEE d MMM', '2024-03-03'), 'Sun 3 Mar');
  assert.equal(convert('yyyy-MM-dd', 'EEE', '1970-01-01'), 'Thu');
  assert.equal(convert('yyyy-MM-dd', 'EEE', '1969-12-31'), 'Wed');
  assert.equal(convert('d MMMM yyyy', 'yyyy-MM-dd', '29 February 2024'), '2024-02-29');
  assert.throws(() => convert('d MMM yyyy', 'yyyy-MM-dd', '5 mar 2024'), /does not match/, 'names are case-sensitive');
  assert.throws(() => convert('d MMM yyyy', 'yyyy-MM-dd', '5 Sept 2024'), /does not match/);
  assert.throws(() => convert('EEEE', 'yyyy', 'Monday'), /Unsupported Java date token "EEEE" in sourceDateFormat/);
  // Single-letter numeric fields parse one or two digits and print unpadded.
  assert.equal(convert('d/M/yyyy', 'dd.MM.yyyy', '5/3/2024'), '05.03.2024');
  assert.equal(convert('d/M/yyyy', 'd/M/yyyy', '15/12/2024'), '15/12/2024');
  assert.equal(convert('yyyy-MM-dd', 'd/M/yyyy', '2024-03-05'), '5/3/2024');
  assert.equal(convert('H:m:s', 'HH:mm:ss', '7:5:9'), '07:05:09');
  // Fractions are truncated (java.time prints the leading digits), not rounded.
  assert.equal(convert('HH:mm:ss.SSS', 'ss.S', '10:00:01.987'), '01.9');
  assert.equal(convert('HH:mm:ss.SSS', 'ss.SS', '10:00:01.987'), '01.98');
  assert.equal(convert('HH:mm:ss.S', 'ss.SSS', '10:00:01.5'), '01.500');
  assert.equal(convert('HH:mm:ss.SS', 'ss.SSS', '10:00:01.25'), '01.250');
  // Quoted literals: 'T', '' (a quote) and quotes containing letters.
  assert.equal(convert("yyyy-MM-dd'T'HH:mm", "dd 'of' MMMM, ''yy", '2024-03-05T07:08'), "05 of March, '24");
  assert.throws(() => convert("yyyy-MM-dd'T", 'yyyy', '2024-03-05T'), /Unclosed quoted date literal/);
  // Java's rule (verified against DateTimeFormatter): `''` is one quote, but `''''` is a quoted section holding one
  // escaped quote, so also one quote; `''''''` is two. An odd run leaves a section unclosed.
  assert.equal(convert('yyyy', "yyyy''", '2024'), "2024'");
  assert.equal(convert('yyyy', "yyyy''''", '2024'), "2024'");
  assert.equal(convert('yyyy', "yyyy''''''", '2024'), "2024''");
  assert.equal(convert('yyyy', "''''yy", '2024'), "'24");
  assert.equal(convert('yyyy', "'it''s' yyyy", '2024'), "it's 2024");
  assert.throws(() => convert('yyyy', "yyyy'''", '2024'), /Unclosed quoted date literal/);
  // Unknown letters, unsupported widths and reserved characters are errors in both patterns.
  for (const pattern of [
    'yyyy-MM-dd T',
    'G',
    'yyy',
    'yyyyy',
    'MMMMM',
    'Q',
    'D',
    'k',
    'K',
    'n',
    'V',
    'z',
    'ZZZZ',
    'SSSS',
    'SSSSSS',
    'dd[HH]',
    'dd{',
    '#',
  ]) {
    assert.throws(
      () => convert('yyyy-MM-dd', pattern, '2024-03-05'),
      /Unsupported Java date (token|pattern character)/,
      `target ${pattern}`,
    );
    assert.throws(
      () => convert(pattern, 'yyyy-MM-dd', '2024-03-05'),
      /Unsupported Java date (token|pattern character)/,
      `source ${pattern}`,
    );
  }
  assert.throws(() => convert('yyyy yyyy', 'yyyy', '2024 2024'), /reads the year twice/);
  assert.throws(() => convert('', 'yyyy', '2024'), /must be a non-empty string/);
  assert.throws(() => convert('yyyy', 5, '2024'), /must be a non-empty string/);
});

test('manipulateDate: offsets are carried, never silently invented or converted', () => {
  const convert = (sourceDateFormat, targetDateFormat, value, extra) =>
    date({ sourceDateFormat, targetDateFormat, ...extra })(value);
  const iso = "yyyy-MM-dd'T'HH:mm:ss";
  // The wall clock is not shifted by the offset; arithmetic is on the wall clock.
  assert.equal(
    convert(`${iso}XXX`, `${iso}XXX`, '2024-01-15T10:00:00+02:00', { days: 1 }),
    '2024-01-16T10:00:00+02:00',
  );
  assert.equal(convert(`${iso}XXX`, `${iso}XXX`, '2024-01-15T10:00:00-05:30'), '2024-01-15T10:00:00-05:30');
  assert.equal(convert(`${iso}XXX`, `${iso}XXX`, '2024-01-15T10:00:00Z'), '2024-01-15T10:00:00Z');
  assert.equal(convert(`${iso}XXX`, 'yyyy-MM-dd HH:mm', '2024-01-15T23:30:00+14:00'), '2024-01-15 23:30');
  // Every offset token family, as input and output.
  const samples = [
    ['X', '+02'],
    ['XX', '+0200'],
    ['XXX', '+02:00'],
    ['x', '+02'],
    ['xx', '+0200'],
    ['xxx', '+02:00'],
    ['Z', '+0200'],
    ['XXX', '-05:30'],
    ['XX', '-0530'],
  ];
  for (const [token, offset] of samples) {
    const text = `2024-01-15T10:00:00${offset}`;
    assert.equal(convert(`${iso}${token}`, `${iso}${token}`, text), text, token);
  }
  assert.equal(convert(`${iso}X`, `${iso}X`, '2024-01-15T10:00:00+0530'), '2024-01-15T10:00:00+0530');
  assert.equal(convert(`${iso}XXX`, `${iso}x`, '2024-01-15T10:00:00Z'), '2024-01-15T10:00:00+00');
  assert.equal(convert(`${iso}XXX`, `${iso}Z`, '2024-01-15T10:00:00Z'), '2024-01-15T10:00:00+0000');
  assert.equal(convert(`${iso}XXX`, `${iso}XXX`, '2024-01-15T10:00:00-00:00'), '2024-01-15T10:00:00Z');
  // Pattern Z requires a numeric offset, like java.time's "+0000"; a literal Z does not match it.
  assert.throws(() => convert(`${iso}Z`, iso, '2024-01-15T10:00:00Z'), /does not match/);
  assert.throws(() => convert(`${iso}XXX`, iso, '2024-01-15T10:00:00+19:00'), /Offset out of range/);
  assert.throws(() => convert(`${iso}XXX`, iso, '2024-01-15T10:00:00+02:60'), /Offset out of range/);
  // No offset in the input: no time zone is assumed for an offset in the output.
  assert.throws(
    () => convert(iso, `${iso}XXX`, '2024-01-15T10:00:00'),
    /needs a UTC offset \(no time zone is assumed\)/,
  );
  assert.throws(() => convert(iso, `${iso}Z`, '2024-01-15T10:00:00'), /no time zone is assumed/);
  assert.equal(convert(iso, `${iso}'Z'`, '2024-01-15T10:00:00'), '2024-01-15T10:00:00Z', 'a quoted Z is just text');
});

test('manipulateDate: fields the source pattern does not provide are unknown, not defaulted', () => {
  const convert = (sourceDateFormat, targetDateFormat, value, extra) =>
    date({ sourceDateFormat, targetDateFormat, ...extra })(value);
  // Previously these silently used 1970-01-01 and 00:00:00.000.
  assert.throws(
    () => convert('HH:mm', 'yyyy-MM-dd HH:mm', '10:30'),
    /needs the year.*sourceDateFormat does not provide/,
  );
  assert.throws(() => convert('yyyy-MM-dd', 'yyyy-MM-dd HH:mm', '2024-01-01'), /needs the hour/);
  assert.throws(() => convert('yyyy-MM', 'yyyy-MM-dd', '2024-05'), /needs the day/);
});

test('manipulateDate: Date(milliseconds) is read and written as a pure UTC date', () => {
  const epoch = (config) => date({ sourceDateFormat: 'Date(milliseconds)', ...config });
  const iso = "yyyy-MM-dd'T'HH:mm:ss.SSS";
  assert.equal(epoch({ targetDateFormat: `${iso}'Z'` })('Date(1262908800000)'), '2010-01-08T00:00:00.000Z');
  assert.equal(epoch({ targetDateFormat: iso })('/Date(1262908800123)/'), '2010-01-08T00:00:00.123');
  assert.equal(epoch({ targetDateFormat: iso })(1262908800123), '2010-01-08T00:00:00.123');
  assert.equal(epoch({ targetDateFormat: iso })('Date(-1)'), '1969-12-31T23:59:59.999');
  assert.equal(epoch({ targetDateFormat: 'yyyy-MM-dd', days: 1 })('Date(1262908800000)'), '2010-01-09');
  // Documented: converted milliseconds are displayed as a UTC offset.
  assert.equal(epoch({ targetDateFormat: 'HH:mm XXX' })('Date(0)'), '00:00 Z');
  assert.equal(epoch({ targetDateFormat: 'HH:mm Z' })('Date(0)'), '00:00 +0000');
  // Writing Date(milliseconds) from a pattern date: the wall clock is read as UTC.
  const toEpoch = (config) => date({ targetDateFormat: 'Date(milliseconds)', ...config });
  assert.equal(toEpoch({})('2010-01-08 00:00:00.000'), 'Date(1262908800000)');
  assert.equal(toEpoch({ sourceDateFormat: 'yyyy-MM-dd HH:mm', hours: 1 })('1970-01-01 00:00'), 'Date(3600000)');
  assert.equal(toEpoch({ sourceDateFormat: 'yyyy-MM-dd HH:mm' })('1969-12-31 23:59'), 'Date(-60000)');
  assert.equal(epoch({ targetDateFormat: 'Date(milliseconds)', seconds: 1 })('Date(5)'), 'Date(1005)');
  assert.throws(() => toEpoch({ sourceDateFormat: 'yyyy-MM-dd' })('2010-01-08'), /needs a full date and time/);
  // The SAP prose shows Date(<ms><offset>); its offset semantics are unverified, so it is an error.
  for (const bad of [
    'Date(1519809649123-0240)',
    'Date()',
    'Date(1.5)',
    'Date(abc)',
    'Date(1234567890123456)',
    1.5,
    NaN,
  ]) {
    assert.throws(() => epoch({ targetDateFormat: iso })(bad), /not Date\(<epoch milliseconds>\)/, String(bad));
  }
  assert.throws(() => epoch({ targetDateFormat: iso })(8.64e15 + 1), /not Date|out of range/);
  assert.throws(() => epoch({ targetDateFormat: 'yyyy' })('Date(300000000000000)'), /does not fit/);
});

// ---------------------------------------------------------------------------------------------
// Remaining functions
// ---------------------------------------------------------------------------------------------

test('replaceString is a literal replacement with Java String.replace edge cases', () => {
  const replace = (value, target, replacement) => call(value, { function: 'replaceString', target, replacement });
  assert.equal(replace('red red', 'red', 'blue'), 'blue blue');
  assert.equal(replace('a.b.c', '.', '-'), 'a-b-c', 'regex metacharacters are literal');
  assert.equal(replace('a+b', '+', '$&'), 'a$&b', 'no replacement syntax');
  assert.equal(replace('a14b', 14, 99), 'a99b', 'SAP documents string or number');
  assert.equal(replace('abc', '', '-'), '-a-b-c-', 'empty target matches everywhere, like String.replace');
  assert.equal(replace('', '', '-'), '-');
  assert.equal(replace('abc', 'x', 'y'), 'abc');
  assert.equal(replace('aaa', 'aa', 'b'), 'ba', 'non-overlapping, left to right');
});

test('substring follows String.substring bounds', () => {
  const sub = (value, config) => call(value, { function: 'substring', ...config });
  assert.equal(sub('username', { beginIndex: 0, endIndex: 4 }), 'user');
  assert.equal(sub('username', { beginIndex: 4 }), 'name');
  assert.equal(sub('username', { beginIndex: 8 }), '', 'beginIndex == length is the empty string');
  assert.equal(sub('username', { beginIndex: 3, endIndex: 3 }), '');
  assert.equal(sub('username', { beginIndex: 0, endIndex: null }), 'username');
  for (const bad of [
    { beginIndex: 9 },
    { beginIndex: -1 },
    { beginIndex: 0, endIndex: 9 },
    { beginIndex: 4, endIndex: 3 },
    { beginIndex: 0, endIndex: -1 },
  ]) {
    assert.throws(() => sub('username', bad), /indices out of range/, JSON.stringify(bad));
  }
  for (const bad of [
    { beginIndex: '1' },
    { beginIndex: 1.5 },
    { beginIndex: 0, endIndex: '3' },
    { beginIndex: null },
  ]) {
    assert.throws(() => sub('username', bad), /must be an integer/, JSON.stringify(bad));
  }
  assert.equal(sub(12345, { beginIndex: 1, endIndex: 3 }), '23');
});

test('elementAt fails for negative, out-of-range and non-integer indexes', () => {
  const at = (value, index) => call(value, { function: 'elementAt', index });
  assert.equal(at([4, 5], 0), 4);
  assert.equal(at([4, 5], 1), 5);
  assert.deepEqual(at([[1], [2]], 1), [2]);
  assert.equal(at(['only'], 0), 'only');
  for (const index of [-1, 2, 100])
    assert.throws(() => at([4, 5], index), /out of range for 2 element\(s\)/, String(index));
  assert.throws(() => direct([], { function: 'elementAt', index: 0 }), /out of range for 0 element\(s\)/);
  for (const index of ['0', 'length', 'constructor', 0.5, null, true]) {
    assert.throws(() => at([4, 5], index), /index must be an integer/, String(index));
  }
  assert.throws(() => at('text', 0), /requires an array/);
});

test('splitStringToArray splits on the literal separator (literal-vs-regex is unverified)', () => {
  const split = (value, separator) => call(value, { function: 'splitStringToArray', separator });
  assert.deepEqual(split('Serbia,Germany,Spain', ','), ['Serbia', 'Germany', 'Spain']);
  assert.deepEqual(split('a|b|c', '|'), ['a', 'b', 'c']);
  assert.deepEqual(split('a.b', '.'), ['a', 'b']);
  assert.deepEqual(
    split('a,b,,', ','),
    ['a', 'b', '', ''],
    'trailing empty strings are kept (Java split would drop them)',
  );
  assert.deepEqual(split('abc', ','), ['abc']);
  assert.deepEqual(split('a1b1c', 1), ['a', 'b', 'c']);
});

test('compositeId appends the sub id after a colon and validates what it joins', () => {
  const composite = (value, config, data) =>
    call(value, { function: 'compositeId', separator: ':', ...config }, { data });
  assert.equal(composite('johnsmith', { subId: 'e0123456' }), 'johnsmith:e0123456');
  assert.equal(composite('johnsmith', { subId: 42 }), 'johnsmith:42');
  assert.equal(composite('a', { subId: '$.id' }, { value: 'a', id: 'x1' }), 'a:x1');
  assert.throws(
    () => composite('a', { subId: '$.nope' }, { value: 'a' }),
    /subId requires a string, number or boolean/,
  );
  assert.throws(
    () => composite('a', { subId: '$.obj' }, { value: 'a', obj: { x: 1 } }),
    /subId requires a string, number or boolean/,
  );
  assert.throws(
    () => composite('a', { subId: '$.list' }, { value: 'a', list: [1, 2] }),
    /subId requires a string, number or boolean/,
  );
  assert.throws(() => composite('a', { subId: null }), /subId requires a string, number or boolean/);
  assert.throws(() => composite('a', { separator: '-', subId: 'x' }), /only colon separator/);
  assert.throws(() => composite(null, { subId: 'x' }), /requires a string, number or boolean input/);
});

test('putIfAbsent / putIfPresent / copyMapEntry / renameMapEntry edge cases', () => {
  const put = (value, config) => call(value, config);
  // putIfAbsent: missing and null get the default; empty string, 0 and false are values.
  assert.deepEqual(
    put([{ a: 1 }, {}, { a: null }, { a: '' }, { a: 0 }, { a: false }], {
      function: 'putIfAbsent',
      key: 'a',
      defaultValue: 9,
    }),
    [{ a: 1 }, { a: 9 }, { a: 9 }, { a: '' }, { a: 0 }, { a: false }],
  );
  assert.deepEqual(put({ b: 1 }, { function: 'putIfAbsent', key: 'a', defaultValue: [1] }), { b: 1, a: [1] });
  assert.deepEqual(put([{ a: 1 }, {}], { function: 'putIfPresent', key: 'a', defaultValue: 2 }), [{ a: 2 }, {}]);
  assert.throws(
    () => put('text', { function: 'putIfAbsent', key: 'a', defaultValue: 1 }),
    /requires an object or array of objects/,
  );
  assert.throws(
    () => put(null, { function: 'putIfPresent', key: 'a', defaultValue: 1 }),
    /requires an object or array of objects/,
  );

  const copy = (value, name, sourceKey, targetKey) => put(value, { function: name, sourceKey, targetKey });
  assert.deepEqual(copy([{ r: 'A' }, { r: 'B' }], 'copyMapEntry', 'r', 'value'), [
    { r: 'A', value: 'A' },
    { r: 'B', value: 'B' },
  ]);
  assert.deepEqual(copy([{ r: 'A' }], 'renameMapEntry', 'r', 'value'), [{ value: 'A' }]);
  assert.deepEqual(
    copy({ x: 1 }, 'copyMapEntry', 'missing', 'y'),
    { x: 1 },
    'a missing source key leaves the object unchanged',
  );
  assert.deepEqual(copy({ x: 1 }, 'renameMapEntry', 'missing', 'y'), { x: 1 });
  // Renaming a key to itself used to delete it.
  assert.deepEqual(copy({ a: 1 }, 'renameMapEntry', 'a', 'a'), { a: 1 });
  assert.deepEqual(copy({ a: 1 }, 'copyMapEntry', 'a', 'a'), { a: 1 });
  assert.deepEqual(copy({ a: 1, b: 2 }, 'renameMapEntry', 'a', 'b'), { b: 1 }, 'an existing target key is overwritten');
  assert.deepEqual(copy({ a: { n: 1 } }, 'copyMapEntry', 'a', 'b'), { a: { n: 1 }, b: { n: 1 } });
  assert.throws(() => copy('text', 'copyMapEntry', 'a', 'b'), /requires an object/);
  assert.throws(() => copy({ a: 1 }, 'copyMapEntry', 'a', '__proto__'), /unsafe/);
});

test('randomPassword enforces the documented constraints and character sets', () => {
  const counts = (lower, upper, digits, special) => ({
    minimumNumberOfLowercaseLetters: lower,
    minimumNumberOfUppercaseLetters: upper,
    minimumNumberOfDigits: digits,
    minimumNumberOfSpecialSymbols: special,
  });
  const password = (passwordLength, minimums, extra) =>
    call('', { function: 'randomPassword', passwordLength, ...minimums, ...extra });
  const count = (text, characters) => [...text].filter((char) => characters.includes(char)).length;
  const DEFAULT_SYMBOLS = '~!@#$%^&*()_+';

  for (let run = 0; run < 40; run++) {
    // Zero minimum excludes the set, also for the remaining positions.
    const onlyLowerAndSpecial = password(20, counts(4, 0, 0, 3), { specialSymbols: '!?' });
    assert.equal(onlyLowerAndSpecial.length, 20);
    assert.match(onlyLowerAndSpecial, /^[a-z!?]+$/);
    assert.ok(count(onlyLowerAndSpecial, '!?') >= 3);
    assert.ok(count(onlyLowerAndSpecial, 'abcdefghijklmnopqrstuvwxyz') >= 4);

    const mixed = password(12, counts(2, 2, 2, 2));
    assert.equal(mixed.length, 12);
    assert.ok(count(mixed, 'abcdefghijklmnopqrstuvwxyz') >= 2 && count(mixed, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') >= 2);
    assert.ok(count(mixed, '0123456789') >= 2 && count(mixed, DEFAULT_SYMBOLS) >= 2);
    assert.match(mixed, /^[a-zA-Z0-9~!@#$%^&*()_+]+$/);
  }
  // Exactly the sum: nothing left to fill. Only special symbols is fine too.
  assert.match(password(5, counts(0, 0, 0, 5)), /^[~!@#$%^&*()_+]{5}$/);
  assert.match(
    password(4, counts(1, 1, 1, 1), { specialSymbols: '#' }),
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*#)[a-zA-Z\d#]{4}$/,
  );
  // The documented example from the SAP table.
  assert.equal(password(16, counts(4, 4, 4, 4), { specialSymbols: ',.<>/?~`!@#' }).length, 16);
  // Symbols outside the BMP are whole characters, never lone surrogates.
  for (let run = 0; run < 20; run++) {
    const emoji = password(6, counts(1, 0, 0, 4), { specialSymbols: '😀🎉' });
    assert.ok(emoji.isWellFormed());
    assert.equal([...emoji].length, 6);
    assert.ok(count(emoji, ['😀', '🎉']) >= 4);
  }

  // Custom special symbols require a nonzero special minimum (SAP); this used to be accepted.
  assert.throws(
    () => password(8, counts(4, 2, 2, 0), { specialSymbols: '!?' }),
    /requires minimumNumberOfSpecialSymbols above 0/,
  );
  assert.throws(
    () => password(8, counts(4, 2, 2, 0), { specialSymbols: '' }),
    /specialSymbols must be a non-empty string/,
  );
  assert.throws(
    () => password(8, counts(4, 2, 2, 1), { specialSymbols: '' }),
    /specialSymbols must be a non-empty string/,
  );
  assert.throws(
    () => password(8, counts(4, 2, 2, 1), { specialSymbols: 5 }),
    /specialSymbols must be a non-empty string/,
  );
  assert.throws(
    () => password(8, counts(4, 2, 2, 1), { specialSymbols: ['!'] }),
    /specialSymbols must be a non-empty string/,
  );
  // Length and minimum validation.
  assert.throws(() => password(5, counts(2, 2, 2, 0)), /Invalid randomPassword length or minimum character counts/);
  assert.throws(() => password(0, counts(0, 0, 0, 0)), /Invalid randomPassword/);
  assert.throws(() => password(4097, counts(1, 1, 1, 1)), /Invalid randomPassword/);
  assert.equal(password(4096, counts(1, 1, 1, 1)).length, 4096);
  assert.throws(() => password(8.5, counts(1, 1, 1, 1)), /Invalid randomPassword/);
  assert.throws(() => password('8', counts(1, 1, 1, 1)), /Invalid randomPassword/);
  assert.throws(() => password(8, counts(-1, 1, 1, 1)), /Invalid randomPassword/);
  assert.throws(() => password(8, counts(1.5, 1, 1, 1)), /Invalid randomPassword/);
  assert.throws(() => password(8, counts('1', 1, 1, 1)), /Invalid randomPassword/);
  // Nothing defines the filler characters when every minimum is zero.
  assert.throws(() => password(4, counts(0, 0, 0, 0)), /needs at least one nonzero minimum/);
  assert.match(password(4, counts(0, 0, 4, 0)), /^\d{4}$/);
});

test('toUpperCaseString / toLowerCaseString use the Java locale id and reject invalid ones cleanly', () => {
  const upper = (value, locale) => call(value, { function: 'toUpperCaseString', locale });
  const lower = (value, locale) => call(value, { function: 'toLowerCaseString', locale });
  assert.equal(upper('straße'), 'STRASSE');
  assert.equal(upper('straße', 'de_DE'), 'STRASSE');
  assert.equal(upper('abc', 'en_EN'), 'ABC');
  assert.equal(lower('ABC', 'en_EN'), 'abc');
  assert.equal(upper('i', 'en_US'), 'I');
  assert.equal(upper('i', 'tr_TR'), 'İ');
  assert.equal(lower('I', 'tr_TR'), 'ı');
  assert.equal(lower('I', 'tr-TR'), 'ı', 'BCP 47 spelling works too');
  assert.equal(upper('ǆ'), 'Ǆ');
  for (const bad of ['', 'de_', '_DE', 'not a locale', 'de__DE', '12', 'toolonglanguage_XX', '!']) {
    assert.throws(
      () => upper('abc', bad),
      (error) => {
        assert.match(error.message, /locale .* is not a valid locale id/, JSON.stringify(bad));
        assert.doesNotMatch(error.message, /Incorrect locale information/);
        return true;
      },
    );
    assert.throws(() => lower('ABC', bad), /is not a valid locale id/, JSON.stringify(bad));
  }
  for (const bad of [5, true, ['de'], {}])
    assert.throws(() => upper('abc', bad), /locale must be a string/, JSON.stringify(bad));
  assert.equal(upper('abc', null), 'ABC', 'null locale means the default');
});

test('convertCountryCode treats codes before names and rejects out-of-range numeric codes', () => {
  assert.equal(countryCode('UK', 'alpha2'), 'GB', 'UK is a dataset alias for the United Kingdom, not a code');
  assert.equal(countryCode('gb', 'alpha3'), 'GBR');
  for (const bad of [0, 1000, -4, 4.5])
    assert.throws(() => countryCode(bad, 'alpha2'), /Unknown country|requires a country/, String(bad));
});

test('the trace step records fallbackUsed for the documented timezone and locale fallbacks', () => {
  const traceStep = (value, config, context) => {
    const result = runPipeline({
      data: { value },
      mode: 'source',
      debug: true,
      context,
      source: { user: { mappings: [{ sourcePath: '$.value', targetPath: '$.value', functions: [config] }] } },
    });
    return result.entities[0].trace[0].functions[0];
  };
  const timezone = { function: 'convertTimezoneCode', outputFormat: 'iana' };
  assert.equal(traceStep('AST', timezone).after, 'America/Halifax');
  assert.equal(traceStep('AST', timezone).fallbackUsed, undefined);
  assert.equal(traceStep('nope', timezone).after, 'Europe/Berlin');
  assert.equal(traceStep('nope', timezone).fallbackUsed, true);

  const locale = { function: 'convertLocaleCode', outputFormat: 'bcp47' };
  const context = { localeMappings: [['EN', 'en-US']] };
  assert.equal(traceStep('EN', locale, context).fallbackUsed, undefined);
  assert.equal(traceStep('EO', locale, context).fallbackUsed, true);
  assert.equal(traceStep('EO', locale, context).after, 'en-US');
});
