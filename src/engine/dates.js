import { fail } from './util.js';

// manipulateDate: java.time.format.DateTimeFormatter-style patterns (SAP's own examples use
// `uuuu` and `d MMM uuuu`, and currentDate is documented against DateTimeFormatter).
//
// Model: a "pure" wall-clock date/time with optional fixed UTC offset, computed on the proleptic
// Gregorian calendar with integer arithmetic. There is no time zone database, no DST and no
// system time zone: arithmetic never shifts wall-clock fields. A parsed offset is only carried to
// the output. SAP states that the time zone is ignored in calculation and Date(milliseconds) is
// converted to a "pure" date, displayed with a UTC offset -- so Date(milliseconds) is read and
// written as UTC. A target pattern that needs an offset the input does not carry is an error.
//
// Supported tokens (English text, case-sensitive like DateTimeFormatter's default):
//   yyyy uuuu (4-digit year 0001-9999)  yy uu (2-digit year, 2000-2099)
//   MM M  MMM MMMM  dd d  HH H  hh h + a  mm m  ss s  S SS SSS (fraction truncated to ms)
//   X XX XXX x xx xxx Z (offsets)   EEE EEEE E EE (day of week, target pattern only)
//   'quoted literal' and '' (a quote). Any other letter, and [ ] { } #, is an error.
// Date-time fields the source does not provide are unknown: a target token that needs one fails.
// Invalid dates such as 2023-02-30 are rejected (java.time's SMART mode would clamp them and
// lenient SimpleDateFormat would roll them over; neither is established for SAP).

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MS_PER_DAY = 86_400_000;
const MAX_ABS_EPOCH_MS = 8.64e15;

// token -> { parse: regex source for one capture group, field: the date-time field it reads }
const TOKENS = {
  yyyy: { parse: '\\d{4}', field: 'year' },
  uuuu: { parse: '\\d{4}', field: 'year' },
  yy: { parse: '\\d{2}', field: 'year', reduced: true },
  uu: { parse: '\\d{2}', field: 'year', reduced: true },
  MM: { parse: '\\d{2}', field: 'month' },
  M: { parse: '\\d{1,2}', field: 'month' },
  MMM: { parse: MONTH_NAMES.map((name) => name.slice(0, 3)).join('|'), field: 'month', named: true },
  MMMM: { parse: MONTH_NAMES.join('|'), field: 'month', named: true },
  dd: { parse: '\\d{2}', field: 'day' },
  d: { parse: '\\d{1,2}', field: 'day' },
  HH: { parse: '\\d{2}', field: 'hour' },
  H: { parse: '\\d{1,2}', field: 'hour' },
  hh: { parse: '\\d{2}', field: 'hour', clock: true },
  h: { parse: '\\d{1,2}', field: 'hour', clock: true },
  a: { parse: 'AM|PM', field: 'meridiem' },
  mm: { parse: '\\d{2}', field: 'minute' },
  m: { parse: '\\d{1,2}', field: 'minute' },
  ss: { parse: '\\d{2}', field: 'second' },
  s: { parse: '\\d{1,2}', field: 'second' },
  S: { parse: '\\d', field: 'millis' },
  SS: { parse: '\\d{2}', field: 'millis' },
  SSS: { parse: '\\d{3}', field: 'millis' },
  X: { parse: 'Z|[+-]\\d{2}(?:\\d{2})?', field: 'offset' },
  XX: { parse: 'Z|[+-]\\d{4}', field: 'offset' },
  XXX: { parse: 'Z|[+-]\\d{2}:\\d{2}', field: 'offset' },
  x: { parse: '[+-]\\d{2}(?:\\d{2})?', field: 'offset' },
  xx: { parse: '[+-]\\d{4}', field: 'offset' },
  xxx: { parse: '[+-]\\d{2}:\\d{2}', field: 'offset' },
  Z: { parse: '[+-]\\d{4}', field: 'offset' },
};
// Printed only: parsing a day of week would need a consistency check against the date.
const OUTPUT_ONLY_TOKENS = new Set(['E', 'EE', 'EEE', 'EEEE']);

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year, month) {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant's civil-days algorithm).
function daysFromCivil(year, month, day) {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

function civilFromDays(days) {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
  );
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthIndex = Math.floor((5 * dayOfYear + 2) / 153);
  const month = monthIndex < 10 ? monthIndex + 3 : monthIndex - 9;
  return {
    year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0),
    month,
    day: dayOfYear - Math.floor((153 * monthIndex + 2) / 5) + 1,
  };
}

