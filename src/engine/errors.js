// Structured evaluation errors. `entity.error` stays the plain string the UI has always shown;
// `IpsError` carries the same text plus the machine-readable parts of `entity.errorDetail`.

export const errorCodes = [
  'MISSING_SOURCE',
  'UNSUPPORTED',
  'INVALID_CONFIG',
  'FUNCTION_ERROR',
  'MISSING_CONTEXT',
  'CONDITION_ERROR',
  'PATH_ERROR',
  'ENTITY_INVALID',
  'LIMIT',
];

const LIMIT_MESSAGE = 'Input or transformation is nested too deeply to process';

export class IpsError extends Error {
  constructor(code, message, location = {}) {
    super(message);
    this.name = 'IpsError';
    this.code = code;
    this.stage = location.stage ?? null;
    this.mappingIndex = location.mappingIndex ?? null;
    this.function = location.function ?? null;
  }

  // The text exposed as `entity.error`: mapping failures are prefixed with their location.
  get text() {
    if (this.stage === null || this.mappingIndex === null) return this.message;
    return `${this.stage} mapping ${this.mappingIndex + 1}: ${this.message}`;
  }

  get detail() {
    return {
      stage: this.stage,
      mappingIndex: this.mappingIndex,
      function: this.function,
      code: this.code,
      message: this.message,
    };
  }
}

export function failWith(code, message) {
  throw new IpsError(code, message);
}

// Turns anything thrown into an IpsError. `fallbackCode` is the call site's classification for
// errors raised by modules that do not use IpsError (plain `Error` from the JSONPath evaluator,
// the condition parser and the function library).
export function classify(error, fallbackCode) {
  if (error instanceof IpsError) return error;
  if (error instanceof RangeError && /call stack/i.test(error.message)) return new IpsError('LIMIT', LIMIT_MESSAGE);

  const message = error instanceof Error ? error.message : String(error);
  if (errorCodes.includes(error?.code)) return new IpsError(error.code, message);
  // Missing context is raised from many call sites (paths, conditions, function arguments).
  if (/^Missing context (variable|property)/.test(message)) return new IpsError('MISSING_CONTEXT', message);
  return new IpsError(fallbackCode, message);
}

// Runs `action`, classifying any failure under `code` (unless it is already classified).
export function within(code, action) {
  try {
    return action();
  } catch (error) {
    throw classify(error, code);
  }
}
