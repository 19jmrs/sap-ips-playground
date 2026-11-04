import { NEGATIVE_LOOKAHEAD_MESSAGE, fail } from '../util.js';

// Java (java.util.regex.Pattern) -> JavaScript regular expression translation.
//
// The translator is an allow-list: every Java construct is either rewritten to an exact
// JavaScript equivalent or rejected with a reason. Nothing is passed through unexamined, so
// JavaScript can never silently reinterpret a Java pattern. The output always uses the `u`
// flag (Java matches by code point) and never the JS `s`/`m` flags: dot, `^` and `$` are
// expanded to Java's line-terminator rules instead.
//
// Allowed (exact):
//   literals, `.`, alternation, (...) capture groups, (?:...), (?=...) lookahead,
//   (?<name>...) named groups with \k<name>, greedy and lazy quantifiers * + ? {n} {n,} {n,m},
//   \1..\9 back references, character classes with ranges/negation, \d \D \w \W,
//   \s \S \h \H \v \V (Java definitions), \t \n \r \f \a \e \xhh \x{h..h} \uhhhh,
//   \Q..\E quoting, \A \z \Z \b \B (see text guards), ^ and $ (Java line rules),
//   \p{..}/\P{..}: general categories, ASCII POSIX classes, Is<Script>,
//   leading inline flags (?i) (?s) (?m) (?x) (?u) and their `-` forms.
// Rejected: negative lookahead (IPS validation), lookbehind, atomic groups, possessive
//   quantifiers, inline flags anywhere but the pattern start or with a scope group,
//   (?d) (?U), class intersection/union/nesting, a leading `]` in a class, \G \R \X \N \c \0,
//   Java properties (\p{javaXxx}, \p{InBlock}), \S \H \V \P{Posix} inside a class.
//
// Text guards: where Java and JavaScript only agree on ASCII input the pattern still
// compiles, but matching text outside that range is rejected instead of guessed:
//   - \b \B: Java's word-boundary definition for non-ASCII text changed between JDK versions.
//   - (?i): Java folds ASCII only (unless (?u)); JavaScript's `iu` additionally folds U+017F
//     and U+212A onto s and k, and non-ASCII pattern characters would fold differently.

const LINE_TERMINATORS = '\\n\\r\\u0085\\u2028\\u2029';
const JAVA_SPACE = ' \\t\\n\\x0B\\f\\r';
const HORIZONTAL_SPACE = ' \\t\\xA0\\u1680\\u180E\\u2000-\\u200A\\u202F\\u205F\\u3000';
const VERTICAL_SPACE = '\\n\\x0B\\f\\r\\x85\\u2028\\u2029';

// `$` without (?m) also matches before a final line terminator, but never between \r and \n.
const END_BEFORE_FINAL_TERMINATOR = '(?=(?:\\r\\n|(?<!\\r)\\n|[\\r\\u0085\\u2028\\u2029])?$)';
// With (?m) Java's `^` matches after any line terminator except at the very end of input.
const LINE_START = '(?:(?!$)(?:^|(?<=[\\n\\u0085\\u2028\\u2029])|(?<=\\r)(?!\\n)))';
const LINE_END = '(?:(?=[\\r\\u0085\\u2028\\u2029]|(?<!\\r)\\n|$))';

const POSIX_CLASSES = {
  Lower: 'a-z',
  Upper: 'A-Z',
  ASCII: '\\x00-\\x7F',
  Alpha: 'a-zA-Z',
  Digit: '0-9',
  Alnum: 'a-zA-Z0-9',
  Punct: '\\x21-\\x2F\\x3A-\\x40\\x5B-\\x60\\x7B-\\x7E',
  Graph: '\\x21-\\x7E',
  Print: '\\x20-\\x7E',
  Blank: ' \\t',
  Cntrl: '\\x00-\\x1F\\x7F',
  XDigit: '0-9a-fA-F',
  Space: ' \\t\\n\\x0B\\f\\r',
};

const GENERAL_CATEGORIES = new Set(
  'L Lu Ll Lt Lm Lo LC M Mn Mc Me N Nd Nl No P Pc Pd Ps Pe Pi Pf Po S Sm Sc Sk So Z Zs Zl Zp C Cc Cf Cs Co Cn'.split(
    ' ',
  ),
);

