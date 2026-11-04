import test from 'node:test';
import assert from 'node:assert/strict';
import { examples } from '../src/examples.js';
import { runPipeline } from '../src/engine/index.js';

test('shipped examples execute through the actual engine with expected stage and batch behavior', () => {
  for (const item of examples) {
    const result = runPipeline({ ...item, debug: true });
    assert.ok(result.summary.total > 0, item.id);
    assert.equal(result.summary.failed, item.id === 'errors' ? 1 : 0, item.id);
    assert.ok(result.summary.succeeded > 0, item.id);
    for (const entity of result.entities.filter((entity) => !entity.error && !entity.skipped)) {
      assert.ok(entity.output, item.id);
      if (item.mode !== 'target') assert.ok(entity.sourceOutput, item.id);
      if (item.mode !== 'source') assert.ok(entity.targetOutput, item.id);
      assert.ok(entity.trace.length > 0, item.id);
    }
  }
});
