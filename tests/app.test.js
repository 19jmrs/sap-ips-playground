import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { examples, pretty } from '../src/examples.js';
import { runPipeline } from '../src/engine/index.js';
import {
  CASE_SCHEMA_VERSION,
  MAX_CASE_FILE_BYTES,
  caseErrorMessage,
  parseCaseFile,
  serializeCase,
} from '../src/state/caseFile.js';
import { parseInline, parseMarkdown, safeHref } from '../src/state/markdown.js';
import { changes, describeFailure, entityLabel, stageComparisons } from '../src/state/results.js';
import { pipelineRequest } from '../src/state/requests.js';
import { SESSION_KEY, createSessionStore, restoreSnapshot, snapshotForStorage } from '../src/state/session.js';
import { blankState, initialState, isRunning, reducer } from '../src/state/workspace.js';

const apply = (state, ...actions) => actions.reduce(reducer, state);

function exportedCase(overrides = {}) {
  return { ...serializeCase(initialState()), ...overrides };
}

// ---- case export / import -------------------------------------------------------------------------------------

test('an exported case imports back to the same workspace without running anything', () => {
  const original = initialState();
  const file = pretty(serializeCase(original));
  const parsed = parseCaseFile(file);
  assert.equal(parsed.ok, true);
  assert.equal(JSON.parse(file).schemaVersion, CASE_SCHEMA_VERSION);

  const loaded = apply(blankState(), { type: 'loadCase', case: parsed.case, message: 'loaded' });
  for (const field of ['data', 'source', 'target', 'context']) {
    assert.deepEqual(JSON.parse(loaded[field]), JSON.parse(original[field]), field);
  }
  for (const field of ['mode', 'entityPath', 'entityType', 'debug'])
    assert.equal(loaded[field], original[field], field);
  assert.equal(loaded.result, null);
  assert.equal(isRunning(loaded), false);
  assert.equal(loaded.example, '');
});

test('files exported before schemaVersion existed are accepted as version 1', () => {
  const { schemaVersion, ...legacy } = exportedCase();
  assert.equal(schemaVersion, 1);
  const parsed = parseCaseFile(JSON.stringify(legacy));
  assert.equal(parsed.ok, true);
  assert.equal(Object.hasOwn(parsed.case, 'schemaVersion'), false);
});

test('every shipped example survives export and import, including a role entity type', () => {
  for (const item of examples) {
    const state = reducer(blankState(), { type: 'loadExample', id: item.id });
    const parsed = parseCaseFile(JSON.stringify({ ...serializeCase(state), entityType: 'role' }));
    assert.equal(parsed.ok, true, item.id);
    assert.deepEqual(parsed.case.data, item.data, item.id);
    assert.equal(parsed.case.entityType, 'role');
  }
});

test('invalid case files are rejected with specific messages and nothing is returned', () => {
  const cases = [
    ['not json {', /not valid JSON/],
    ['[]', /must be a JSON object, found an array/],
    ['null', /found null/],
    [JSON.stringify(exportedCase({ extra: 1 })), /Unknown field "extra"/],
    [JSON.stringify(exportedCase({ mode: 'both' })), /Field "mode" must be one of source, target, chain/],
    [JSON.stringify(exportedCase({ entityType: 'admin' })), /Field "entityType" must be one of user, group, role/],
    [JSON.stringify(exportedCase({ debug: 'yes' })), /Field "debug" must be true or false/],
    [JSON.stringify(exportedCase({ source: [] })), /Field "source" must be a JSON object, found an array/],
    [JSON.stringify(exportedCase({ context: null })), /Field "context" must be a JSON object, found null/],
    [JSON.stringify(exportedCase({ entityPath: 5 })), /Field "entityPath" must be a string/],
    [JSON.stringify(exportedCase({ schemaVersion: 2 })), /newer than this playground supports/],
    [JSON.stringify(exportedCase({ schemaVersion: '1' })), /schemaVersion must be a positive integer/],
    ['x'.repeat(MAX_CASE_FILE_BYTES + 1), /larger than/],
  ];
  for (const [text, expected] of cases) {
    const parsed = parseCaseFile(text);
    assert.equal(parsed.ok, false, text.slice(0, 40));
    assert.match(parsed.errors.join(' '), expected);
    assert.equal(parsed.case, undefined);
  }
});

test('a file missing fields reports each missing field and a long list is summarised', () => {
  const parsed = parseCaseFile(JSON.stringify({ data: {} }));
  assert.equal(parsed.ok, false);
  for (const field of ['source', 'target', 'mode', 'entityPath', 'entityType', 'context', 'debug']) {
    assert.ok(parsed.errors.includes(`Missing field "${field}".`), field);
  }
  const message = caseErrorMessage(parsed.errors);
  assert.match(message, /^Case not imported\./);
  assert.match(message, /\+3 more problems/);
});

