import countries from 'i18n-iso-countries';
import countryEnglish from 'i18n-iso-countries/langs/en.json' with { type: 'json' };
import { allCountries } from 'country-region-data';
import { fail, forbidden } from '../util.js';

// Country datasets are heavy; only this module loads them.
countries.registerLocale(countryEnglish);

const countryCodeFormats = ['fullName', 'alpha2', 'alpha3', 'numeric'];
const regionFormats = ['fullName', 'alpha2'];

// The SAP example (Provisioning_Service.pdf p.478) lists "United States" as the fullName of US,
// while the dataset's ISO name is "United States of America". Only documented values go here.
const documentedFullNames = { US: 'United States' };

// Lower-cased English name -> alpha-2 codes, over every name the dataset knows (the official
// name plus its aliases). A name claimed by two countries ("Congo") is ambiguous.
const nameIndex = new Map();
for (const [alpha2, names] of Object.entries(countries.getNames('en', { select: 'all' }))) {
  for (const name of [names].flat()) {
    const key = name.toLowerCase();
    nameIndex.set(key, [...(nameIndex.get(key) ?? []), alpha2]);
  }
}

function resolveByName(text) {
  const matches = nameIndex.get(text.toLowerCase()) ?? [];
  if (matches.length > 1) fail(`Ambiguous country name "${text}": ${matches.join(', ')}`);
  return matches[0];
}

// Accepted country inputs (all resolve to the same ISO 3166-1 alpha-2 code):
//   - alpha-2 ("US", "us"), alpha-3 ("USA", "usa"), 3-digit numeric ("840")
//   - an integer number 1..999, zero-padded to the numeric code (JSON cannot hold "004")
//   - an English country name or alias from the dataset, case-insensitive ("United States", "UK");
//     a valid code always wins over a name
// No trimming and no other aliases: unknown input is an error, never a guess.
function toAlpha2(input, ctx) {
  if (typeof input === 'number' && Number.isInteger(input))
    return countries.numericToAlpha2(String(input).padStart(3, '0'));
  if (typeof input !== 'string') fail(`${ctx.name} requires a country name or code, got ${JSON.stringify(input)}`);
  if (/^[A-Za-z]{2}$/.test(input) && countries.isValid(input)) return input.toUpperCase();
  if (/^[A-Za-z]{3}$/.test(input) && countries.isValid(input)) return countries.alpha3ToAlpha2(input.toUpperCase());
  if (/^[0-9]{3}$/.test(input)) return countries.numericToAlpha2(input);
  return resolveByName(input);
}

function formatCountry(alpha2, format) {
  switch (format) {
    case 'alpha2':
      return alpha2;
    case 'alpha3':
      return countries.alpha2ToAlpha3(alpha2);
    case 'numeric':
      // Three-digit string: leading zeros are significant ("004").
      return countries.alpha2ToNumeric(alpha2);
    default:
      return documentedFullNames[alpha2] ?? countries.getName(alpha2, 'en', { select: 'official' });
  }
}

function convertCountry(input, format, ctx) {
  const alpha2 = toAlpha2(input, ctx);
  if (!alpha2) fail(`Unknown country: ${input}`);
  return formatCountry(alpha2, format);
}

// SAP: inputAttributes is a "single value or list of address attributes"; outputAttribute is written.
function attributeList(inputAttributes, ctx) {
  const list = typeof inputAttributes === 'string' ? [inputAttributes] : inputAttributes;
  if (!Array.isArray(list) || !list.length || !list.every((key) => typeof key === 'string')) {
    fail(`${ctx.name} inputAttributes must be an attribute name or a list of attribute names`);
  }
  return list;
}

const convertCountryCode = {
  mapsArrayInput: true,
  run(value, config, ctx) {
    const format = ctx.required('outputFormat');
    if (!countryCodeFormats.includes(format)) fail('Invalid convertCountryCode outputFormat');
    if (config.inputAttributes === undefined) return convertCountry(value, format, ctx);

    const attributes = attributeList(config.inputAttributes, ctx);
    if (typeof config.outputAttribute !== 'string' || !value || typeof value !== 'object' || Array.isArray(value)) {
      fail('convertCountryCode inputAttributes requires an object and outputAttribute');
    }
    if (forbidden.has(config.outputAttribute) || attributes.some((key) => forbidden.has(key))) {
      fail('Unsafe country attribute');
    }
    const source = attributes.find((key) => value[key] != null);
    if (!source) fail('convertCountryCode input attribute missing');
    return { ...value, [config.outputAttribute]: convertCountry(value[source], format, ctx) };
  },
};

// The dataset is inconsistent: some countries store subdivision codes with their country prefix
// ("DK-84"), and some regions have no code at all (the literal text "undefined", or "").
// Returns the bare ISO 3166-2 subdivision code ("84", "AL") or undefined.
function regionCode(alpha2, region) {
  const code = region[1].startsWith(alpha2 + '-') ? region[1].slice(3) : region[1];
  return /^[A-Za-z0-9]{1,3}$/.test(code) && code !== 'undefined' ? code : undefined;
}

// A region input is the ISO 3166-2 subdivision code with or without its country prefix
// ("AL", "US-AL", case-insensitive) or the region's English name ("Alabama"); codes win over names.
function findRegion(regions, alpha2, input) {
  const text = input.toLowerCase();
  const code = text.startsWith(alpha2.toLowerCase() + '-') ? text.slice(3) : text;
  return (
    regions.find((region) => regionCode(alpha2, region)?.toLowerCase() === code) ??
    regions.find((region) => region[0].toLowerCase() === text)
  );
}

const convertCountryRegion = {
  mapsArrayInput: true,
  run(value, config, ctx) {
    const attributes = ctx.required('inputAttributes');
    const output = ctx.required('outputAttribute');
    const format = ctx.required('outputFormat');
    if (
      !Array.isArray(attributes) ||
      !attributes.includes('country') ||
      !attributes.includes('region') ||
      !regionFormats.includes(format) ||
      typeof value !== 'object' ||
      value === null
    ) {
      fail('convertCountryRegion requires country/region inputAttributes and fullName/alpha2 outputFormat');
    }
    if (typeof output !== 'string' || forbidden.has(output)) fail('Unsafe region outputAttribute');
    if (typeof value.region !== 'string' || value.region === '') {
      fail(`Unknown region: ${JSON.stringify(value.region)} (a region name or code is required)`);
    }

    const alpha2 = toAlpha2(value.country, ctx);
    if (!alpha2) fail(`Unknown country: ${value.country}`);
    const regions = allCountries.find((entry) => entry[1] === alpha2)?.[2] ?? [];
    const region = findRegion(regions, alpha2, value.region);
    if (!region) fail(`Unknown region: ${value.region} for country ${alpha2}`);

    if (format === 'fullName') return { ...value, [output]: region[0] };
    const code = regionCode(alpha2, region);
    if (!code) fail(`Region ${region[0]} (${alpha2}) has no ISO 3166-2 code in the bundled dataset`);
    return { ...value, [output]: `${alpha2}-${code}` };
  },
};

export const countryFunctions = { convertCountryCode, convertCountryRegion };
