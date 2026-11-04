const isObject = (value) => value !== null && typeof value === 'object';

export function sameValue(a, b) {
  if (a === b) return true;
  if (!isObject(a) || !isObject(b) || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]))
  );
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const childPath = (path, key) => (IDENTIFIER.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`);

/** Leaf-level differences between two JSON values; arrays and type changes are compared as whole values. */
export function changes(before, after, path = '$') {
  if (sameValue(before, after)) return [];
  if (isObject(before) && isObject(after) && !Array.isArray(before) && !Array.isArray(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((key) =>
      changes(before[key], after[key], childPath(path, key)),
    );
  }
  return [{ path, before, after, kind: before === undefined ? 'Added' : after === undefined ? 'Removed' : 'Changed' }];
}

export const finalOutput = (entity) => entity.output ?? entity.targetOutput ?? entity.sourceOutput;

/** Stage pairs the Changes tab can compare; a stage selector only makes sense when both outputs exist. */
export function stageComparisons(entity) {
  if (!entity) return [];
  const final = { id: 'final', label: 'Input → Final output', before: entity.input, after: finalOutput(entity) };
  if (entity.sourceOutput === undefined || entity.targetOutput === undefined) return [final];
  return [
    { id: 'source', label: 'Input → Source output', before: entity.input, after: entity.sourceOutput },
    { id: 'target', label: 'Source output → Target output', before: entity.sourceOutput, after: entity.targetOutput },
    final,
  ];
}

const STAGE_PREFIX = /^(source|target) mapping (\d+): ([\s\S]*)$/;

/** Message plus the stage/mapping that failed, taken from the error trace step or the engine's message prefix. */
export function describeFailure(entity) {
  const raw = entity?.error;
  if (raw === undefined || raw === null || raw === false) return null;
  const text = typeof raw === 'string' ? raw : (raw.message ?? JSON.stringify(raw, null, 2));
  const step = [...(entity.trace ?? [])].reverse().find((item) => item.status === 'error');
  const prefixed = STAGE_PREFIX.exec(text);
  const stage = step?.stage ?? prefixed?.[1] ?? null;
  const mapping = step?.mapping !== undefined ? step.mapping + 1 : prefixed ? Number(prefixed[2]) : null;
  return { stage, mapping, message: prefixed ? prefixed[3] : text, path: step?.sourcePath ?? null };
}

export function entityLabel(entity) {
  const candidates = [entity.input?.userName, entity.input?.displayName, entity.input?.id];
  const label = candidates.find((value) => typeof value === 'string' || typeof value === 'number');
  return label === undefined ? 'JSON entity' : String(label);
}

const MISSING_VARIABLE = /^Missing context variable: (.+?)\. Supply it under /;
const MISSING_OPERATION = /^Mapping scope requires context\.operation/;

/** What the entities of a finished run could not find in the Runtime context: variable names and/or `operation`. */
export function missingContext(result) {
  const variables = new Set();
  let operation = false;
  for (const entity of result?.entities ?? []) {
    if (entity?.errorDetail?.code !== 'MISSING_CONTEXT') continue;
    const message = entity.errorDetail.message ?? '';
    const name = MISSING_VARIABLE.exec(message)?.[1];
    if (name) variables.add(name);
    else if (MISSING_OPERATION.test(message)) operation = true;
  }
  return { variables: [...variables], operation };
}

export const CONTEXT_PLACEHOLDER = 'REPLACE_WITH_VALUE';

/**
 * The runtime-context text with `variables.<name>` (and `operation`, when asked) present, so the user only has to
 * type the values. Anything already there is left as it is. Returns null when the text is not a JSON object (or
 * `variables` is not one), so the caller leaves it for the editor to report instead of overwriting the user's text.
 */
export function contextWithMissing(text, { variables, operation }) {
  let context;
  try {
    context = JSON.parse(text);
  } catch {
    return null;
  }
  const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!plain(context) || (context.variables !== undefined && !plain(context.variables))) return null;
  const absent = variables.filter((name) => !(context.variables && Object.hasOwn(context.variables, name)));
  const needsOperation = operation && context.operation === undefined;
  if (absent.length === 0 && !needsOperation) return text;
  const next = { ...context };
  if (absent.length > 0) {
    next.variables = { ...context.variables, ...Object.fromEntries(absent.map((name) => [name, CONTEXT_PLACEHOLDER])) };
  }
  if (needsOperation) next.operation = CONTEXT_PLACEHOLDER;
  return JSON.stringify(next, null, 2);
}