// Fails with `message`, carrying the failing range of the pattern for validateDatePattern.
function rejectAt(message, offset, length) {
  const error = new Error(message);
  error.offset = offset;
  error.length = length;
  throw error;
}

// Splits a pattern into { literal } and { token, at } parts (`at`: where the token starts).
function parsePattern(format, where, output) {
  if (typeof format !== 'string' || format === '') fail(`${where} must be a non-empty string`);
  const parts = [];
  let i = 0;
  while (i < format.length) {
    const char = format[i];
    if (char === "'") {
      // Java's DateTimeFormatterBuilder rule: an opening quote, `''` pairs inside it as escaped quotes, and a single
      // closing quote; an empty quoted section (`''`) stands for one quote. So `''''` is one quote, not two.
      const quoteStart = i;
      let literal = '';
      i++;
      for (;;) {
        if (i >= format.length) {
          rejectAt(`Unclosed quoted date literal in ${where}`, quoteStart, format.length - quoteStart);
        }
        if (format[i] === "'" && format[i + 1] === "'") {
          literal += "'";
          i += 2;
        } else if (format[i] === "'") {
          i++;
          break;
        } else {
          literal += format[i++];
        }
      }
      parts.push({ literal: literal === '' ? "'" : literal });
    } else if (/[A-Za-z]/.test(char)) {
      let end = i;
      while (format[end] === char) end++;
      const token = format.slice(i, end);
      const supported = Object.hasOwn(TOKENS, token) || (output && OUTPUT_ONLY_TOKENS.has(token));
      if (!supported) rejectAt(`Unsupported Java date token ${JSON.stringify(token)} in ${where}`, i, token.length);
      parts.push({ token, at: i });
      i = end;
    } else if ('[]{}#'.includes(char)) {
      rejectAt(`Unsupported Java date pattern character ${JSON.stringify(char)} in ${where}`, i, 1);
    } else {
      parts.push({ literal: char });
      i++;
    }
  }
  return parts;
}

function parseOffset(text) {
  if (text === 'Z') return 0;
  const digits = text.replace(':', '');
  const minutes = Number(digits.slice(1, 3)) * 60 + Number(digits.slice(3) || 0);
  if (Number(digits.slice(3) || 0) > 59 || minutes > 18 * 60) fail(`Offset out of range: ${text}`);
  return digits[0] === '-' ? -minutes : minutes;
}

// Reads `value` with the source pattern; returns the known fields (undefined = not provided).
function parseDate(value, format) {
  const parts = parsePattern(format, 'sourceDateFormat', false);
  const tokens = parts.filter((part) => part.token).map((part) => part.token);
  const source = parts
    .map((part) => (part.token ? `(${TOKENS[part.token].parse})` : escapeRegExp(part.literal)))
    .join('');
  const match = new RegExp(`^${source}$`).exec(String(value));
  if (!match) fail(`Date ${JSON.stringify(value)} does not match sourceDateFormat ${format}`);

  const raw = {};
  tokens.forEach((token, i) => {
    const { field } = TOKENS[token];
    if (field in raw) fail(`sourceDateFormat ${format} reads the ${field} twice`);
    raw[field] = { token, text: match[i + 1] };
  });

  const fields = {};
  for (const [field, { token, text }] of Object.entries(raw)) {
    if (field !== 'meridiem') fields[field] = readField(field, TOKENS[token], text);
  }
  if (raw.meridiem && !raw.hour) fail('sourceDateFormat uses a (AM/PM) without an hour token');
  if (raw.hour && TOKENS[raw.hour.token].clock) {
    if (!raw.meridiem) fail('sourceDateFormat uses hh/h without a (AM/PM): the hour of day is ambiguous');
    if (fields.hour < 1 || fields.hour > 12)
      fail(`Invalid date ${JSON.stringify(value)}: clock hour ${fields.hour} is not 1-12`);
    fields.hour = (fields.hour % 12) + (raw.meridiem.text === 'PM' ? 12 : 0);
  }

  validate(fields, value);
  if (raw.meridiem && !TOKENS[raw.hour.token].clock && fields.hour >= 12 !== (raw.meridiem.text === 'PM')) {
    fail(`Invalid date ${JSON.stringify(value)}: hour ${fields.hour} conflicts with ${raw.meridiem.text}`);
  }
  return completeTime(fields);
}

