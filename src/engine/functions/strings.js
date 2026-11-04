import { readPath } from '../jsonpath.js';
import { fail } from '../util.js';
import { inputText, integerParameter, textParameter } from './values.js';

// Each function is { run(value, config, ctx) }: `value` is one element, `config` the
// interpolated function object, `ctx` = { name, data, env, required(key), note(key, value) }.

// SAP: "de_DE, ja_JP, ru_RU and so on", default en_EN (English). Java locale ids use
// underscores; Intl needs BCP 47 tags. Tags Intl cannot parse are rejected with a clear error.
function caseLocale(locale, ctx) {
  if (locale === undefined || locale === null) return 'en';
  if (typeof locale !== 'string') fail(`${ctx.name} locale must be a string such as de_DE`);
  try {
    return Intl.getCanonicalLocales(locale.replaceAll('_', '-'))[0];
  } catch {
    return fail(`${ctx.name} locale ${JSON.stringify(locale)} is not a valid locale id (expected e.g. en_EN, de_DE)`);
  }
}

// Java String.replace(target, replacement): an empty target matches before every UTF-16 unit
// and at the end; JavaScript's split('') would drop those outer matches.
function replaceLiteral(text, target, replacement) {
  if (target === '')
    return (
      text
        .split('')
        .map((unit) => replacement + unit)
        .join('') + replacement
    );
  return text.split(target).join(replacement);
}

export const stringFunctions = {
  concatString: {
    run(value, config, ctx) {
      const affix = (key) => (config[key] == null ? '' : inputText(config[key], { name: `${ctx.name} ${key}` }));
      return affix('prefix') + inputText(value, ctx) + affix('suffix');
    },
  },

  replaceString: {
    run(value, config, ctx) {
      const target = textParameter(ctx.required('target'), 'target', ctx);
      const replacement = textParameter(ctx.required('replacement'), 'replacement', ctx);
      return replaceLiteral(inputText(value, ctx), target, replacement);
    },
  },

  toUpperCaseString: {
    run(value, config, ctx) {
      return inputText(value, ctx).toLocaleUpperCase(caseLocale(config.locale, ctx));
    },
  },

  toLowerCaseString: {
    run(value, config, ctx) {
      return inputText(value, ctx).toLocaleLowerCase(caseLocale(config.locale, ctx));
    },
  },

  substring: {
    run(value, config, ctx) {
      const text = inputText(value, ctx);
      const begin = integerParameter(ctx.required('beginIndex'), 'beginIndex', ctx);
      const end = config.endIndex == null ? text.length : integerParameter(config.endIndex, 'endIndex', ctx);
      if (begin < 0 || end < begin || end > text.length) fail('substring indices out of range');
      return text.slice(begin, end);
    },
  },

  // The separator is taken literally. Whether SAP splits on a literal or a regex (Java
  // String.split) is unverified; JavaScript keeps trailing empty strings, Java's split drops them.
  splitStringToArray: {
    run(value, config, ctx) {
      return inputText(value, ctx).split(textParameter(ctx.required('separator'), 'separator', ctx));
    },
  },

  // Out-of-range and negative indexes fail like Java's List.get instead of producing "no value".
  elementAt: {
    run(value, config, ctx) {
      if (!Array.isArray(value)) fail('elementAt requires an array');
      const index = integerParameter(ctx.required('index'), 'index', ctx);
      if (index < 0 || index >= value.length)
        fail(`elementAt index ${index} is out of range for ${value.length} element(s)`);
      return value[index];
    },
  },

  compositeId: {
    run(value, config, ctx) {
      if (ctx.required('separator') !== ':') fail('compositeId supports only colon separator');
      const subId = ctx.required('subId');
      const suffix = typeof subId === 'string' && subId.startsWith('$') ? readPath(ctx.data, subId, ctx.env) : subId;
      return inputText(value, ctx) + ':' + inputText(suffix, { name: `${ctx.name} subId` });
    },
  },
};
