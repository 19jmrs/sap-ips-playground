import { manipulateDate } from '../dates.js';
import timezonePairs from '../timezones.json' with { type: 'json' };
import { fail } from '../util.js';

const timezoneFormats = ['iana', 'sap'];
const localeFormats = ['bcp47', 'iso639'];

// SAP documents the fallback: a timezone that is missing or not in the table becomes
// Europe/Berlin (iana) or CET (sap). The fallback is reported through ctx.note so the trace
// can show that the output is a default and not a mapped value.
const convertTimezoneCode = {
  run(value, config, ctx) {
    const format = ctx.required('outputFormat');
    if (!timezoneFormats.includes(format)) fail('Invalid convertTimezoneCode outputFormat');
    const pair = timezonePairs.find(([sap, iana]) => sap === value || iana === value);
    if (!pair) {
      ctx.note('fallbackUsed', true);
      return format === 'sap' ? 'CET' : 'Europe/Berlin';
    }
    // For iana output the first table entry of the matching SAP code wins (documented).
    return format === 'sap' ? pair[0] : timezonePairs.find(([sap]) => sap === pair[0])[1];
  },
};

function localeTable(env) {
  const table = env.localeMappings;
  if (!Array.isArray(table)) {
    fail(
      'convertLocaleCode requires context.localeMappings: ordered [ISO639, BCP47] pairs from Identity Authentication default language master data; built-in SAP table not verified',
    );
  }
  const malformed = table.findIndex(
    (pair) => !Array.isArray(pair) || pair.length !== 2 || !pair.every((code) => typeof code === 'string'),
  );
  if (malformed >= 0) fail(`context.localeMappings[${malformed}] must be an [ISO639, BCP47] pair of strings`);
  return table;
}

// The tenant's Identity Authentication default-language table is not a generic BCP47
// canonicalisation operation, so the caller supplies it. SAP: languages without a mapping
// "are mapped to English by default"; English is the table's EN entry (never invented).
const convertLocaleCode = {
  run(value, config, ctx) {
    const format = ctx.required('outputFormat');
    if (!localeFormats.includes(format)) fail('Invalid convertLocaleCode outputFormat');
    const table = localeTable(ctx.env);
    const column = format === 'iso639' ? 0 : 1;

    const pair = table.find(([iso, bcp]) => iso === value || bcp === value);
    if (pair) return pair[column];

    ctx.note('fallbackUsed', true);
    const english = table.find(([iso]) => iso === 'EN');
    if (english) return english[column];
    if (format === 'iso639') return 'EN';
    return fail(
      'convertLocaleCode fallback to English needs an EN entry in context.localeMappings to give its BCP 47 code',
    );
  },
};

export const conversionFunctions = {
  convertTimezoneCode,
  convertLocaleCode,
  manipulateDate: {
    run(value, config) {
      return manipulateDate(value, config);
    },
  },
};
