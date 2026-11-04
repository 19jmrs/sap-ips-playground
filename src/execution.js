// A disposable worker keeps user-supplied expressions off the UI thread.
// Termination also discards the worker's copy of the input documents.
export const MAX_INPUT_BYTES = 5_000_000;
export const TIMEOUT_MS = 5_000;

export const INPUT_LIMIT_MESSAGE = 'This run exceeds the 5 MB workspace input limit. Reduce the batch size.';
export const TIMEOUT_MESSAGE =
  'Execution exceeded 5 seconds and was stopped. Reduce the batch or simplify the expression.';
// A worker also fails when its script cannot be loaded, which is what an open tab sees after the app was rebuilt.
export const WORKER_FAILED_MESSAGE =
  'The execution worker failed. Reload the page (Ctrl+F5) in case it is an old copy from before an update; if it still fails, review the input and try again.';

// Counts UTF-8 bytes without allocating an encoded copy of a potentially multi-megabyte string.
export function utf8ByteLength(text) {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

const createBrowserWorker = () => new Worker(new URL('./execution.worker.js', import.meta.url), { type: 'module' });

/**
 * Runs one request in a fresh worker. The arguments are serialised once: that string both measures the size limit
 * and is what the worker receives, so the object graph is neither traversed nor structured-cloned again.
 * `createWorker`, `maxBytes` and `timeoutMs` are injectable for tests.
 */
export function runInWorker(
  kind,
  args,
  { createWorker = createBrowserWorker, maxBytes = MAX_INPUT_BYTES, timeoutMs = TIMEOUT_MS } = {},
) {
  const payload = JSON.stringify(args);
  if (utf8ByteLength(payload) > maxBytes) return Promise.reject(new Error(INPUT_LIMIT_MESSAGE));
  return new Promise((resolve, reject) => {
    const worker = createWorker();
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      if (error) reject(new Error(error));
      else resolve(value);
    };
    const timer = setTimeout(() => finish(TIMEOUT_MESSAGE), timeoutMs);
    worker.onmessage = ({ data }) => finish(data.error, data.value);
    worker.onerror = () => finish(WORKER_FAILED_MESSAGE);
    worker.onmessageerror = () => finish(WORKER_FAILED_MESSAGE);
    worker.postMessage({ kind, payload });
  });
}

export const executePipeline = (args) => runInWorker('pipeline', args);
export const executeExpression = (args) => runInWorker('expression', args);