test('a byte-order mark does not stop a case file from loading', () => {
  assert.equal(parseCaseFile('\uFEFF' + JSON.stringify(exportedCase())).ok, true);
});

test('exporting names the document that is not valid JSON', () => {
  const broken = { ...initialState(), target: '{ nope' };
  assert.throws(() => serializeCase(broken), /^Error: Target transformation: /);
});

test('run requests only require the transformation documents the mode uses', () => {
  const state = { ...initialState(), source: '{ nope', mode: 'target' };
  const request = pipelineRequest(state);
  assert.equal(request.source, undefined);
  assert.ok(request.target);
  assert.throws(() => pipelineRequest({ ...state, mode: 'chain' }), /Source transformation: /);
});

// ---- workspace reducer ----------------------------------------------------------------------------------------

test('editing an input marks existing results stale; setting an identical value does not', () => {
  const finished = apply(
    initialState(),
    { type: 'runStarted', kind: 'transformation' },
    { type: 'transformationFinished', result: { entities: [], summary: {} } },
  );
  assert.equal(finished.stale, false);
  assert.equal(reducer(finished, { type: 'edit', field: 'source', value: finished.source }), finished);
  const edited = reducer(finished, { type: 'edit', field: 'source', value: '{}' });
  assert.equal(edited.stale, true);
  assert.notEqual(edited.revision, finished.revision);
});

test('a run that finishes after an edit is stale; one that finishes untouched is current', () => {
  const started = reducer(initialState(), { type: 'runStarted', kind: 'transformation' });
  const result = { entities: [], summary: {} };
  const edited = apply(started, { type: 'edit', field: 'data', value: '{"changed":true}' });
  assert.equal(reducer(edited, { type: 'transformationFinished', result }).stale, true);
  assert.equal(reducer(started, { type: 'transformationFinished', result }).stale, false);
});

test('results keep the mode and debug setting they were produced with, not the ones edited mid-run', () => {
  const started = reducer(
    { ...initialState(), mode: 'source', debug: true },
    { type: 'runStarted', kind: 'transformation' },
  );
  const edited = apply(
    started,
    { type: 'edit', field: 'mode', value: 'target' },
    { type: 'edit', field: 'debug', value: false },
  );
  const done = reducer(edited, { type: 'transformationFinished', result: { entities: [], summary: {} } });
  assert.equal(done.resultMode, 'source');
  assert.equal(done.resultDebug, true);
});

test('expression edits do not invalidate transformation results and vice versa', () => {
  const state = initialState();
  const expressionEdit = reducer(state, { type: 'edit', field: 'expression', value: '$.x' });
  assert.equal(expressionEdit.stale, false);
  assert.equal(expressionEdit.expressionStale, true);
  const sourceEdit = reducer(state, { type: 'edit', field: 'source', value: '{}' });
  assert.equal(sourceEdit.stale, true);
  assert.equal(sourceEdit.expressionStale, false);
  const sharedEdit = reducer(state, { type: 'edit', field: 'data', value: '{}' });
  assert.equal(sharedEdit.stale && sharedEdit.expressionStale, true);
});

test('an expression run that finishes after an edit is stale', () => {
  const started = reducer(initialState(), { type: 'runStarted', kind: 'expression' });
  const edited = reducer(started, { type: 'edit', field: 'expression', value: '$.other' });
  const done = reducer(edited, { type: 'expressionFinished', value: [1] });
  assert.equal(done.expressionStale, true);
  assert.deepEqual(done.expressionResult, [1]);
  assert.equal(isRunning(done), false);
});

test('only one run is pending at a time and results for the wrong run kind are ignored', () => {
  const started = reducer(initialState(), { type: 'runStarted', kind: 'transformation' });
  assert.equal(reducer(started, { type: 'runStarted', kind: 'expression' }), started);
  assert.equal(reducer(started, { type: 'expressionFinished', value: 1 }), started);
  assert.equal(reducer(initialState(), { type: 'transformationFinished', result: {} }).result, null);
});

test('a failed run keeps the previous result and reports the error', () => {
  const result = { entities: [], summary: {} };
  const previous = apply(
    initialState(),
    { type: 'runStarted', kind: 'transformation' },
    { type: 'transformationFinished', result },
    { type: 'runStarted', kind: 'transformation' },
    { type: 'transformationFailed', message: 'boom' },
  );
  assert.equal(previous.result, result);
  assert.equal(previous.notice.tone, 'error');
  assert.equal(previous.notice.message, 'boom');
  assert.equal(isRunning(previous), false);
});

