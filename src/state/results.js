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

/** Name of the context variable a failed entity could not find, or null when it failed for another reason. */
export function missingVariableName(entity) {
  if (entity?.errorDetail?.code !== 'MISSING_CONTEXT') return null;
  return MISSING_VARIABLE.exec(entity.errorDetail.message ?? '')?.[1] ?? null;
}

/** Distinct context variables the entities of a finished run could not find. */
export function missingVariableNames(result) {
  return [...new Set((result?.entities ?? []).map(missingVariableName).filter(Boolean))];
}

export const VARIABLE_PLACEHOLDER = 'REPLACE_WITH_VALUE';

/**
 * The runtime-context text with `variables.<name>` present for every name, so the user only has to type the values.
 * A variable that is already there is left as it is. Returns null when the text is not a JSON object (or `variables`
 * is not one), so the caller leaves it for the editor to report instead of overwriting the user's text.
 */
export function contextWithVariables(text, names) {
  let context;
  try {
    context = JSON.parse(text);
  } catch {
    return null;
  }
  const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!plain(context) || (context.variables !== undefined && !plain(context.variables))) return null;
  const absent = names.filter((name) => !(context.variables && Object.hasOwn(context.variables, name)));
  if (absent.length === 0) return text;
  const variables = { ...context.variables };
  for (const name of absent) variables[name] = VARIABLE_PLACEHOLDER;
  return JSON.stringify({ ...context, variables }, null, 2);
}