function readField(field, spec, text) {
  switch (field) {
    case 'year':
      return spec.reduced ? 2000 + Number(text) : Number(text);
    case 'month':
      return spec.named
        ? MONTH_NAMES.findIndex((name) => name === text || name.slice(0, 3) === text) + 1
        : Number(text);
    case 'millis':
      return Number(text.padEnd(3, '0'));
    case 'offset':
      return parseOffset(text);
    default:
      return Number(text);
  }
}

function validate(fields, value) {
  const bad = (message) => fail(`Invalid date ${JSON.stringify(value)}: ${message}`);
  if (fields.year !== undefined && fields.year < 1) bad('year 0000 is not supported');
  if (fields.month !== undefined && (fields.month < 1 || fields.month > 12))
    bad(`month ${fields.month} is out of range`);
  if (fields.day !== undefined) {
    if (fields.day < 1 || fields.day > 31) bad(`day ${fields.day} is out of range`);
    if (
      fields.month !== undefined &&
      fields.year !== undefined &&
      fields.day > daysInMonth(fields.year, fields.month)
    ) {
      bad(`day ${fields.day} does not exist in ${fields.year}-${String(fields.month).padStart(2, '0')}`);
    }
  }
  if (fields.hour !== undefined && fields.hour > 23) bad(`hour ${fields.hour} is out of range`);
  if (fields.minute !== undefined && fields.minute > 59) bad(`minute ${fields.minute} is out of range`);
  if (fields.second !== undefined && fields.second > 59) bad(`second ${fields.second} is out of range`);
}

// Like java.time's SMART resolution: once the hour is known, smaller time fields default to 0;
// minutes/seconds without an hour cannot form a time.
function completeTime(fields) {
  if (fields.hour === undefined) {
    if (fields.minute !== undefined || fields.second !== undefined || fields.millis !== undefined) {
      fail('sourceDateFormat has minutes/seconds/fraction but no hour');
    }
    return fields;
  }
  return { ...fields, minute: fields.minute ?? 0, second: fields.second ?? 0, millis: fields.millis ?? 0 };
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

function hasDate(fields) {
  return fields.year !== undefined && fields.month !== undefined && fields.day !== undefined;
}

function hasTime(fields) {
  return fields.hour !== undefined;
}

function toEpochMs(fields) {
  const days = daysFromCivil(fields.year, fields.month, fields.day);
  const time = hasTime(fields) ? ((fields.hour * 60 + fields.minute) * 60 + fields.second) * 1000 + fields.millis : 0;
  return days * MS_PER_DAY + time;
}

function fromEpochMs(epochMs, template) {
  if (!Number.isSafeInteger(epochMs) || Math.abs(epochMs) > MAX_ABS_EPOCH_MS) fail('Resulting date is out of range');
  const days = Math.floor(epochMs / MS_PER_DAY);
  const msOfDay = epochMs - days * MS_PER_DAY;
  const fields = { ...civilFromDays(days), offset: template.offset };
  if (hasTime(template)) {
    fields.hour = Math.floor(msOfDay / 3_600_000);
    fields.minute = Math.floor(msOfDay / 60_000) % 60;
    fields.second = Math.floor(msOfDay / 1000) % 60;
    fields.millis = msOfDay % 1000;
  }
  return fields;
}

// Adds whole years/months to the calendar date, clamping the day like java.time's plusMonths.
function shiftMonths(fields, months) {
  const total = fields.year * 12 + (fields.month - 1) + months;
  const year = Math.floor(total / 12);
  const month = (((total % 12) + 12) % 12) + 1;
  return { ...fields, year, month, day: Math.min(fields.day, daysInMonth(year, month)) };
}

// SAP gives "+2", "-1" and "3" as example values: integers or signed integer strings.
function amount(value, key) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^[+-]?\d{1,15}$/.test(value)) return Number(value);
  return fail(`manipulateDate ${key} must be an integer or a signed integer string, got ${JSON.stringify(value)}`);
}

