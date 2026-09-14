/**
 * A 150-line request validator, so the API never trusts a body.
 *
 * Zod would be nicer, but it is another install that can fail on demo day and
 * this covers everything the API actually needs: types, ranges, enums,
 * required-ness, and — the part that matters for a system handling free-text
 * welfare notes — length caps and control-character stripping on every string.
 */

export type Rule =
  | { type: 'string'; min?: number; max?: number; pattern?: RegExp; optional?: boolean; trim?: boolean }
  | { type: 'number'; min?: number; max?: number; int?: boolean; optional?: boolean }
  | { type: 'boolean'; optional?: boolean }
  | { type: 'enum'; values: readonly string[]; optional?: boolean }
  | { type: 'array'; of: Rule; max?: number; optional?: boolean }
  | { type: 'object'; shape: Schema; optional?: boolean };

export type Schema = Record<string, Rule>;

export class ValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Validation failed: ${issues.join('; ')}`);
    this.name = 'ValidationError';
  }
}

// Strip C0/C1 control characters but keep tab, newline and carriage return,
// which are legitimate inside a welfare note.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

function checkValue(path: string, value: unknown, rule: Rule, issues: string[]): unknown {
  if (value === undefined || value === null || value === '') {
    if (rule.optional) return undefined;
    issues.push(`${path} is required`);
    return undefined;
  }

  switch (rule.type) {
    case 'string': {
      if (typeof value !== 'string') {
        issues.push(`${path} must be a string`);
        return undefined;
      }
      let v = value.replace(CONTROL_CHARS, '');
      if (rule.trim !== false) v = v.trim();
      if (rule.min !== undefined && v.length < rule.min) issues.push(`${path} must be at least ${rule.min} characters`);
      if (rule.max !== undefined && v.length > rule.max) issues.push(`${path} must be at most ${rule.max} characters`);
      if (rule.pattern && !rule.pattern.test(v)) issues.push(`${path} has an invalid format`);
      return v;
    }
    case 'number': {
      const n = typeof value === 'string' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isFinite(n)) {
        issues.push(`${path} must be a number`);
        return undefined;
      }
      if (rule.int && !Number.isInteger(n)) issues.push(`${path} must be a whole number`);
      if (rule.min !== undefined && n < rule.min) issues.push(`${path} must be at least ${rule.min}`);
      if (rule.max !== undefined && n > rule.max) issues.push(`${path} must be at most ${rule.max}`);
      return n;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (value === 'true') return true;
      if (value === 'false') return false;
      issues.push(`${path} must be a boolean`);
      return undefined;
    }
    case 'enum': {
      if (typeof value !== 'string' || !rule.values.includes(value)) {
        issues.push(`${path} must be one of: ${rule.values.join(', ')}`);
        return undefined;
      }
      return value;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        issues.push(`${path} must be an array`);
        return undefined;
      }
      if (rule.max !== undefined && value.length > rule.max) {
        issues.push(`${path} may contain at most ${rule.max} items`);
        return undefined;
      }
      return value.map((item, i) => checkValue(`${path}[${i}]`, item, rule.of, issues));
    }
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) {
        issues.push(`${path} must be an object`);
        return undefined;
      }
      return validateShape(value as Record<string, unknown>, rule.shape, issues, `${path}.`);
    }
  }
}

function validateShape(
  input: Record<string, unknown>,
  schema: Schema,
  issues: string[],
  prefix = '',
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, rule] of Object.entries(schema)) {
    const parsed = checkValue(`${prefix}${key}`, input?.[key], rule, issues);
    if (parsed !== undefined) out[key] = parsed;
  }
  return out;
}

/** Parse and sanitise; throws ValidationError listing every problem at once. */
export function parse<T = Record<string, unknown>>(input: unknown, schema: Schema): T {
  const issues: string[] = [];
  const value = validateShape((input ?? {}) as Record<string, unknown>, schema, issues);
  if (issues.length) throw new ValidationError(issues);
  return value as T;
}
