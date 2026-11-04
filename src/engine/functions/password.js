import { fail } from '../util.js';

const MAX_LENGTH = 4096;
const DEFAULT_SPECIAL_SYMBOLS = '~!@#$%^&*()_+';
const minimumCountKeys = [
  'minimumNumberOfLowercaseLetters',
  'minimumNumberOfUppercaseLetters',
  'minimumNumberOfDigits',
  'minimumNumberOfSpecialSymbols',
];

// Uniform random index in [0, n) using rejection sampling to avoid modulo bias.
function randomIndex(n) {
  if (n < 1) fail('Empty character set in randomPassword');
  const limit = 0x100000000 - (0x100000000 % n);
  let random;
  do {
    random = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (random >= limit);
  return random % n;
}

function shuffle(chars) {
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
}

// Character sets as code point arrays (a custom symbol may be outside the BMP).
function characterSets(config) {
  const symbols = config.specialSymbols ?? DEFAULT_SPECIAL_SYMBOLS;
  if (typeof symbols !== 'string' || symbols === '') fail('randomPassword specialSymbols must be a non-empty string');
  return [[...'abcdefghijklmnopqrstuvwxyz'], [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'], [...'0123456789'], [...symbols]];
}

export const passwordFunctions = {
  randomPassword: {
    run(value, config, ctx) {
      const length = ctx.required('passwordLength');
      const sets = characterSets(config);
      const counts = minimumCountKeys.map((key) => ctx.required(key));
      if (
        !Number.isInteger(length) ||
        length < 1 ||
        length > MAX_LENGTH ||
        counts.some((n) => !Number.isInteger(n) || n < 0) ||
        counts.reduce((a, b) => a + b, 0) > length
      ) {
        fail('Invalid randomPassword length or minimum character counts');
      }
      // SAP: a custom set of special symbols requires a nonzero special-symbol minimum.
      if (config.specialSymbols !== undefined && counts[3] === 0) {
        fail('randomPassword with custom specialSymbols requires minimumNumberOfSpecialSymbols above 0');
      }

      const chars = [];
      sets.forEach((set, i) => {
        for (let n = 0; n < counts[i]; n++) chars.push(set[randomIndex(set.length)]);
      });
      // Remaining positions may come from any set that was not excluded with a zero minimum.
      const allowed = sets.filter((_, i) => counts[i] > 0).flat();
      if (chars.length < length && allowed.length === 0) {
        fail(
          'randomPassword needs at least one nonzero minimum to define the characters that fill the remaining length',
        );
      }
      while (chars.length < length) chars.push(allowed[randomIndex(allowed.length)]);
      shuffle(chars);
      return chars.join('');
    },
  },
};
