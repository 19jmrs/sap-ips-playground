import { conditionalFunction } from './condition-functions.js';
import { located, tokenize, validationFailure } from './condition-tokenizer.js';
import { resolvePath, validateJsonPath } from './jsonpath.js';
import { equal, fail } from './util.js';

// NOTE: imports jsonpath.js, which imports this module back (see the note there).

// Operators are matched by token kind: keyword operators are 'word' tokens (any letter case),
// symbolic operators are 'op' tokens. A quoted string is a 'value' token and never an operator.
const keywordOperators = ['empty', 'size', 'in', 'nin', 'subsetof', 'anyof', 'noneof', 'contains'];
const symbolOperators = ['==', '===', '!=', '!==', '=~', '<', '>', '<=', '>='];

// Missing versus null, and operator semantics. Checked against Jayway JsonPath 2.9.0 (the library the SAP
// documentation cites) with a differential run over ~4,400 filter expressions; SAP's own version is unverified:
//   - a path that matches nothing yields `undefined`; an explicit JSON null yields `null`;
//   - a missing operand is never equal to anything, not even another missing operand: `==` is false and `!=` true
//     (Jayway's UndefinedNode); `$.x == null` is true only for an explicit null;
//   - `==`, `!=`, `IN`, `CONTAINS` and the set operators treat a number and a numeric string as equal
//     (`'1' == 1`), as Jayway's NumberNode/StringNode conversion does;
//   - `EMPTY` and `SIZE` apply to strings and arrays only; every other left operand (number, boolean, null,
//     missing) makes them false, so `$.x EMPTY true` is false for a missing path. An object left operand makes
//     EMPTY fail, as Jayway raises a ClassCastException;
//   - `NIN` and `IN` are both false when the right operand is not a list;
//   - `=~` matches the whole value, like Java's Matcher.matches(), so `/b/` does not match 'abc';
//   - in a JSONPath filter a bare `@.x` / `$.x` operand is an existence test (see resolvePath in jsonpath.js);
//     outside filters a bare path operand is tested for truthiness.
// Whether SAP evaluates top-level (non-filter) conditions with the same rules is not documented.