const SYNTAX_CHARACTERS = new Set('^$\\.*+?()[]{}|/');
const COMMENT_MODE_SPACE = ' \t\n\x0B\f\r';
const FLAG_GROUP = /^\(\?([a-zA-Z]*)(?:-([a-zA-Z]*))?\)/;
const GROUP_NAME = /^[a-zA-Z][a-zA-Z0-9]*$/;
const NON_ASCII = /[^\x00-\x7f]/;

function escapeCodePoint(code, inClass) {
  const char = String.fromCodePoint(code);
  if (SYNTAX_CHARACTERS.has(char) || (inClass && char === '-')) return '\\' + char;
  const unprintable =
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x2028 ||
    code === 0x2029 ||
    (code >= 0xd800 && code <= 0xdfff);
  return unprintable ? `\\u{${code.toString(16)}}` : char;
}

function isHighSurrogate(code) {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code) {
  return code >= 0xdc00 && code <= 0xdfff;
}

// Attaches the failing range of the pattern to an error, keeping any range already set (used by validateJavaRegex).
function locate(error, offset, length) {
  error.offset ??= offset;
  error.length ??= Math.max(1, length);
  return error;
}

class Translator {
  constructor(pattern) {
    this.pattern = pattern;
    this.pos = 0;
    this.out = '';
    this.flags = { i: false, s: false, m: false, x: false, u: false };
    this.groupCount = 0;
    this.groupNames = [];
    this.depth = 0;
    this.guards = [];
  }

  translate() {
    this.readLeadingFlags();
    while (this.pos < this.pattern.length) {
      this.skipCommentMode();
      const start = this.pos;
      try {
        this.readToken();
      } catch (error) {
        throw locate(error, start, this.pos - start);
      }
    }
    if (this.depth > 0) fail('unclosed group');
    if (this.flags.i && !this.flags.u && NON_ASCII.test(this.pattern)) {
      fail(
        'case-insensitive matching of non-ASCII pattern characters differs from Java; add (?u) or remove the characters',
      );
    }
    if (this.flags.i) {
      this.addGuard(/[\u017f\u212a]/, 'Java (?i) folds ASCII only, but the text contains U+017F or U+212A');
    }
    const flags = this.flags.i ? 'iu' : 'u';
    try {
      new RegExp(this.out, flags);
    } catch (error) {
      fail(`JavaScript rejected the translated pattern (${error.message})`);
    }
    return {
      source: this.out,
      flags,
      groupCount: this.groupCount,
      groupNames: this.groupNames,
      guards: this.guards,
    };
  }

  addGuard(test, reason) {
    if (!this.guards.some((guard) => guard.reason === reason)) this.guards.push({ test, reason });
  }

  peek(offset = 0) {
    return this.pattern[this.pos + offset];
  }

  emit(source) {
    this.out += source;
  }

  readLeadingFlags() {
    for (;;) {
      const match = FLAG_GROUP.exec(this.pattern.slice(this.pos));
      if (!match || (match[1] === '' && !match[2])) return;
      try {
        this.applyFlags(match[1], true);
        this.applyFlags(match[2] ?? '', false);
      } catch (error) {
        throw locate(error, this.pos, match[0].length);
      }
      this.pos += match[0].length;
    }
  }

  applyFlags(letters, enabled) {
    for (const letter of letters) {
      if (letter === 'd') fail('(?d) UNIX_LINES is not supported');
      if (letter === 'U') fail('(?U) UNICODE_CHARACTER_CLASS is not supported');
      if (!'ismxu'.includes(letter)) fail(`unknown inline flag (?${letter})`);
      this.flags[letter] = enabled;
    }
  }

  // In (?x) mode Java skips whitespace and `#` comments, also inside character classes.
  skipCommentMode() {
    if (!this.flags.x) return;
    for (;;) {
      const char = this.peek();
      if (char !== undefined && COMMENT_MODE_SPACE.includes(char)) {
        this.pos++;
      } else if (char === '#') {
        while (this.pos < this.pattern.length && !'\n\r\u0085\u2028\u2029'.includes(this.peek())) this.pos++;
      } else {
        return;
      }
    }
  }

