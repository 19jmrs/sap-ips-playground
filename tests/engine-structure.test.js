import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../src/engine/index.js';
import { functionParameters, supportedFunctions } from '../src/engine/catalog.js';
import { functionRegistry } from '../src/engine/functions/index.js';

test('every catalog function has an implementation and every implementation is in the catalog', () => {
  const implemented = Object.keys(functionRegistry).sort();
  const cataloged = Object.keys(functionParameters).sort();
  assert.deepEqual(implemented, cataloged);
  for (const [name, entry] of Object.entries(functionRegistry)) {
    assert.equal(typeof entry.run, 'function', `${name} has no run()`);
  }
});

test('the engine barrel exposes exactly the public API', () => {
  assert.deepEqual(Object.keys(engine).sort(), [
    'detectEntityPath',
    'evaluateExpression',
    'readPath',
    'runPipeline',
    'supportedFunctions',
  ]);
  assert.deepEqual(engine.supportedFunctions, supportedFunctions);
});
