// Syntax checks for IPS condition strings, source/target JSONPath strings, regular expressions and date patterns.
// They mirror what src/engine/index.js rejects, so an "error" here is something the evaluator fails on when it runs
// the string. Ranges are character offsets in the checked string. No SAP validity is implied.
import { conditionFunctions, get, wordOperators } from './vocab.js';

const SYMBOL_COMPARATORS = ['==', '===', '!=', '!==', '=~', '<', '>', '<=', '>='];
const WORD_COMPARATORS = Object.keys(wordOperators);
const PATH_METHOD = /\.(length|size|first|last|min|max|sum|avg)\(\)$/;
const UNSAFE = /__proto__|constructor|prototype/g;
const PLACEHOLDER = /\$\{[^}]+\}|%[^%\s]+%/g;

const issue = (from, to, severity, code, message) => ({ from, to: Math.max(to, from + 1), severity, code, message });

// ${variable} and %property% are substituted before evaluation; keep offsets stable by masking with digits.
export function maskPlaceholders(text) {
  return text.replace(PLACEHOLDER, (match) => '0'.repeat(match.length));
}

export const startsWithPlaceholder = (text) => /^(?:\$\{[^}]+\}|%[^%\s]+%)/.test(text);

// ---- regular expressions and dates ---------------------------------------------------------------------------

export function checkRegexSource(pattern) {
  let source = String(pattern);
  let flags = '';
  if (source.startsWith('(?i)')) {
    source = source.slice(4);
    flags = 'i';
  }
  if (source.includes('(?!')) return 'Negative lookahead (?!...) is rejected; rewrite the expression without it.';
  if (/\(\?[a-z-]+\)|\\[pPkK]|\(\?<[^=!]/.test(source))
    return 'Java-only regex construct (inline flags, \\p, \\k or named groups) is not supported; use a plain pattern.';
  try {
    new RegExp(source, flags);
  } catch (error) {
    return `Invalid regular expression: ${error.message}`;
  }
  return null;
}

const DATE_TOKENS = ['yyyy', 'SSS', 'XXX', 'MM', 'dd', 'HH', 'mm', 'ss', 'Z', 'X'];

export function checkDateFormat(format) {
  if (format === 'Date(milliseconds)') return null;
  let i = 0;
  while (i < format.length) {
    if (format[i] === "'") {
      i++;
      let closed = false;
      while (i < format.length) {
        if (format[i] === "'" && format[i + 1] === "'") i += 2;
        else if (format[i] === "'") {
          i++;
          closed = true;
          break;
        } else i++;
      }
      if (!closed) return "Unclosed quoted literal in the date pattern; close it with '.";
      continue;
    }
    const token = DATE_TOKENS.find((t) => format.startsWith(t, i));
    if (token) i += token.length;
    else if (/[A-Za-z]/.test(format[i]))
      return `Unsupported date token near "${format.slice(i, i + 6)}"; supported: ${DATE_TOKENS.join(', ')} (quote other letters).`;
    else i++;
  }
  return null;
}

// ---- conditions ---------------------------------------------------------------------------------------------

function tokenize(s) {
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    if (/\s/.test(s[i])) {
      i++;
      continue;
    }
    const c = s[i];
    const start = i;
    if (c === '"' || c === "'") {
      i++;
      let closed = false;
      while (i < s.length) {
        if (s[i] === c) {
          i++;
          closed = true;
          break;
        }
        i += s[i] === '\\' ? 2 : 1;
      }
      if (!closed)
        return {
          tokens,
          error: issue(start, s.length, 'error', 'condition-syntax', `Unclosed string: add the closing ${c}.`),
        };
      tokens.push({ kind: 'value', from: start, to: i });
      continue;
    }
    if (c === '/') {
      i++;
      let v = '';
      let closed = false;
      while (i < s.length) {
        if (s[i] === '/') {
          i++;
          closed = true;
          break;
        }
        if (s[i] === '\\') v += s[i++];
        v += s[i++] ?? '';
      }
      if (!closed)
        return {
          tokens,
          error: issue(start, s.length, 'error', 'condition-syntax', 'Unclosed regex literal: add the closing /.'),
        };
      let flags = '';
      while (i < s.length && /[imsu]/.test(s[i])) flags += s[i++];
      const problem = v.includes('(?!')
        ? 'Negative lookahead (?!...) is rejected; rewrite the expression without it.'
        : regexLiteralProblem(v, flags);
      if (problem) return { tokens, error: issue(start, i, 'error', 'condition-regex', problem) };
      tokens.push({ kind: 'regex', from: start, to: i });
      continue;
    }
    if (c === '$' || c === '@') {
      let bracket = 0;
      let quote = null;
      i++;
      while (i < s.length) {
        const x = s[i];
        if (quote) {
          if (x === '\\') i++;
          else if (x === quote) quote = null;
          i++;
          continue;
        }
        if (x === '"' || x === "'") {
          quote = x;
          i++;
          continue;
        }
        if (x === '[') {
          bracket++;
          i++;
          continue;
        }
        if (x === ']') {
          bracket--;
          i++;
          continue;
        }
        if (bracket) {
          i++;
          continue;
        }
        if (x === '(' && /\.(length|size|first|last|min|max|sum|avg)$/.test(s.slice(start, i)) && s[i + 1] === ')') {
          i += 2;
          continue;
        }
        if (/[\s()!,<>=&|]/.test(x)) break;
        i++;
      }
      tokens.push({ kind: 'path', from: start, to: Math.min(i, s.length) });
      continue;
    }
    const op = s.slice(i).match(/^(===|!==|==|!=|=~|<=|>=|&&|\|\||[!<>()[\],])/);
    if (op) {
      tokens.push({ kind: 'op', value: op[0], from: i, to: i + op[0].length });
      i += op[0].length;
      continue;
    }
    const number = s.slice(i).match(/^-?\d+(?:\.\d+)?/);
    if (number) {
      tokens.push({ kind: 'value', from: i, to: i + number[0].length });
      i += number[0].length;
      continue;
    }
    const word = s.slice(i).match(/^[A-Za-z_][\w.-]*/);
    if (word) {
      const w = word[0];
      tokens.push({
        kind: /^(true|false|null)$/.test(w) ? 'value' : 'word',
        value: w,
        from: i,
        to: i + w.length,
      });
      i += w.length;
      continue;
    }
    const hints = { '=': 'Use == to compare values.', '&': 'Use && for logical and.', '|': 'Use || for logical or.' };
    return {
      tokens,
      error: issue(
        i,
        i + 1,
        'error',
        'condition-syntax',
        `Unsupported character "${s[i]}". ${hints[s[i]] ?? 'Remove it or quote it as a string.'}`,
      ),
    };
  }
  return { tokens, error: null };
}