  readToken() {
    this.skipCommentMode();
    if (this.pos >= this.pattern.length) return;
    const char = this.peek();
    switch (char) {
      case '\\':
        return this.readEscapeToken();
      case '[':
        return this.readClass();
      case '(':
        return this.readGroupOpen();
      case ')':
        if (this.depth === 0) fail("unmatched ')'");
        this.depth--;
        this.pos++;
        return this.emit(')');
      case '|':
        this.pos++;
        return this.emit('|');
      case '.':
        this.pos++;
        return this.emit(this.flags.s ? '[^]' : `[^${LINE_TERMINATORS}]`);
      case '^':
        this.pos++;
        return this.emit(this.flags.m ? LINE_START : '^');
      case '$':
        this.pos++;
        return this.emit(this.flags.m ? LINE_END : END_BEFORE_FINAL_TERMINATOR);
      case '*':
      case '+':
      case '?':
        this.pos++;
        this.emit(char);
        return this.readQuantifierSuffix();
      case '{':
        return this.readRepetition();
      default:
        return this.readLiteral();
    }
  }

  readLiteral() {
    const code = this.pattern.codePointAt(this.pos);
    this.pos += code > 0xffff ? 2 : 1;
    this.emit(escapeCodePoint(code, false));
  }

  readRepetition() {
    const match = /^\{(\d+)(?:,(\d*))?\}/.exec(this.pattern.slice(this.pos));
    if (!match) fail("illegal repetition: '{' must start a quantifier such as {2}, {2,} or {2,5}");
    this.pos += match[0].length;
    this.emit(match[0]);
    this.readQuantifierSuffix();
  }

  readQuantifierSuffix() {
    if (this.peek() === '+') fail('possessive quantifiers are not supported');
    if (this.peek() === '?') {
      this.pos++;
      this.emit('?');
    }
  }

  readGroupOpen() {
    const rest = this.pattern.slice(this.pos, this.pos + 4);
    if (!rest.startsWith('(?')) {
      this.groupCount++;
      return this.openGroup('(', 1);
    }
    if (rest.startsWith('(?:') || rest.startsWith('(?=')) return this.openGroup(rest.slice(0, 3), 3);
    if (rest.startsWith('(?!')) fail(NEGATIVE_LOOKAHEAD_MESSAGE);
    if (rest.startsWith('(?<=') || rest.startsWith('(?<!')) fail('lookbehind is not supported');
    if (rest.startsWith('(?>')) fail('atomic groups (?>...) are not supported');
    if (rest.startsWith('(?<')) return this.readNamedGroup();
    if (/^\(\?[a-zA-Z-]*[:)]/.test(this.pattern.slice(this.pos, this.pos + 12))) {
      fail('inline flags are only supported at the start of the pattern and cannot scope a group');
    }
    return fail(`unsupported group construct ${this.pattern.slice(this.pos, this.pos + 3)}`);
  }

  openGroup(source, length) {
    this.depth++;
    this.pos += length;
    this.emit(source);
  }

