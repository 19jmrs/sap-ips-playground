import { located, tokenize } from './condition-tokenizer.js';
import { interpolate } from './environment.js';
import { failWith } from './errors.js';
import { scanFilterBody, skipQuoted } from './util.js';

const filterOpening = /\[\s*\?\s*\(/y;

// [start, end) ranges of the `(...)` bodies of `[?(...)]` filters outside quoted names. An unclosed filter fails
// with the filter's range attached (`offset`, `length`, kind 'filter') for validation.
export function filterBodies(path) {
  const bodies = [];
  let i = 0;
  while (i < path.length) {
    const char = path[i];
    if (char === '"' || char === "'") {
      i = skipQuoted(path, i);
    } else if (char === '[') {
      filterOpening.lastIndex = i;
      const opening = filterOpening.exec(path);
      if (!opening) {
        i++;
        continue;
      }
      const start = i + opening[0].length - 1;
      const close = scanFilterBody(path, start);
      if (close < 0) {
        try {
          failWith('PATH_ERROR', 'Unclosed JSONPath filter');
        } catch (error) {
          throw located(error, i, path.length - i, 'filter');
        }
      }
      bodies.push([start, close + 1]);
      i = close + 1;
    } else {
      i++;
    }
  }
  return bodies;
}

// Resolves ${variable} / %property% references in a JSONPath string (sourcePath, targetPath,
// sourcePaths entry, expression). Filter bodies are left untouched: the condition parser
// resolves them per token when the filter runs, so a value is never pasted into the condition as
// raw text. Each body is tokenized once here, so missing context is reported even when the filter
// has no candidate to run on.
export function resolvePathText(path, env) {
  if (typeof path !== 'string') return interpolate(path, env);
  const bodies = filterBodies(path);
  if (!bodies.length) return interpolate(path, env);

  let resolved = '';
  let from = 0;
  for (const [start, end] of bodies) {
    resolved += String(interpolate(path.slice(from, start), env));
    tokenize(path.slice(start + 1, end - 1), env);
    resolved += path.slice(start, end);
    from = end;
  }
  return resolved + String(interpolate(path.slice(from), env));
}

const placeholderPattern = /\$\{[^}]+\}|%[^%\s]+%/g;
const leadingPlaceholderPattern = /^(?:\$\{[^}]+\}|%[^%\s]+%)/;

// Length of a `${variable}` / `%property%` that opens the text, else 0. Such a path takes its root (and maybe
// more) from the placeholder, so validation checks only what follows it.
export function leadingPlaceholderLength(text) {
  return leadingPlaceholderPattern.exec(text)?.[0].length ?? 0;
}

// Validation helper: replaces every `${variable}` / `%property%` outside the given filter bodies with filler of
// the same length, so offsets stay valid. The filler is digits where an index or slice bound is expected (after
// `[`, `:` or `,`) and letters elsewhere (a property name). What the placeholder really holds is not known.
export function maskPlaceholders(text, bodies = []) {
  return text.replace(placeholderPattern, (match, offset) => {
    if (bodies.some(([start, end]) => offset >= start && offset < end)) return match;
    const filler = /[[:,]\s*$/.test(text.slice(0, offset)) ? '0' : 'x';
    return filler.repeat(match.length);
  });
}