function regexLiteralProblem(source, flags) {
  try {
    new RegExp(source, flags);
    return null;
  } catch (error) {
    return `Invalid regular expression: ${error.message}`;
  }
}

class ParseStop extends Error {
  constructor(found) {
    super(found.message);
    this.found = found;
  }
}

// Returns the issues (offset relative to `text`) for an IPS condition string. At most one error: the evaluator stops at the first.
export function checkCondition(text) {
  const source = maskPlaceholders(text);
  const { tokens, error } = tokenize(source);
  const issues = [];
  if (error) return [error];
  const calls = [];
  let at = 0;
  let depth = 0;
  const peekOp = (value) => tokens[at]?.kind === 'op' && tokens[at].value === value;
  const stop = (from, to, message) => {
    throw new ParseStop(issue(from, to, 'error', 'condition-syntax', message));
  };
  const endRange = () => (tokens.length ? [tokens.at(-1).from, source.length] : [0, Math.max(source.length, 1)]);
  const sliceOf = (token) => source.slice(token.from, token.to);

  const primary = () => {
    if (peekOp('!')) {
      at++;
      return primary();
    }
    if (peekOp('(')) {
      const open = tokens[at++];
      or();
      if (!peekOp(')')) stop(open.from, open.to, 'Missing ")" to close this "(".');
      at++;
      return;
    }
    if (peekOp('[')) {
      const open = tokens[at++];
      while (!peekOp(']')) {
        or();
        if (!peekOp(',')) break;
        at++;
      }
      if (!peekOp(']')) stop(open.from, open.to, 'Missing "]" to close this list.');
      at++;
      return;
    }
    const token = tokens[at++];
    if (!token) {
      const [from, to] = endRange();
      stop(from, to, 'Incomplete condition: a value or path is expected here.');
    }
    if (token.kind === 'path') {
      const pathText = '$' + sliceOf(token).slice(1);
      for (const found of checkJsonPath(pathText, { inCondition: true })) {
        issues.push({ ...found, from: found.from + token.from, to: found.to + token.from });
      }
      return;
    }
    if (token.kind === 'value' || token.kind === 'regex') return;
    if (token.kind === 'word') {
      if (peekOp('(')) {
        const open = tokens[at++];
        depth++;
        let args = 0;
        while (!peekOp(')')) {
          or();
          args++;
          if (!peekOp(',')) break;
          at++;
        }
        if (!peekOp(')')) stop(open.from, open.to, `Missing ")" to close the call to ${token.value}.`);
        at++;
        depth--;
        calls.push({ token, args });
        return;
      }
      if (depth) return;
      stop(
        token.from,
        token.to,
        `"${token.value}" is not a value here. Quote text as "${token.value}"; only true, false, null, numbers, [lists], paths and functions are allowed.`,
      );
    }
    stop(token.from, token.to, `Unexpected "${token.value}": a value, path or function is expected here.`);
  };
  const compare = () => {
    primary();
    const token = tokens[at];
    const word = token && (token.kind === 'word' || token.kind === 'op') ? token.value.toLowerCase() : null;
    if (word && (SYMBOL_COMPARATORS.includes(word) || WORD_COMPARATORS.includes(word))) {
      at++;
      const right = tokens[at];
      if (word === '=~' && right && right.kind !== 'regex')
        stop(right.from, right.to, '"=~" needs a /pattern/ literal on the right side.');
      primary();
    }
  };
  const and = () => {
    compare();
    while (peekOp('&&')) {
      at++;
      compare();
    }
  };
  const or = () => {
    and();
    while (peekOp('||')) {
      at++;
      and();
    }
  };

  try {
    or();
    if (at !== tokens.length) {
      const token = tokens[at];
      const value = token.kind === 'op' || token.kind === 'word' ? token.value : sliceOf(token);
      stop(
        token.from,
        token.to,
        value === ')'
          ? 'Unexpected ")" without a matching "(".'
          : `Unexpected "${value}": expected an operator (==, !=, contains, in, ...) or && / ||.`,
      );
    }
  } catch (error) {
    if (error instanceof ParseStop) return [...issues, error.found];
    throw error;
  }

  for (const { token, args } of calls) {
    const definition = get(conditionFunctions, token.value);
    if (!definition) {
      issues.push(
        issue(
          token.from,
          token.to,
          'warning',
          'condition-function',
          `Unknown conditional function "${token.value}"; the evaluator fails when it is reached. Supported: ${Object.keys(conditionFunctions).join(', ')}.`,
        ),
      );
    } else if (args !== definition.args) {
      issues.push(
        issue(
          token.from,
          token.to,
          'warning',
          'condition-arity',
          `${token.value} takes ${definition.args} argument${definition.args === 1 ? '' : 's'}: ${definition.signature}.`,
        ),
      );
    }
  }
  return issues;
}