test('a failed expression run clears the previous value and records that it ran', () => {
  const state = apply(
    initialState(),
    { type: 'runStarted', kind: 'expression' },
    { type: 'expressionFinished', value: 'ok' },
    { type: 'runStarted', kind: 'expression' },
    { type: 'expressionFailed', message: 'bad path' },
  );
  assert.equal(state.expressionResult, undefined);
  assert.equal(state.expressionError, 'bad path');
  assert.equal(state.expressionHasRun, true);
});

test('loading an example or case never runs: it only marks results stale and clears errors', () => {
  const base = apply(
    initialState(),
    { type: 'runStarted', kind: 'transformation' },
    { type: 'transformationFinished', result: { entities: [], summary: {} } },
    { type: 'notice', notice: { tone: 'error', title: 't', message: 'm' } },
  );
  const example = reducer(base, { type: 'loadExample', id: 'group' });
  assert.equal(example.example, 'group');
  assert.equal(example.entityPath, '$');
  assert.equal(example.stale, true);
  assert.equal(example.expressionStale, true);
  assert.equal(example.notice, null);
  assert.equal(isRunning(example), false);
  assert.equal(example.result, base.result);
  assert.equal(reducer(base, { type: 'loadExample', id: 'missing' }), base);
});

test('the import notice disappears on the next edit', () => {
  const parsed = parseCaseFile(JSON.stringify(exportedCase()));
  const imported = reducer(initialState(), { type: 'loadCase', case: parsed.case, message: 'x' });
  assert.equal(imported.notice.tone, 'info');
  assert.equal(reducer(imported, { type: 'edit', field: 'data', value: '{}' }).notice, null);
});

test('switching the expression kind replaces the expression with that kind’s starter and marks it stale', () => {
  const state = reducer(initialState(), { type: 'setExpressionKind', kind: 'condition' });
  assert.equal(state.expressionKind, 'condition');
  assert.match(state.expression, /==/);
  assert.equal(state.expressionStale, true);
  assert.equal(state.stale, false);
});

test('Clear resets every input and result, keeps the open workspace and turns recovery off', () => {
  const used = apply(
    initialState(),
    { type: 'setWorkspace', workspace: 'expressions' },
    { type: 'setKeepOnReload', value: true },
    { type: 'storageStatus', note: 'full' },
    { type: 'runStarted', kind: 'transformation' },
    { type: 'transformationFinished', result: { entities: [], summary: {} } },
    { type: 'runStarted', kind: 'expression' },
    { type: 'expressionFinished', value: 1 },
  );
  const cleared = reducer(used, { type: 'clear' });
  assert.deepEqual(cleared, blankState('expressions'));
  assert.equal(cleared.keepOnReload, false);
  assert.equal(cleared.storageNote, null);
  assert.equal(cleared.result, null);
  assert.equal(cleared.data, '{}');
});

test('Clear is ignored while a run is in progress', () => {
  const running = reducer(initialState(), { type: 'runStarted', kind: 'transformation' });
  assert.equal(reducer(running, { type: 'clear' }), running);
});

// ---- session recovery -----------------------------------------------------------------------------------------

function fakeStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
  };
}

test('stored snapshots hold editor inputs only, never results or errors', () => {
  const withResult = apply(
    initialState(),
    { type: 'runStarted', kind: 'transformation' },
    { type: 'transformationFinished', result: { entities: [{ secret: 'RESULT-MARKER' }], summary: {} } },
    { type: 'runStarted', kind: 'expression' },
    { type: 'expressionFinished', value: 'EXPRESSION-MARKER' },
    { type: 'notice', notice: { tone: 'error', title: 't', message: 'ERROR-MARKER' } },
  );
  const stored = JSON.stringify(snapshotForStorage(withResult));
  for (const marker of ['RESULT-MARKER', 'EXPRESSION-MARKER', 'ERROR-MARKER'])
    assert.equal(stored.includes(marker), false);
});

test('a stored session restores the workspace inputs and switches recovery on', () => {
  const storage = fakeStorage();
  const store = createSessionStore(() => storage);
  const edited = apply(
    initialState(),
    { type: 'edit', field: 'data', value: '{"fictional":true}' },
    { type: 'edit', field: 'entityType', value: 'role' },
    { type: 'setWorkspace', workspace: 'expressions' },
  );
  assert.equal(store.write(edited), true);
  const restored = initialState(store.read());
  assert.equal(restored.data, '{"fictional":true}');
  assert.equal(restored.entityType, 'role');
  assert.equal(restored.workspace, 'expressions');
  assert.equal(restored.keepOnReload, true);
  assert.equal(restored.result, null);
  assert.equal(store.clear(), true);
  assert.equal(store.read(), null);
  assert.equal(initialState(store.read()).keepOnReload, false);
});