// [option, months per unit | milliseconds per unit]
const SHIFT_UNITS = [
  ['years', { months: 12 }],
  ['months', { months: 1 }],
  ['days', { ms: 86_400_000 }],
  ['hours', { ms: 3_600_000 }],
  ['minutes', { ms: 60_000 }],
  ['seconds', { ms: 1000 }],
];

// Applies years, months, days, hours, minutes, seconds in that order, each step on the result
// of the previous one (a month step clamps the day; later steps see the clamped date).
function shift(fields, options) {
  const active = SHIFT_UNITS.map(([key, unit]) => ({
    key,
    unit,
    count: options[key] === undefined ? 0 : amount(options[key], key),
  })).filter(({ count }) => count !== 0);
  if (!active.length) return fields;
  if (!hasDate(fields)) fail(`manipulateDate ${active[0].key} needs year, month and day in sourceDateFormat`);
  if (active.some(({ unit }) => unit.ms < 86_400_000) && !hasTime(fields)) {
    fail('manipulateDate hours/minutes/seconds need an hour in sourceDateFormat');
  }

  let current = fields;
  for (const { unit, count } of active) {
    current =
      unit.months === undefined
        ? fromEpochMs(toEpochMs(current) + count * unit.ms, current)
        : shiftMonths(current, count * unit.months);
  }
  return current;
}

function pad(number, width) {
  return String(number).padStart(width, '0');
}

function formatOffset(token, offset) {
  const sign = offset < 0 ? '-' : '+';
  const hours = pad(Math.floor(Math.abs(offset) / 60), 2);
  const minutes = pad(Math.abs(offset) % 60, 2);
  const zeroAsZ = token[0] === 'X' && offset === 0;
  if (zeroAsZ) return 'Z';
  switch (token) {
    case 'X':
    case 'x':
      return sign + hours + (minutes === '00' ? '' : minutes);
    case 'XXX':
    case 'xxx':
      return `${sign}${hours}:${minutes}`;
    default:
      return sign + hours + minutes;
  }
}

function formatToken(token, fields) {
  const need = (name, value) => {
    if (value === undefined)
      fail(`targetDateFormat token ${token} needs ${name}, which sourceDateFormat does not provide`);
    return value;
  };
  switch (token[0]) {
    case 'y':
    case 'u': {
      const year = need('the year', fields.year);
      if (year < 1 || year > 9999) fail(`Year ${year} does not fit pattern ${token}`);
      return token.length === 2 ? pad(year % 100, 2) : pad(year, 4);
    }
    case 'M': {
      const month = need('the month', fields.month);
      if (token.length >= 3) return token.length === 3 ? MONTH_NAMES[month - 1].slice(0, 3) : MONTH_NAMES[month - 1];
      return pad(month, token.length);
    }
    case 'd':
      return pad(need('the day', fields.day), token.length);
    case 'E': {
      const day = need('the full date', hasDate(fields) ? fields : undefined);
      const name = DAY_NAMES[(((daysFromCivil(day.year, day.month, day.day) + 3) % 7) + 7) % 7];
      return token.length === 4 ? name : name.slice(0, 3);
    }
    case 'H':
      return pad(need('the hour', fields.hour), token.length);
    case 'h':
      return pad(need('the hour', fields.hour) % 12 || 12, token.length);
    case 'a':
      return need('the hour', fields.hour) < 12 ? 'AM' : 'PM';
    case 'm':
      return pad(need('the time', fields.minute), token.length);
    case 's':
      return pad(need('the time', fields.second), token.length);
    case 'S':
      return pad(need('the time', fields.millis), 3).slice(0, token.length);
    default:
      return formatOffset(token, need('a UTC offset (no time zone is assumed)', fields.offset));
  }
}

