import { clone, fail, forbidden, own } from '../util.js';

// putIfAbsent / putIfPresent. `mapsArrayInput` makes an array input apply per element
// without requiring applyOnElements.
// SAP: putIfAbsent sets the default "if an element key misses a value" (missing or null; an
// empty string counts as a value). putIfPresent overwrites a present member -- null included,
// which SAP does not specify -- and leaves absent members absent.
function putEntry(onlyWhenPresent) {
  function run(value, config, ctx) {
    if (Array.isArray(value)) return value.map((item) => run(item, config, ctx));
    if (!value || typeof value !== 'object') fail(`${ctx.name} requires an object or array of objects`);

    const result = clone(value);
    const key = ctx.required('key');
    if (forbidden.has(key)) fail('Unsafe function property');
    const shouldPut = onlyWhenPresent ? own(result, key) : !own(result, key) || result[key] === null;
    if (shouldPut) result[key] = clone(ctx.required('defaultValue'));
    return result;
  }
  return { mapsArrayInput: true, run };
}

// copyMapEntry / renameMapEntry. A missing source key leaves the object unchanged (SAP does
// not say whether Java fails here).
function copyEntry(removeSource) {
  return {
    mapsArrayInput: true,
    run(value, config, ctx) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${ctx.name} requires an object`);
      const source = ctx.required('sourceKey');
      const target = ctx.required('targetKey');
      if (forbidden.has(source) || forbidden.has(target)) fail('Unsafe map entry');

      const result = clone(value);
      if (own(result, source) && source !== target) {
        result[target] = clone(result[source]);
        if (removeSource) delete result[source];
      }
      return result;
    },
  };
}

export const mapEntryFunctions = {
  putIfAbsent: putEntry(false),
  putIfPresent: putEntry(true),
  copyMapEntry: copyEntry(false),
  renameMapEntry: copyEntry(true),
};