test('unusable stored values are ignored instead of loaded', () => {
  const valid = snapshotForStorage(initialState());
  const bad = [
    'not json',
    JSON.stringify({ ...valid, version: 99 }),
    JSON.stringify({ ...valid, mode: 'nope' }),
    JSON.stringify({ ...valid, data: 5 }),
    JSON.stringify({ ...valid, workspace: 'admin' }),
    'null',
  ];
  for (const text of bad) assert.equal(restoreSnapshot(text), null, text.slice(0, 30));
  const storage = fakeStorage({ [SESSION_KEY]: bad[2] });
  assert.equal(createSessionStore(() => storage).read(), null);
});

test('storage failures never throw and report that the work is memory-only', () => {
  const full = {
    ...fakeStorage(),
    setItem: () => {
      throw new DOMException('quota', 'QuotaExceededError');
    },
  };
  assert.equal(createSessionStore(() => full).write(initialState()), false);
  const blocked = createSessionStore(() => {
    throw new Error('SecurityError');
  });
  assert.equal(blocked.write(initialState()), false);
  assert.equal(blocked.read(), null);
  assert.equal(blocked.clear(), false);
  assert.equal(createSessionStore(() => undefined).read(), null);
});

// ---- result helpers -------------------------------------------------------------------------------------------

test('changes reports added, removed and changed leaves and treats arrays as whole values', () => {
  const delta = changes(
    { keep: 1, gone: 2, name: { given: 'A' }, tags: ['a'], 'odd key': 1 },
    { keep: 1, added: true, name: { given: 'B' }, tags: ['a', 'b'], 'odd key': 2 },
  );
  assert.deepEqual(
    delta.map(({ path, kind }) => [path, kind]),
    [
      ['$.gone', 'Removed'],
      ['$.name.given', 'Changed'],
      ['$.tags', 'Changed'],
      ['$["odd key"]', 'Changed'],
      ['$.added', 'Added'],
    ],
  );
  assert.deepEqual(changes({ a: 1, b: 2 }, { b: 2, a: 1 }), []);
});

test('stage comparisons offer a selector only when both stage outputs exist', () => {
  const chained = { input: { a: 1 }, sourceOutput: { b: 1 }, targetOutput: { c: 1 }, output: { c: 1 } };
  const options = stageComparisons(chained);
  assert.deepEqual(
    options.map((item) => item.id),
    ['source', 'target', 'final'],
  );
  assert.deepEqual(options[1].before, { b: 1 });
  assert.deepEqual(options[1].after, { c: 1 });
  assert.deepEqual(options[2].before, { a: 1 });
  assert.equal(stageComparisons({ input: { a: 1 }, sourceOutput: { b: 1 }, output: { b: 1 } }).length, 1);
  assert.equal(stageComparisons({ input: {}, targetOutput: { b: 1 } })[0].after.b, 1);
  assert.deepEqual(stageComparisons(undefined), []);
});

test('a failed entity names the stage and mapping that failed, from the engine’s real trace', () => {
  const errors = examples.find((item) => item.id === 'errors');
  const { entities } = runPipeline({ ...errors, debug: false });
  const failure = describeFailure(entities.find((entity) => entity.error));
  assert.equal(failure.stage, 'source');
  assert.equal(failure.mapping, 2);
  assert.match(failure.message, /Required source value missing/);
  assert.doesNotMatch(failure.message, /^source mapping/);
  assert.equal(describeFailure(entities[0]), null);
});

test('failure details fall back to the message prefix and tolerate structured errors', () => {
  assert.deepEqual(describeFailure({ error: 'target mapping 4: nope' }), {
    stage: 'target',
    mapping: 4,
    message: 'nope',
    path: null,
  });
  assert.equal(describeFailure({ error: { message: 'plain' } }).message, 'plain');
  assert.equal(describeFailure({ error: 'unrelated failure' }).stage, null);
});

test('entity labels never render objects', () => {
  assert.equal(entityLabel({ input: { userName: { x: 1 }, id: 7 } }), '7');
  assert.equal(entityLabel({ input: 'text' }), 'JSON entity');
  assert.equal(entityLabel({ input: null }), 'JSON entity');
});

// ---- markdown renderer ----------------------------------------------------------------------------------------

