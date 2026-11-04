import { fail } from '../util.js';
import { inputText } from './values.js';

// base32 / base64 per RFC 4648 with the standard alphabets only (no URL-safe variants: SAP
// does not document them). Everything works on explicit byte arrays, never on Latin-1 strings,
// so atob/btoa pitfalls cannot occur. Decoded data is an array of byte values; `toString`
// turns it back into text.
const alphabets = {
  base32: { symbols: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', bits: 5, block: 8 },
  base64: { symbols: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/', bits: 6, block: 4 },
};

const UNPAIRED_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

function encodeUtf8(text, ctx) {
  if (UNPAIRED_SURROGATE.test(text)) fail(`${ctx.name} input contains an unpaired surrogate and has no UTF-8 form`);
  return new TextEncoder().encode(text);
}

// Explicit input coercion: a byte array (integers 0-255 only) is used as is; a string, number
// or boolean is encoded as UTF-8 text (SAP: "the string is assumed in UTF-8"); anything else
// (null, objects) is rejected.
function toBytes(value, ctx) {
  if (!Array.isArray(value) && !(value instanceof Uint8Array)) return encodeUtf8(inputText(value, ctx), ctx);
  const bad = Array.prototype.findIndex.call(value, (byte) => !Number.isInteger(byte) || byte < 0 || byte > 255);
  if (bad >= 0)
    fail(`${ctx.name} byte array must contain integers 0-255 only (index ${bad}: ${JSON.stringify(value[bad])})`);
  return value;
}

function encode(bytes, algorithm, skipPadding) {
  const { symbols, bits, block } = alphabets[algorithm];
  const mask = (1 << bits) - 1;
  let buffer = 0;
  let count = 0;
  let result = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    count += 8;
    while (count >= bits) {
      count -= bits;
      result += symbols[(buffer >>> count) & mask];
    }
    buffer &= (1 << count) - 1;
  }
  if (count > 0) result += symbols[(buffer << (bits - count)) & mask];
  if (!skipPadding) while (result.length % block) result += '=';
  return result;
}

function invalidSymbolHint(algorithm, char) {
  if (algorithm === 'base32' && char !== char.toUpperCase()) return ' (base32 symbols are upper case)';
  if (algorithm === 'base64' && (char === '-' || char === '_')) return ' (URL-safe base64 is not supported)';
  return '';
}

// Padding is optional (Java's Base64 decoder documents it as not required), but when present it
// must be exactly what completes the final block. Trailing bits of the last symbol are ignored.
function decode(text, algorithm) {
  const { symbols, bits, block } = alphabets[algorithm];
  const parts = /^([^=]*)(=*)$/.exec(text);
  if (!parts) fail(`Invalid ${algorithm} input: '=' padding may only appear at the end`);
  const [, body, padding] = parts;
  for (const char of body) {
    if (!symbols.includes(char)) {
      fail(
        `Invalid ${algorithm} input: unexpected character ${JSON.stringify(char)}${invalidSymbolHint(algorithm, char)}`,
      );
    }
  }
  if ((body.length * bits) % 8 >= bits) fail(`Invalid ${algorithm} input: the length ${body.length} is impossible`);
  if (padding && padding.length !== (block - (body.length % block)) % block) {
    fail(`Invalid ${algorithm} input: wrong amount of '=' padding`);
  }

  const bytes = [];
  let buffer = 0;
  let count = 0;
  for (const char of body) {
    buffer = (buffer << bits) | symbols.indexOf(char);
    count += bits;
    if (count >= 8) {
      count -= 8;
      bytes.push((buffer >>> count) & 255);
      buffer &= (1 << count) - 1;
    }
  }
  return bytes;
}

function checkAlgorithm(direction, config, ctx) {
  const algorithm = ctx.required('algorithm');
  if (!Object.hasOwn(alphabets, algorithm)) fail(`Unsupported ${direction} algorithm: ${algorithm}`);
  if (config.skipPadding !== undefined && typeof config.skipPadding !== 'boolean') {
    fail(`${ctx.name} skipPadding must be a boolean`);
  }
  return algorithm;
}

export const encodingFunctions = {
  encode: {
    run(value, config, ctx) {
      const algorithm = checkAlgorithm('encode', config, ctx);
      return encode(toBytes(value, ctx), algorithm, config.skipPadding === true);
    },
  },

  // skipPadding has no effect on decoding: padded and unpadded input are both accepted.
  decode: {
    run(value, config, ctx) {
      const algorithm = checkAlgorithm('decode', config, ctx);
      if (typeof value !== 'string') fail(`${ctx.name} requires a string input`);
      return decode(value, algorithm);
    },
  },

  // SAP: accepts a byte array or a string representation (UTF-8). Malformed UTF-8 is an error;
  // new String(bytes, UTF_8) in Java would substitute U+FFFD, which is not reproduced.
  toString: {
    run(value, config, ctx) {
      if (!Array.isArray(value) && !(value instanceof Uint8Array)) return inputText(value, ctx);
      const bytes = Uint8Array.from(toBytes(value, ctx));
      try {
        // ignoreBOM keeps a leading U+FEFF in the text instead of dropping it.
        return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch {
        return fail(`${ctx.name} bytes are not valid UTF-8`);
      }
    },
  },
};