// `<`, `>`, `<=`, `>=` follow Jayway's evaluators (EvaluatorFactory.LessThanEvaluator and
// siblings): number-with-number and string-with-string compare, string order being UTF-16 code
// unit order like Java's String.compareTo; any other pairing, including null and missing
// operands, is false instead of a JavaScript coercion. Bounded: SAP's version is unknown.
function order(a, b) {
  const sameType = (typeof a === 'number' && typeof b === 'number') || (typeof a === 'string' && typeof b === 'string');
  if (!sameType) return undefined;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function ordering(a, b, accepts) {
  const result = order(a, b);
  return result !== undefined && accepts(result);
}

// Text a regex is matched against, as in Jayway's RegexpEvaluator.getInput.
function regexInput(value) {
  return ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : '';
}

// Java's Matcher.matches(): the pattern must cover the whole input. The anchored copies are cached per literal.
const wholeMatchers = new WeakMap();

function wholeMatcher(pattern) {
  let matcher = wholeMatchers.get(pattern);
  if (!matcher) {
    matcher = new RegExp(`(?<![\\s\\S])(?:${pattern.source})(?![\\s\\S])`, pattern.flags);
    wholeMatchers.set(pattern, matcher);
  }
  return matcher;
}

function matchesRegex(pattern, value) {
  if (!(pattern instanceof RegExp)) fail('Regex comparison requires /pattern/');
  const matcher = wholeMatcher(pattern);
  if (Array.isArray(value)) return value.some((item) => matcher.test(regexInput(item)));
  return matcher.test(regexInput(value));
}

const decimal = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function equalValues(a, b) {
  if (a === undefined || b === undefined) return false;
  if (typeof a === 'number' && typeof b === 'string') return decimal.test(b) && Number(b) === a;
  if (typeof a === 'string' && typeof b === 'number') return equalValues(b, a);
  return equal(a, b);
}

function includes(list, value) {
  return Array.isArray(list) && list.some((item) => equalValues(item, value));
}

function compareValues(operator, a, b) {
  switch (operator) {
    case 'empty':
      if (typeof b !== 'boolean') fail('EMPTY must be followed by true or false');
      if (typeof a === 'string' || Array.isArray(a)) return (a.length === 0) === b;
      if (a !== null && typeof a === 'object') fail('EMPTY applies to strings and arrays, not objects');
      return false;
    case 'size':
      return (typeof a === 'string' || Array.isArray(a)) && typeof b === 'number' && a.length === b;
    case 'in':
      return includes(b, a);
    case 'nin':
      return Array.isArray(b) && !includes(b, a);
    case 'subsetof':
      return Array.isArray(a) && Array.isArray(b) && a.every((item) => includes(b, item));
    case 'anyof':
      return Array.isArray(a) && Array.isArray(b) && a.some((item) => includes(b, item));
    case 'noneof':
      return Array.isArray(a) && Array.isArray(b) && !a.some((item) => includes(b, item));
    case 'contains':
      if (Array.isArray(a)) return includes(a, b);
      return typeof a === 'string' && typeof b === 'string' && a.includes(b);
    case '==':
      return equalValues(a, b);
    case '!=':
      return !equalValues(a, b);
    case '===':
      return a !== undefined && b !== undefined && equal(a, b);
    case '!==':
      return !(a !== undefined && b !== undefined && equal(a, b));
    case '=~':
      return matchesRegex(b, a);
    case '<':
      return ordering(a, b, (result) => result < 0);
    case '>':
      return ordering(a, b, (result) => result > 0);
    case '<=':
      return ordering(a, b, (result) => result <= 0);
    case '>=':
      return ordering(a, b, (result) => result >= 0);
  }
}

// Recursive-descent parser that evaluates while parsing:
//   or -> and ('||' and)* ; and -> compare ('&&' compare)* ; compare -> primary [operator primary]
//
// Validation mode (`env.validate`, used by validateCondition): the whole condition is parsed as if it sat in a
// short-circuited branch, so no path is resolved, no function runs and no data is read. Syntax failures carry
// the offending token's range (`offset`/`length`) as well as the message.
class ConditionParser {
  constructor(tokens, data, env, source = '') {
    this.tokens = tokens;
    this.data = data;
    this.env = env;
    this.validate = env.validate === true;
    this.source = source;
    this.calls = [];
    this.at = 0;
    this.functionDepth = 0;
    // While true, the right side of a short-circuited &&/|| is parsed but not evaluated,
    // so missing context in a dead branch does not raise errors.
    this.suppressed = this.validate;
    // Token index just after the last path reference that is still a complete operand, or -1.
    // It identifies a bare path used as a predicate (existence test inside filters).
    this.bareReferenceEnd = -1;
    this.bareReferenceFound = false;
  }

  // Throws `message`; in validation mode it points at `token`, or at the end of the text when there is none.
  reject(message, token) {
    const error = new Error(message);
    if (!this.validate) throw error;
    if (token) throw located(error, token.from, token.to - token.from);
    const last = this.tokens.at(-1);
    const from = last ? last.from : 0;
    throw located(error, from, Math.max(this.source.length - from, 1));
  }

  parse() {
    const result = this.or();
    if (this.at !== this.tokens.length) {
      const token = this.tokens[this.at];
      this.reject(`Unsupported condition token: ${token.value}`, token);
    }
    return this.truthy(result);
  }

  peekOp(value) {
    const token = this.tokens[this.at];
    return token?.kind === 'op' && token.value === value;
  }

  // `opener` is the token of the bracket being closed; validation points at it when the closer is missing.
  take(value, opener) {
    if (!this.peekOp(value)) this.reject(`Expected ${value} in condition`, opener ?? this.tokens[this.at]);
    this.at++;
  }

  truthy(value) {
    if (this.env.inPathFilter && this.bareReferenceEnd === this.at) return this.bareReferenceFound;
    return Boolean(value);
  }

  or() {
    const left = this.and();
    if (!this.peekOp('||')) return left;
    let result = this.truthy(left);
    while (this.peekOp('||')) {
      this.at++;
      const right = this.withSuppression(result, () => this.truthy(this.and()));
      result = result || right;
    }
    this.bareReferenceEnd = -1;
    return result;
  }

  and() {
    const left = this.compare();
    if (!this.peekOp('&&')) return left;
    let result = this.truthy(left);
    while (this.peekOp('&&')) {
      this.at++;
      const right = this.withSuppression(!result, () => this.truthy(this.compare()));
      result = result && right;
    }
    this.bareReferenceEnd = -1;
    return result;
  }

  withSuppression(shortCircuited, parseRight) {
    const saved = this.suppressed;
    this.suppressed = saved || shortCircuited;
    const result = parseRight();
    this.suppressed = saved;
    return result;
  }

  comparisonOperator() {
    const token = this.tokens[this.at];
    if (token?.kind === 'word' && keywordOperators.includes(token.value.toLowerCase()))
      return token.value.toLowerCase();
    if (token?.kind === 'op' && symbolOperators.includes(token.value)) return token.value;
    return null;
  }

  compare() {
    const left = this.primary();
    const operator = this.comparisonOperator();
    if (!operator) return left;
    this.at++;
    const rightStart = this.at;
    const right = this.primary();
    if (this.validate) this.checkOperand(operator, rightStart);
    this.bareReferenceEnd = -1;
    // A dead branch only has placeholder operands, so it must not be judged.
    return this.suppressed ? false : compareValues(operator, left, right);
  }

  // Validation only: `=~` and `EMPTY` fail on a right operand that is a literal of the wrong kind, whatever the
  // data. Operands that are paths, placeholders, calls or groups are only known at run time and are not judged.
  checkOperand(operator, start) {
    const token = this.tokens[start];
    if (this.at !== start + 1 || token.placeholder) return;
    if (operator === '=~' && !(token.value instanceof RegExp)) {
      this.reject('Regex comparison requires /pattern/', token);
    }
    if (operator === 'empty' && token.kind === 'value' && typeof token.value !== 'boolean') {
      this.reject('EMPTY must be followed by true or false', token);
    }
  }

  primary() {
    if (this.peekOp('!')) {
      this.at++;
      const negated = !this.truthy(this.primary());
      this.bareReferenceEnd = -1;
      return negated;
    }
    if (this.peekOp('(')) {
      const opener = this.tokens[this.at++];
      const value = this.or();
      const bare = this.bareReferenceEnd === this.at;
      this.take(')', opener);
      if (bare) this.bareReferenceEnd = this.at;
      return value;
    }
    if (this.peekOp('[')) return this.arrayLiteral();

    const token = this.tokens[this.at++];
    if (!token) this.reject('Incomplete condition');
    if (token.kind === 'path') {
      if (this.validate) this.checkReference(token);
      const { value, found } = this.suppressed ? { value: undefined, found: false } : this.resolveReference(token);
      this.bareReferenceEnd = this.at;
      this.bareReferenceFound = found;
      return value;
    }
    if (token.kind === 'value') return token.value;
    if (token.kind === 'word') {
      if (this.peekOp('(')) return this.functionCall(token);
      // Bare words are only valid as arguments, e.g. a context property name.
      if (this.functionDepth) return token.value;
      this.reject(`Unsupported condition identifier: ${token.value}`, token);
    }
    this.reject(`Unexpected condition token: ${token.value}`, token);
  }

  resolveReference(token) {
    // Inside a filter, `$` still means the document root, `@` the candidate element.
    const root = token.reference === '$' && this.env.filterMode ? this.env.rootData : this.data;
    return resolvePath(root, token.value, this.env);
  }

  // Validation only: the reference must be a path the evaluator can parse (see validateJsonPath).
  checkReference(token) {
    const result = validateJsonPath(token.value);
    if (result.ok) return;
    const { message, offset, length, kind, domain } = result.error;
    const error = new Error(message);
    error.domain = domain;
    error.kind = kind;
    if (offset === undefined) throw located(error, token.from, token.to - token.from);
    throw located(error, token.from + offset, length);
  }

  arrayLiteral() {
    const opener = this.tokens[this.at++];
    const items = [];
    while (!this.peekOp(']')) {
      items.push(this.or());
      if (!this.peekOp(',')) break;
      this.at++;
    }
    this.take(']', opener);
    return items;
  }

  functionCall(nameToken) {
    const opener = this.tokens[this.at++];
    this.functionDepth++;
    const args = [];
    while (!this.peekOp(')')) {
      args.push(this.or());
      if (!this.peekOp(',')) break;
      this.at++;
    }
    this.take(')', opener);
    this.functionDepth--;
    if (this.validate) {
      const { from, to } = nameToken;
      this.calls.push({ name: nameToken.value, args: args.length, offset: from, length: to - from });
    }
    return this.suppressed ? undefined : conditionalFunction(nameToken.value, args, this.data, this.env);
  }
}

export function evaluateCondition(expression, data, env) {
  if (typeof expression !== 'string') fail('Condition must be a string');
  return new ConditionParser(tokenize(expression, env), data, env).parse();
}

// Parse-only check of a condition: tokenizes and parses it exactly like evaluateCondition, but reads no data and
// runs nothing, so the result depends on the text alone. A `${variable}` / `%property%` outside a literal is
// one value of unknown type. `inFilter` is true for the body of a `[?(...)]` filter.
// Returns { ok: true, calls } (`calls`: the conditional functions used, as { name, args, offset, length }) or
// { ok: false, error: { domain, kind, message, offset?, length? } }. The first failure only: like the
// evaluator, it stops there. Failures inside a path reference have domain 'jsonpath' (see validateJsonPath).
// Not judged: unknown conditional functions and their argument counts (the evaluator fails only when a call is
// reached; compare `calls`), and anything that depends on the data.
export function validateCondition(text, { inFilter = false } = {}) {
  const env = { validate: true, filterMode: inFilter, inPathFilter: inFilter };
  try {
    if (typeof text !== 'string') fail('Condition must be a string');
    const parser = new ConditionParser(tokenize(text, env), undefined, env, text);
    parser.parse();
    return { ok: true, calls: parser.calls };
  } catch (error) {
    return { ok: false, error: validationFailure(error, 'condition', 'syntax') };
  }
}