const EPOCH_FORMAT = 'Date(milliseconds)';

function parseEpochDate(value) {
  const match = /^\/?Date\((-?\d{1,15})\)\/?$/.exec(String(value));
  const ms = match ? Number(match[1]) : typeof value === 'number' ? value : NaN;
  if (!Number.isSafeInteger(ms)) {
    fail(`Date ${JSON.stringify(value)} is not Date(<epoch milliseconds>); offsets inside Date(...) are not supported`);
  }
  return fromEpochMs(ms, { hour: 0, offset: 0 });
}

const DEFAULT_FORMAT = 'yyyy-MM-dd HH:mm:ss.SSS';

export function manipulateDate(value, options) {
  const source = options.sourceDateFormat ?? DEFAULT_FORMAT;
  const target = options.targetDateFormat ?? source;
  if (value === null || typeof value === 'object' || value === undefined) {
    fail(`manipulateDate requires a string or number input, got ${JSON.stringify(value) ?? 'undefined'}`);
  }

  const fromEpoch = source === EPOCH_FORMAT;
  const shifted = shift(fromEpoch ? parseEpochDate(value) : parseDate(value, source), options);
  if (target === EPOCH_FORMAT) {
    if (!hasDate(shifted) || !hasTime(shifted))
      fail('Date(milliseconds) output needs a full date and time in the source');
    return `Date(${toEpochMs(shifted)})`;
  }
  return parsePattern(target, 'targetDateFormat', true)
    .map((part) => part.literal ?? formatToken(part.token, shifted))
    .join('');
}

// ---- validation ---------------------------------------------------------------------------------------------

// Date-time fields known whatever the text (a Date(milliseconds) source provides all of them).
const EPOCH_FIELDS = ['year', 'month', 'day', 'hour', 'minute', 'second', 'millis', 'offset'];
const TIME_FIELDS = ['minute', 'second', 'millis'];

// The fields a target token prints, and how formatToken names what the source must provide.
const TOKEN_NEEDS = {
  y: [['year', 'the year']],
  u: [['year', 'the year']],
  M: [['month', 'the month']],
  d: [['day', 'the day']],
  E: [['year', 'the full date']],
  H: [['hour', 'the hour']],
  h: [['hour', 'the hour']],
  a: [['hour', 'the hour']],
  m: [['minute', 'the time']],
  s: [['second', 'the time']],
  S: [['millis', 'the time']],
};
const OFFSET_NEED = [['offset', 'a UTC offset (no time zone is assumed)']];

// Fields a source pattern provides, after the pattern-level rules parseDate enforces whatever the value:
// no field twice, a (AM/PM) needs an hour, hh/h needs a (AM/PM), minutes/seconds/fraction need an hour.
function sourceFieldSet(format) {
  const raw = {};
  for (const { token } of parsePattern(format, 'sourceDateFormat', false)) {
    if (token === undefined) continue;
    const { field } = TOKENS[token];
    if (field in raw) fail(`sourceDateFormat ${format} reads the ${field} twice`);
    raw[field] = token;
  }
  if (raw.meridiem && !raw.hour) fail('sourceDateFormat uses a (AM/PM) without an hour token');
  if (raw.hour && TOKENS[raw.hour].clock && !raw.meridiem) {
    fail('sourceDateFormat uses hh/h without a (AM/PM): the hour of day is ambiguous');
  }
  const fields = new Set(Object.keys(raw));
  fields.delete('meridiem');
  if (!fields.has('hour')) {
    if (TIME_FIELDS.some((field) => fields.has(field)))
      fail('sourceDateFormat has minutes/seconds/fraction but no hour');
  } else {
    for (const field of TIME_FIELDS) fields.add(field);
  }
  return fields;
}

