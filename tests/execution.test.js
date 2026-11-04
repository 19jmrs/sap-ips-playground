import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INPUT_LIMIT_MESSAGE,
  MAX_INPUT_BYTES,
  TIMEOUT_MESSAGE,
  TIMEOUT_MS,
  WORKER_FAILED_MESSAGE,
  runInWorker,
  utf8ByteLength,
} from '../src/execution.js';

class FakeWorker {
  constructor() {
    this.terminated = 0;
    this.posted = [];
  }
  postMessage(message) {
    this.posted.push(message);
  }
  terminate() {
    this.terminated += 1;
  }
  reply(data) {
    this.onmessage({ data });
  }
}

function setup(options = {}) {
  const workers = [];
  const createWorker = () => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  };
  return { workers, options: { createWorker, ...options } };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('limits keep the documented 5 MB and 5 second bounds', () => {
  assert.equal(MAX_INPUT_BYTES, 5_000_000);
  assert.equal(TIMEOUT_MS, 5_000);
});

test('byte length follows UTF-8, including surrogate pairs', () => {
  assert.equal(utf8ByteLength('abc'), 3);
  assert.equal(utf8ByteLength('é'), 2);
  assert.equal(utf8ByteLength('€'), 3);
  assert.equal(utf8ByteLength('😀'), 4);
  assert.equal(utf8ByteLength(JSON.stringify({ k: 'é€😀' })), new TextEncoder().encode('{"k":"é€😀"}').length);
});

test('oversize input is rejected before any worker is created', async () => {
  const { workers, options } = setup({ maxBytes: 100 });
  await assert.rejects(runInWorker('pipeline', { data: 'x'.repeat(200) }, options), { message: INPUT_LIMIT_MESSAGE });
  assert.equal(workers.length, 0);
});

test('the size limit is measured in bytes of the serialised request and is inclusive', async () => {
  const exact = JSON.stringify({ d: 'x'.repeat(50) }).length;
  const at = setup({ maxBytes: exact });
  const pending = runInWorker('expression', { d: 'x'.repeat(50) }, at.options);
  at.workers[0].reply({ value: 1 });
  assert.equal(await pending, 1);
  const over = setup({ maxBytes: exact - 1 });
  await assert.rejects(runInWorker('expression', { d: 'x'.repeat(50) }, over.options), {
    message: INPUT_LIMIT_MESSAGE,
  });
  // Multi-byte characters count by bytes, so a short string of emoji can exceed a limit its length would pass.
  const emoji = setup({ maxBytes: 20 });
  await assert.rejects(runInWorker('expression', { d: '😀😀😀😀' }, emoji.options), { message: INPUT_LIMIT_MESSAGE });
});

test('the worker receives the request once, serialised, and resolves with its value then terminates', async () => {
  const { workers, options } = setup();
  const args = { data: { a: [1, 2] }, source: undefined, debug: false };
  const pending = runInWorker('pipeline', args, options);
  assert.equal(workers.length, 1);
  const [message] = workers[0].posted;
  assert.equal(message.kind, 'pipeline');
  assert.equal(typeof message.payload, 'string');
  assert.deepEqual(JSON.parse(message.payload), { data: { a: [1, 2] }, debug: false });
  workers[0].reply({ value: { ok: true } });
  assert.deepEqual(await pending, { ok: true });
  assert.equal(workers[0].terminated, 1);
});

test('an undefined result value resolves normally', async () => {
  const { workers, options } = setup();
  const pending = runInWorker('expression', {}, options);
  workers[0].reply({ value: undefined });
  assert.equal(await pending, undefined);
});

test('an error reply rejects with its message and terminates the worker', async () => {
  const { workers, options } = setup();
  const pending = runInWorker('pipeline', {}, options);
  workers[0].reply({ error: 'Required source value missing' });
  await assert.rejects(pending, { message: 'Required source value missing' });
  assert.equal(workers[0].terminated, 1);
});

test('a worker crash rejects with the generic failure message and terminates the worker', async () => {
  const { workers, options } = setup();
  const pending = runInWorker('pipeline', {}, options);
  workers[0].onerror(new Event('error'));
  await assert.rejects(pending, { message: WORKER_FAILED_MESSAGE });
  assert.equal(workers[0].terminated, 1);
});

test('an unreadable worker message is treated as a failure', async () => {
  const { workers, options } = setup();
  const pending = runInWorker('pipeline', {}, options);
  workers[0].onmessageerror();
  await assert.rejects(pending, { message: WORKER_FAILED_MESSAGE });
});

test('a worker that never answers is terminated at the timeout and the run rejects', async () => {
  const { workers, options } = setup({ timeoutMs: 15 });
  await assert.rejects(runInWorker('pipeline', {}, options), { message: TIMEOUT_MESSAGE });
  assert.equal(workers[0].terminated, 1);
});

test('a reply that arrives in time cancels the timeout and later events are ignored', async () => {
  const { workers, options } = setup({ timeoutMs: 20 });
  const pending = runInWorker('pipeline', {}, options);
  workers[0].reply({ value: 'first' });
  assert.equal(await pending, 'first');
  workers[0].reply({ error: 'late' });
  workers[0].onerror(new Event('error'));
  await sleep(40);
  assert.equal(workers[0].terminated, 1, 'terminated once: neither the timer nor late events fire again');
});

test('every run gets its own worker', async () => {
  const { workers, options } = setup();
  const first = runInWorker('pipeline', {}, options);
  const second = runInWorker('expression', {}, options);
  assert.equal(workers.length, 2);
  workers[1].reply({ value: 2 });
  workers[0].reply({ value: 1 });
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
});

test('the real worker script understands the request the wrapper sends and reports errors as messages', async () => {
  const posted = [];
  globalThis.self = { postMessage: (message) => posted.push(message) };
  try {
    await import('../src/execution.worker.js');
    const { workers, options } = setup();
    const pending = runInWorker(
      'expression',
      { data: { a: [1, 2] }, expression: '$.a[*]', kind: 'jsonpath', context: {} },
      options,
    );
    globalThis.self.onmessage({ data: workers[0].posted[0] });
    workers[0].reply(posted[0]);
    assert.deepEqual(await pending, [1, 2]);

    globalThis.self.onmessage({ data: { kind: 'pipeline', payload: JSON.stringify({ mode: 'bogus', data: {} }) } });
    assert.equal(typeof posted[1].error, 'string');
    globalThis.self.onmessage({ data: { kind: 'unknown', payload: '{}' } });
    assert.match(posted[2].error, /Unknown execution request/);
  } finally {
    delete globalThis.self;
  }
});