function walk(nodes, visit) {
  for (const node of nodes) {
    visit(node);
    if (node.children) walk(node.children, visit);
    if (node.items) node.items.forEach((item) => walk(item, visit));
    if (node.header)
      walk(
        node.header.flatMap((cell) => cell.children),
        visit,
      );
    if (node.rows) node.rows.flat().forEach((cell) => walk(cell.children, visit));
  }
}

test('markdown blocks: headings, lists, fenced code, tables with escaped pipes', () => {
  const blocks = parseMarkdown(
    [
      '# Title',
      '',
      'Intro with `code` and **bold**.',
      '',
      '- one',
      '- two',
      '',
      '1. first',
      '',
      '```json',
      '{"a": 1}',
      '```',
      '',
      '| A | B |',
      '| --- | :-: |',
      '| `x \\| y` | 2 |',
      '| only |',
    ].join('\n'),
  );
  assert.deepEqual(
    blocks.map((block) => block.type),
    ['heading', 'paragraph', 'list', 'list', 'code', 'table'],
  );
  assert.equal(blocks[0].level, 1);
  assert.equal(blocks[2].ordered, false);
  assert.equal(blocks[3].ordered, true);
  assert.equal(blocks[4].text, '{"a": 1}');
  const table = blocks[5];
  assert.equal(table.header.length, 2);
  assert.equal(table.header[1].align, 'center');
  assert.equal(table.rows[0][0].children[0].text, 'x | y');
  assert.equal(table.rows[1].length, 2, 'short rows are padded to the header width');
});

test('markdown links keep only http(s) destinations; everything else becomes plain text', () => {
  assert.equal(safeHref('https://help.sap.com/docs?a=1'), 'https://help.sap.com/docs?a=1');
  for (const href of [
    'javascript:alert(1)',
    ' JaVaScRiPt:alert(1)',
    'data:text/html,<b>',
    'vbscript:x',
    '//evil.test',
    'coverage.md',
    '',
  ]) {
    assert.equal(safeHref(href), null, href);
  }
  const [link] = parseInline('[SAP](https://help.sap.com/x)');
  assert.deepEqual(link, { type: 'link', href: 'https://help.sap.com/x', children: [{ type: 'text', text: 'SAP' }] });
  const unsafe = parseInline('[click](javascript:alert(1))');
  assert.deepEqual(unsafe, [{ type: 'text', text: 'click' }]);
});

test('raw HTML and hostile input only ever produce text, code and http(s) links', () => {
  const hostile = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '[a](javascript:alert(1)) [b](data:text/html;base64,AAAA) ![img](http://x/y.png)',
    '[[nested](https://a.test)](https://b.test)',
    '**unclosed *emphasis `code [link](',
    '```\nunclosed fence <b>',
    '| a |\n| --- |\n| <iframe src="javascript:1"> |',
    '> <svg onload=alert(1)>',
  ].join('\n\n');
  const allowed = new Set(['text', 'code', 'strong', 'em', 'link']);
  const hrefs = [];
  walk(parseMarkdown(hostile), (node) => {
    if (node.type === 'link') hrefs.push(node.href);
  });
  for (const href of hrefs) assert.match(href, /^https?:\/\//);
  const inline = parseInline('<b onclick=x>hi</b> **bold <i>x</i>**');
  walk(inline, (node) => assert.ok(allowed.has(node.type), node.type));
  assert.equal(inline[0].text, '<b onclick=x>hi</b> ', 'angle brackets stay literal text');
});

test('the bundled docs parse into tables whose rows all match their header width, with only safe links', () => {
  for (const file of ['coverage.md', 'ips-inventory.md', 'architecture.md']) {
    const blocks = parseMarkdown(readFileSync(new URL(`../docs/${file}`, import.meta.url), 'utf8'));
    assert.ok(
      blocks.some((block) => block.type === 'heading'),
      file,
    );
    for (const table of blocks.filter((block) => block.type === 'table')) {
      assert.ok(table.rows.length > 0, file);
      for (const row of table.rows) assert.equal(row.length, table.header.length, file);
    }
    walk(blocks, (node) => {
      if (node.type === 'link') assert.match(node.href, /^https?:\/\//, file);
    });
  }
  const coverage = parseMarkdown(readFileSync(new URL('../docs/coverage.md', import.meta.url), 'utf8'));
  const escaped = coverage
    .filter((block) => block.type === 'table')
    .flatMap((table) => table.rows)
    .find((row) => row[0].children[0]?.text?.startsWith('&&'));
  assert.ok(escaped, 'the "&& / || / !" row keeps its escaped pipes inside one cell');
});