  readNamedGroup() {
    const match = /^\(\?<([^>]*)>/.exec(this.pattern.slice(this.pos));
    if (!match || !GROUP_NAME.test(match[1])) {
      fail('illegal named group: names are ASCII letters and digits and must start with a letter');
    }
    if (this.groupNames.includes(match[1])) fail(`named group ${match[1]} is defined twice`);
    this.groupCount++;
    this.groupNames.push(match[1]);
    this.openGroup(`(?<${match[1]}>`, match[0].length);
  }

  readEscapeToken() {
    if (this.peek(1) === 'Q') {
      this.pos += 2;
      for (const code of this.readQuotation()) this.emit(escapeCodePoint(code, false));
      return;
    }
    const escape = this.readEscape(false);
    if (escape.code !== undefined) this.emit(escapeCodePoint(escape.code, false));
    else this.emit(escape.outside);
  }

  // Text after \Q up to \E (or the end of the pattern), as code points.
  readQuotation() {
    const end = this.pattern.indexOf('\\E', this.pos);
    const text = this.pattern.slice(this.pos, end < 0 ? undefined : end);
    this.pos = end < 0 ? this.pattern.length : end + 2;
    return [...text].map((char) => char.codePointAt(0));
  }

  // Consumes a backslash escape. Returns { code } for a single character, { outside, inside }
  // for sets and assertions (`inside` is null when the construct cannot appear in a class).
  readEscape(inClass) {
    const next = this.peek(1);
    if (next === undefined) fail('the pattern ends with a backslash');
    const code = this.pattern.codePointAt(this.pos + 1);
    this.pos += code > 0xffff ? 3 : 2;
    if (!/[A-Za-z0-9]/.test(next)) return { code };

    const single = { t: 9, n: 10, r: 13, f: 12, a: 7, e: 27 };
    if (next in single) return { code: single[next] };
    if (/[1-9]/.test(next)) return this.readBackReference(next, inClass);

    switch (next) {
      case 'd':
      case 'D':
      case 'w':
      case 'W':
        return { outside: '\\' + next, inside: '\\' + next };
      case 's':
        return { outside: `[${JAVA_SPACE}]`, inside: JAVA_SPACE };
      case 'S':
        return { outside: `[^${JAVA_SPACE}]`, inside: null };
      case 'h':
        return { outside: `[${HORIZONTAL_SPACE}]`, inside: HORIZONTAL_SPACE };
      case 'H':
        return { outside: `[^${HORIZONTAL_SPACE}]`, inside: null };
      case 'v':
        return { outside: `[${VERTICAL_SPACE}]`, inside: VERTICAL_SPACE };
      case 'V':
        return { outside: `[^${VERTICAL_SPACE}]`, inside: null };
      case 'x':
        return { code: this.readHexEscape() };
      case 'u':
        return { code: this.readUnicodeEscape() };
      case 'k':
        return this.readNamedBackReference(inClass);
      case 'p':
      case 'P':
        return this.readProperty(next === 'P', inClass);
      case 'b':
      case 'B':
        return this.readBoundary(next, inClass);
      case 'A':
        return this.assertion('^', inClass, '\\A');
      case 'z':
        return this.assertion('$', inClass, '\\z');
      case 'Z':
        return this.assertion(END_BEFORE_FINAL_TERMINATOR, inClass, '\\Z');
      default:
        return fail(`unsupported or illegal escape sequence \\${next}`);
    }
  }

  assertion(source, inClass, name) {
    if (inClass) fail(`${name} is not valid inside a character class`);
    return { outside: source, inside: null };
  }

  readBoundary(letter, inClass) {
    if (inClass) fail(`\\${letter} is not valid inside a character class`);
    if (this.peek() === '{') fail(`\\${letter}{...} boundaries are not supported`);
    this.addGuard(/[^\x00-\x7f]/, `Java \\b word boundaries on non-ASCII text depend on the JDK version`);
    return { outside: '\\' + letter, inside: null };
  }

  readBackReference(first, inClass) {
    if (inClass) fail('back references are not valid inside a character class');
    let number = Number(first);
    while (/[0-9]/.test(this.peek() ?? '') && number * 10 + Number(this.peek()) <= this.groupCount) {
      number = number * 10 + Number(this.peek());
      this.pos++;
    }
    if (number > this.groupCount) fail(`back reference \\${number} refers to a group that does not exist`);
    return { outside: `(?:\\${number})`, inside: null };
  }

  readNamedBackReference(inClass) {
    if (inClass) fail('back references are not valid inside a character class');
    const match = /^<([^>]*)>/.exec(this.pattern.slice(this.pos));
    if (!match || !this.groupNames.includes(match[1])) fail('\\k<name> must reference a named group defined earlier');
    this.pos += match[0].length;
    return { outside: `\\k<${match[1]}>`, inside: null };
  }

  readHexEscape() {
    if (this.peek() === '{') {
      const match = /^\{([0-9a-fA-F]+)\}/.exec(this.pattern.slice(this.pos));
      if (!match || parseInt(match[1], 16) > 0x10ffff) fail('illegal \\x{...} code point');
      this.pos += match[0].length;
      return parseInt(match[1], 16);
    }
    const match = /^[0-9a-fA-F]{2}/.exec(this.pattern.slice(this.pos));
    if (!match) fail('illegal hexadecimal escape: \\x needs two hex digits or {...}');
    this.pos += 2;
    return parseInt(match[0], 16);
  }

  readUnicodeEscape() {
    const high = this.readUnicodeUnit();
    if (isHighSurrogate(high) && this.pattern.startsWith('\\u', this.pos)) {
      const saved = this.pos;
      this.pos += 2;
      const low = this.readUnicodeUnit();
      if (isLowSurrogate(low)) return (high - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
      this.pos = saved;
    }
    return high;
  }

  readUnicodeUnit() {
    const match = /^[0-9a-fA-F]{4}/.exec(this.pattern.slice(this.pos));
    if (!match) fail('illegal unicode escape: \\u needs four hex digits');
    this.pos += 4;
    return parseInt(match[0], 16);
  }

  readProperty(negated, inClass) {
    let name;
    if (this.peek() === '{') {
      const end = this.pattern.indexOf('}', this.pos);
      if (end < 0) fail('unclosed \\p{...} property');
      name = this.pattern.slice(this.pos + 1, end);
      this.pos = end + 1;
    } else {
      name = this.peek();
      this.pos++;
    }
    const letter = negated ? 'P' : 'p';
    if (name !== undefined && GENERAL_CATEGORIES.has(name)) {
      const source = `\\${letter}{${name}}`;
      return { outside: source, inside: source };
    }
    if (name !== undefined && Object.hasOwn(POSIX_CLASSES, name)) return this.posixClass(name, negated, inClass);
    const script = /^Is([A-Z][A-Za-z_]*)$/.exec(name ?? '');
    if (script && this.isKnownScript(script[1])) {
      const source = `\\${letter}{Script=${script[1]}}`;
      return { outside: source, inside: source };
    }
    return fail(
      `unsupported property \\${letter}{${name}}: only general categories, ASCII POSIX classes and Is<Script> are translated`,
    );
  }

  posixClass(name, negated, inClass) {
    if (this.flags.i && (name === 'Lower' || name === 'Upper')) {
      fail(`\\p{${name}} with (?i) depends on the JDK version`);
    }
    const body = POSIX_CLASSES[name];
    if (!negated) return { outside: `[${body}]`, inside: body };
    if (inClass) fail(`\\P{${name}} is not supported inside a character class`);
    return { outside: `[^${body}]`, inside: null };
  }

  isKnownScript(name) {
    try {
      new RegExp(`\\p{Script=${name}}`, 'u');
      return true;
    } catch {
      return false;
    }
  }

  readClass() {
    this.pos++;
    let negated = false;
    if (this.peek() === '^') {
      negated = true;
      this.pos++;
    }
    if (this.peek() === ']')
      fail('a leading ] in a character class is ambiguous between Java and JavaScript; escape it');
    let body = '';
    for (;;) {
      this.skipCommentMode();
      if (this.pos >= this.pattern.length) fail('unclosed character class');
      const char = this.peek();
      if (char === ']') {
        this.pos++;
        break;
      }
      if (char === '[') fail('nested character classes and unions are not supported');
      if (char === '&' && this.peek(1) === '&') fail('character class intersection (&&) is not supported');
      body += this.readClassItem();
    }
    if (body === '') fail('empty character class');
    this.emit(`[${negated ? '^' : ''}${body}]`);
  }

  readClassItem() {
    if (this.peek() === '\\' && this.peek(1) === 'Q') {
      this.pos += 2;
      return this.readQuotation()
        .map((code) => escapeCodePoint(code, true))
        .join('');
    }
    const start = this.readClassAtom();
    const hasRange = this.peek() === '-' && this.peek(1) !== ']' && this.peek(1) !== undefined;
    // Java's Pattern.range() returns right after a class escape such as \w, so a following '-' is an
    // ordinary character ([\w-.] is a union); JavaScript's u mode would reject it as a range.
    if (!hasRange || start.code === undefined) return start.source;
    this.pos++;
    const end = this.readClassAtom();
    if (end.code === undefined || end.code < start.code) fail('illegal character range');
    return `${start.source}-${end.source}`;
  }

  readClassAtom() {
    if (this.peek() === '\\') {
      const escape = this.readEscape(true);
      if (escape.code !== undefined) return { code: escape.code, source: escapeCodePoint(escape.code, true) };
      if (escape.inside === null) fail('this escape cannot be used inside a character class');
      return { source: escape.inside };
    }
    const code = this.pattern.codePointAt(this.pos);
    this.pos += code > 0xffff ? 2 : 1;
    return { code, source: escapeCodePoint(code, true) };
  }
}

export function translateJavaRegex(pattern) {
  return new Translator(pattern).translate();
}

// Parse-only check for editors: translates `pattern` and reports whether the evaluator would accept it.
// Returns { ok: true, groupCount, groupNames, guards } (`guards`: reasons why some input text is refused at run
// time, see the header) or { ok: false, error: { domain: 'regex', kind: 'syntax', message, offset?, length? } }.
// The range is the construct being translated when it failed; failures about the pattern as a whole (an
// unclosed group, case folding of non-ASCII characters) carry none.
export function validateJavaRegex(pattern) {
  try {
    const { groupCount, groupNames, guards } = translateJavaRegex(String(pattern));
    return { ok: true, groupCount, groupNames, guards: guards.map((guard) => guard.reason) };
  } catch (error) {
    const { message, offset, length } = error;
    return { ok: false, error: { domain: 'regex', kind: 'syntax', message, offset, length } };
  }
}
