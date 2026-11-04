import { fail } from '../util.js';
import { translateJavaRegex } from './java-regex.js';
import { inputText, integerParameter, textParameter } from './values.js';

// Compiles a Java regex (see java-regex.js for the allow/reject table). Never throws a raw
// SyntaxError: every failure names the function and the pattern.
export function compileJavaRegex(pattern, where) {
  let translated;
  try {
    translated = translateJavaRegex(pattern);
  } catch (error) {
    fail(`${where}: unsupported or invalid Java regex ${JSON.stringify(pattern)}: ${error.message}`);
  }
  const { source, flags, groupCount, groupNames, guards } = translated;

  function checkText(text) {
    for (const guard of guards) {
      if (guard.test.test(text))
        fail(`${where}: regex ${JSON.stringify(pattern)} cannot be applied safely: ${guard.reason}`);
    }
  }

  return {
    groupCount,
    groupNames,
    // First match (java.util.regex.Matcher.find()) or null.
    find(text) {
      checkText(text);
      return new RegExp(source, flags).exec(text);
    },
    // All successive non-overlapping matches, as repeated Matcher.find() calls produce them.
    findAll(text) {
      checkText(text);
      return [...text.matchAll(new RegExp(source, flags + 'g'))];
    },
  };
}

// DECISION POINT (unverified): does matchRegex / getMatchedRegexGroup test the whole value
// (java String.matches / Matcher.matches) or search inside it (Matcher.find)?
// The SAP text only says "checks whether a given string matches the provided regular
// expression" (Provisioning_Service.pdf p.508 and p.514) and neither example settles it:
// getMatchedRegexGroup's pattern spans the whole DN, and matchRegex uses ".*_COMP" -- the
// leading ".*" would be redundant under find() but is required under matches(), a hint toward
// whole-match that is not evidence. We keep the existing substring (find) behaviour until a
// live IPS reference case decides; changing this one function changes both functions.
function findMatch(regex, text) {
  return regex.find(text);
}

// Java Matcher.appendReplacement syntax: $n / ${name} insert a group, \x inserts x literally,
// any other `$` is an error. JavaScript's $& $` $' $$ $<name> are NOT special here.
// Like Java, the template is only interpreted when a match exists.
export function parseReplacement(template, regex, where) {
  const parts = [];
  let literal = '';
  const reject = (reason) => fail(`${where}: invalid replacement ${JSON.stringify(template)}: ${reason}`);
  const flush = () => {
    if (literal) parts.push(literal);
    literal = '';
  };

  let i = 0;
  while (i < template.length) {
    const char = template[i++];
    if (char === '\\') {
      if (i === template.length) reject('character to be escaped is missing');
      literal += template[i++];
    } else if (char !== '$') {
      literal += char;
    } else {
      if (i === template.length) reject('illegal group reference: group index is missing');
      flush();
      if (template[i] === '{') {
        const end = template.indexOf('}', i);
        const name = template.slice(i + 1, end < 0 ? undefined : end);
        if (end < 0 || !/^[a-zA-Z0-9]*$/.test(name)) reject("named capturing group is missing trailing '}'");
        if (name === '') reject('named capturing group has 0 length name');
        if (/^[0-9]/.test(name)) reject(`capturing group name ${name} starts with digit character`);
        if (!regex.groupNames.includes(name)) reject(`no group with name ${name}`);
        parts.push({ name });
        i = end + 1;
      } else {
        if (!/[0-9]/.test(template[i])) reject('illegal group reference');
        let group = Number(template[i++]);
        // Further digits belong to the reference only while they still name an existing group.
        while (/[0-9]/.test(template[i] ?? '') && group * 10 + Number(template[i]) <= regex.groupCount) {
          group = group * 10 + Number(template[i++]);
        }
        if (group > regex.groupCount) reject(`no group ${group}`);
        parts.push({ group });
      }
    }
  }
  flush();
  return parts;
}

function expand(parts, match) {
  return parts
    .map((part) => {
      if (typeof part === 'string') return part;
      return (part.name === undefined ? match[part.group] : match.groups[part.name]) ?? '';
    })
    .join('');
}

function replaceMatches(value, ctx, selectMatches) {
  const text = inputText(value, ctx);
  const regex = compileJavaRegex(textParameter(ctx.required('regex'), 'regex', ctx), ctx.name);
  const template = textParameter(ctx.required('replacement'), 'replacement', ctx);
  const matches = selectMatches(regex, text);
  if (!matches.length) return text;

  const parts = parseReplacement(template, regex, ctx.name);
  let result = '';
  let cursor = 0;
  for (const match of matches) {
    result += text.slice(cursor, match.index) + expand(parts, match);
    cursor = match.index + match[0].length;
  }
  return result + text.slice(cursor);
}

export const regexFunctions = {
  replaceFirstString: {
    run(value, config, ctx) {
      return replaceMatches(value, ctx, (regex, text) => {
        const match = regex.find(text);
        return match ? [match] : [];
      });
    },
  },

  replaceAllString: {
    run(value, config, ctx) {
      return replaceMatches(value, ctx, (regex, text) => regex.findAll(text));
    },
  },

  // "Last" is the last of the successive non-overlapping matches (Matcher.find() order); the
  // match is replaced in its original position, so lookarounds, anchors and groups see the
  // full text. Overlapping candidates are not considered: "aaa" with `aa` replaces index 0.
  replaceLastString: {
    run(value, config, ctx) {
      return replaceMatches(value, ctx, (regex, text) => regex.findAll(text).slice(-1));
    },
  },

  getMatchedRegexGroup: {
    run(value, config, ctx) {
      const text = inputText(value, ctx);
      const regex = compileJavaRegex(textParameter(ctx.required('regex'), 'regex', ctx), ctx.name);
      const group = integerParameter(ctx.required('groupIndex'), 'groupIndex', ctx);
      if (group < 0 || group > regex.groupCount)
        fail(`${ctx.name}: no group ${group} (the regex has ${regex.groupCount})`);
      // No match, or a group that did not take part in the match, yields no value (Java: null).
      return findMatch(regex, text)?.[group];
    },
  },

  matchRegex: {
    run(value, config, ctx) {
      const text = inputText(value, ctx);
      const regex = compileJavaRegex(textParameter(ctx.required('regex'), 'regex', ctx), ctx.name);
      return findMatch(regex, text) !== null;
    },
  },
};
