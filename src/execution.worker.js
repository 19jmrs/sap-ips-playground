import { runPipeline, evaluateExpression } from './engine/index.js';

const handlers = { pipeline: runPipeline, expression: evaluateExpression };

self.onmessage = ({ data: { kind, payload } }) => {
  try {
    const handler = handlers[kind];
    if (!handler) throw new Error(`Unknown execution request: ${kind}`);
    self.postMessage({ value: handler(JSON.parse(payload)) });
  } catch (error) {
    self.postMessage({ error: error.message || 'Execution failed' });
  }
};