// ---- JSONPath (read side) -----------------------------------------------------------------------------------

// Mirrors the evaluator's filter detection so condition text inside [?( ... )] can be checked in place.
function findFilters(path) {
  const filters = [];
  let quote = null;
  for (let i = 0; i < path.length; i++) {
    const c = path[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (path.slice(i, i + 3) !== '[?(') continue;
    let depth = 1;
    let q = null;
    let regex = false;
    let closedAt = -1;
    for (let j = i + 3; j < path.length; j++) {
      const x = path[j];
      if (q) {
        if (x === '\\') j++;
        else if (x === q) q = null;
        continue;
      }
      if (regex) {
        if (x === '\\') j++;
        else if (x === '/') regex = false;
        continue;
      }
      if (x === '"' || x === "'") {
        q = x;
        continue;
      }
      if (
        x === '/' &&
        path
          .slice(i + 3, j)
          .trimEnd()
          .endsWith('=~')
      ) {
        regex = true;
        continue;
      }
      if (x === '(') depth++;
      if (x === ')' && --depth === 0) {
        closedAt = j;
        break;
      }
    }
    if (closedAt < 0)
      return {
        filters,
        error: issue(i, path.length, 'error', 'jsonpath-filter', 'Unclosed filter: add ")]" to finish [?( ... ).'),
      };
    if (path[closedAt + 1] !== ']')
      return {
        filters,
        error: issue(i, closedAt + 2, 'error', 'jsonpath-filter', 'Malformed filter: ")" must be followed by "]".'),
      };
    filters.push({ start: i, end: closedAt + 2, from: i + 3, to: closedAt });
    i = closedAt + 1;
  }
  return { filters, error: null };
}

// `path` is the text after placeholder masking. Used for sourcePath, sourcePaths, subId and condition paths.
export function checkJsonPath(path, { startRequired = true, inCondition = false } = {}) {
  const issues = [];
  if (startRequired && !path.startsWith('$')) {
    issues.push(
      issue(
        0,
        Math.min(Math.max(path.length, 1), 8),
        'error',
        'jsonpath-start',
        'A JSONPath must start with $ (for example $.name). The evaluator rejects anything else.',
      ),
    );
    return issues;
  }
  for (const match of path.matchAll(UNSAFE))
    issues.push(
      issue(
        match.index,
        match.index + match[0].length,
        'error',
        'jsonpath-unsafe',
        `"${match[0]}" is blocked by the evaluator; use another property name.`,
      ),
    );
  const { filters, error } = findFilters(path);
  if (error) {
    issues.push(error);
    return issues;
  }
  for (const filter of filters) {
    for (const found of checkCondition(path.slice(filter.from, filter.to)))
      issues.push({ ...found, from: found.from + filter.from, to: found.to + filter.from });
  }
  // Outside filters: quote/bracket balance (uncertain how the JSONPath backend treats it) and unsupported path functions.
  let quote = null;
  const open = [];
  const outside = [];
  let cursor = 0;
  for (const filter of filters) {
    outside.push([cursor, filter.start]);
    cursor = filter.end;
  }
  outside.push([cursor, path.length]);
  for (const [from, to] of outside) {
    for (let i = from; i < to; i++) {
      const c = path[i];
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") quote = c;
      else if (c === '[') open.push(i);
      else if (c === ']') {
        if (!open.pop()) issues.push(issue(i, i + 1, 'warning', 'jsonpath-bracket', 'Unmatched "]" in the path.'));
      }
    }
  }
  if (quote)
    issues.push(
      issue(path.lastIndexOf(quote), path.length, 'warning', 'jsonpath-quote', `Unclosed ${quote} quote in the path.`),
    );
  for (const index of open)
    issues.push(issue(index, index + 1, 'warning', 'jsonpath-bracket', 'Unclosed "[" in the path.'));
  const body = path.replace(PATH_METHOD, '');
  const plain = outside.map(([from, to]) => body.slice(from, Math.min(to, body.length))).join('|');
  const call = plain.match(/\.[A-Za-z_]\w*\(/);
  if (call && !inCondition) {
    const at = path.indexOf(call[0]);
    issues.push(
      issue(
        at,
        at + call[0].length,
        'error',
        'jsonpath-function',
        'Unsupported JSONPath function; only a trailing .length(), .size(), .first(), .last(), .min(), .max(), .sum() or .avg() is supported.',
      ),
    );
  }
  return issues;
}

// ---- JSONPath (write side) ----------------------------------------------------------------------------------

const TARGET_TOKEN = /^(?:\.([A-Za-z_$][\w$-]*)|\[(\d+)\]|\[['"]([^'"]+)['"]\])/;

// Mirrors how the evaluator writes a target path. `kind`: 'set' | 'remove' | 'rename'. Returns issues relative to `path`.
export function checkTargetPath(path, kind = 'set') {
  if (!path.startsWith('$'))
    return [
      issue(
        0,
        Math.min(Math.max(path.length, 1), 8),
        'error',
        'target-start',
        'A target path must start with $ (for example $.name).',
      ),
    ];
  const issues = [];
  for (const match of path.matchAll(UNSAFE))
    issues.push(
      issue(
        match.index,
        match.index + match[0].length,
        'error',
        'target-unsafe',
        `"${match[0]}" is blocked by the evaluator; use another property name.`,
      ),
    );
  if (issues.length) return issues;
  const problem = targetProblem(path, kind);
  return problem ? [problem] : [];
}

function targetProblem(path, kind, offset = 0) {
  const at = (from, to, message) => issue(offset + from, offset + to, 'error', 'target-path', message);
  if (kind === 'remove' && path.includes('[*]')) return null;
  if (kind === 'set') {
    const wildcard = path.match(/^(.*)\[\*\](.*)$/);
    if (wildcard) {
      const [, base, tail] = wildcard;
      return targetTokens(base, offset, 'base of [*]') ?? targetProblem('$' + tail, kind, offset + base.length + 2);
    }
  }
  const projection = path.match(/^(.*)\[\?\(@\.([\w$-]+)\)\](.*)$/);
  if (projection && kind !== 'rename') {
    if (kind === 'remove')
      return at(
        projection[1].length,
        path.length - projection[3].length,
        'Removing through a [?(@.attribute)] projection is not supported; remove a definite path or use [*].',
      );
    const [, base, attribute, tail] = projection;
    return (
      targetTokens(base, offset, 'base of the projection') ??
      targetTokens('$.' + attribute + tail, offset + base.length + 5, 'projection tail')
    );
  }
  const message = kind === 'rename' ? 'rename needs a definite path' : null;
  return targetTokens(path, offset, message);
}

// Walks `.name`, `[0]`, `['name']` segments; reports the first segment the evaluator cannot write.
function targetTokens(path, offset, context) {
  let i = 1;
  while (i < path.length) {
    const part = path.slice(i).match(TARGET_TOKEN);
    if (!part) {
      const rest = path.slice(i);
      const from = offset + i;
      const wildcardNote = rest.includes('[*]') ? ' Only one [*] is allowed per target path.' : '';
      const filterNote = rest.includes('[?(') ? ' Filters are limited to a single [?(@.attribute)] projection.' : '';
      const reason = context ? ` (${context})` : '';
      return issue(
        from,
        from + rest.length,
        'error',
        'target-path',
        `Unsupported target path segment "${rest}"${reason}. Use definite segments (.name, [0], ['name']), one [*] wildcard or one [?(@.attribute)] projection.${wildcardNote}${filterNote}`,
      );
    }
    i += part[0].length;
  }
  return null;
}