function dateFailure(error, kind, key) {
  const { message, offset, length } = error;
  return {
    ok: false,
    error: { domain: 'date', kind: error.kind ?? kind, key: error.key ?? key, message, offset, length },
  };
}

// Parse-only check of one date pattern: `role` 'source' (sourceDateFormat) or 'target' (targetDateFormat).
// 'Date(milliseconds)' is valid for both. Returns { ok: true } or
// { ok: false, error: { domain: 'date', kind: 'pattern', message, offset?, length? } }. A source pattern is
// also held to the rules that do not depend on the date text (see sourceFieldSet).
export function validateDatePattern(format, role = 'target') {
  try {
    if (format !== EPOCH_FORMAT) {
      if (role === 'source') sourceFieldSet(format);
      else parsePattern(format, 'targetDateFormat', true);
    }
    return { ok: true };
  } catch (error) {
    return dateFailure(error, 'pattern', role === 'source' ? 'sourceDateFormat' : 'targetDateFormat');
  }
}

function tagged(key, action) {
  try {
    return action();
  } catch (error) {
    error.key ??= key;
    throw error;
  }
}

// Checks the amounts and what the shift needs from the source (a date for years..days, an hour for
// hours..seconds), as shift() does. Returns nothing; throws like shift().
function checkShift(options, provided) {
  const active = [];
  for (const [key, unit] of SHIFT_UNITS) {
    if (options[key] === undefined) continue;
    const count = tagged(key, () => amount(options[key], key));
    if (count !== 0) active.push({ key, unit });
  }
  if (!active.length) return;
  if (!['year', 'month', 'day'].every((field) => provided.has(field))) {
    tagged(active[0].key, () => fail(`manipulateDate ${active[0].key} needs year, month and day in sourceDateFormat`));
  }
  const clock = active.find(({ unit }) => unit.ms < 86_400_000);
  if (clock && !provided.has('hour')) {
    tagged(clock.key, () => fail('manipulateDate hours/minutes/seconds need an hour in sourceDateFormat'));
  }
}

function checkTarget(target, provided) {
  if (target === EPOCH_FORMAT) {
    if (!['year', 'month', 'day', 'hour'].every((field) => provided.has(field))) {
      fail('Date(milliseconds) output needs a full date and time in the source');
    }
    return;
  }
  for (const { token, at } of parsePattern(target, 'targetDateFormat', true)) {
    if (token === undefined) continue;
    const needs = TOKEN_NEEDS[token[0]] ?? OFFSET_NEED;
    const [, name] = needs[0];
    const fields = token[0] === 'E' ? ['year', 'month', 'day'] : needs.map(([field]) => field);
    if (!fields.every((field) => provided.has(field))) {
      rejectAt(
        `targetDateFormat token ${token} needs ${name}, which sourceDateFormat does not provide`,
        at,
        token.length,
      );
    }
  }
}

// Parse-only check of the manipulateDate options as manipulateDate would use them, without an input value:
// both patterns, the amounts (years..seconds), what the shift needs from the source and what each target token
// needs from it. Omit an option whose value is not known yet (a `${variable}`); an omitted targetDateFormat
// defaults to the source pattern, as in the evaluator.
// Returns { ok: true } or { ok: false, error: { domain: 'date', kind: 'pattern', key, message, offset?, length? } }
// where `key` names the option at fault ('sourceDateFormat', 'targetDateFormat', 'years', ...) and
// offset/length point into that option's pattern. Not judged: the date text itself (it must match the source
// pattern and name a real date) and the range of the result.
export function validateManipulateDate(options) {
  try {
    const source = options.sourceDateFormat ?? DEFAULT_FORMAT;
    const target = options.targetDateFormat ?? source;
    const provided = new Set(
      tagged('sourceDateFormat', () => (source === EPOCH_FORMAT ? EPOCH_FIELDS : sourceFieldSet(source))),
    );
    checkShift(options, provided);
    tagged('targetDateFormat', () => checkTarget(target, provided));
    return { ok: true };
  } catch (error) {
    return dateFailure(error, 'pattern', 'targetDateFormat');
  }
}
