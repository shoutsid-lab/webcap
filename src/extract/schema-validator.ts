/**
 * Deterministic schema-subset validator + span grounding for extract output.
 *
 * Pure sync, node-only: no model calls, no I/O. Used to check model-produced
 * JSON against the caller-supplied schema subset and to verify that quoted
 * spans are verbatim substrings of the cited markdown page.
 */
import { unprocessable } from '../util/errors.js';

const UNSUPPORTED_KEYWORDS = ['oneOf', 'anyOf', 'allOf', '$ref', 'format'] as const;

export interface Span {
  readonly field: string;
  readonly quote: string;
  readonly page: number;
}

type Schema = Record<string, unknown>;

/**
 * Validate a value against a schema subset. Returns $-rooted error strings
 * (empty when valid). Throws 422 on unsupported schema keywords.
 */
export function validateAgainstSchema(value: unknown, schema: unknown): string[] {
  const errors: string[] = [];
  validateNode(value, schema, '$', errors);
  return errors;
}

function validateNode(value: unknown, schema: unknown, path: string, errors: string[]): void {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return;
  const node = schema as Schema;
  for (const key of UNSUPPORTED_KEYWORDS) {
    if (node[key] !== undefined) {
      throw unprocessable(`unsupported schema keyword: ${key} at ${path}`);
    }
  }

  if (node['enum'] !== undefined) {
    const allowed = node['enum'];
    if (Array.isArray(allowed) && !allowed.some((option) => deepEqual(value, option))) {
      errors.push(`${path}: value is not one of the allowed enum values`);
    }
  }

  const type = node['type'];
  if (typeof type === 'string') {
    validateTyped(value, node, type, path, errors);
  } else if (Array.isArray(type)) {
    validateUnionType(value, node, type, path, errors);
  } else {
    validateConstraints(value, node, undefined, path, errors);
    validateObjectShape(value, node, path, errors);
    validateArrayShape(value, node, path, errors);
  }
}

function validateUnionType(
  value: unknown,
  node: Schema,
  types: unknown[],
  path: string,
  errors: string[],
): void {
  const names = types.filter((t): t is string => typeof t === 'string');
  if (names.some((name) => matchesType(value, name))) {
    const matched = names.find((name) => matchesType(value, name)) as string;
    validateConstraints(value, node, matched, path, errors);
    return;
  }
  errors.push(`${path}: expected ${names.join(' | ')}, got ${describeValue(value)}`);
}

function validateTyped(value: unknown, node: Schema, type: string, path: string, errors: string[]): void {
  if (!matchesType(value, type)) {
    errors.push(`${path}: expected ${type}, got ${describeValue(value)}`);
    return;
  }
  validateConstraints(value, node, type, path, errors);
  if (type === 'object') validateObjectShape(value, node, path, errors);
  if (type === 'array') validateArrayShape(value, node, path, errors);
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return true;
  }
}

function validateConstraints(
  value: unknown,
  node: Schema,
  type: string | undefined,
  path: string,
  errors: string[],
): void {
  if (typeof value === 'string') {
    const minLength = node['minLength'];
    if (typeof minLength === 'number' && value.length < minLength) {
      errors.push(`${path}: string shorter than minLength ${minLength}`);
    }
    const maxLength = node['maxLength'];
    if (typeof maxLength === 'number' && value.length > maxLength) {
      errors.push(`${path}: string longer than maxLength ${maxLength}`);
    }
    const pattern = node['pattern'];
    if (typeof pattern === 'string') {
      let re: RegExp;
      try {
        re = new RegExp(pattern);
      } catch {
        errors.push(`${path}: invalid pattern ${pattern}`);
        return;
      }
      if (!re.test(value)) errors.push(`${path}: string does not match pattern ${pattern}`);
    }
  }
  if (typeof value === 'number' && !Number.isNaN(value) && (type === 'number' || type === 'integer' || type === undefined)) {
    const minimum = node['minimum'];
    if (typeof minimum === 'number' && value < minimum) {
      errors.push(`${path}: number ${value} below minimum ${minimum}`);
    }
    const maximum = node['maximum'];
    if (typeof maximum === 'number' && value > maximum) {
      errors.push(`${path}: number ${value} above maximum ${maximum}`);
    }
  }
}

function validateObjectShape(value: unknown, node: Schema, path: string, errors: string[]): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  const required = node['required'];
  if (Array.isArray(required)) {
    for (const name of required) {
      if (typeof name === 'string' && record[name] === undefined) {
        errors.push(`${path}.${name}: required property missing`);
      }
    }
  }
  const properties = node['properties'];
  const declared = new Set<string>();
  if (typeof properties === 'object' && properties !== null && !Array.isArray(properties)) {
    for (const key of Object.keys(properties)) {
      declared.add(key);
      if (record[key] !== undefined) validateNode(record[key], (properties as Schema)[key], `${path}.${key}`, errors);
    }
  }
  if (node['additionalProperties'] === false) {
    for (const key of Object.keys(record)) {
      if (!declared.has(key)) errors.push(`${path}.${key}: additional property not allowed`);
    }
  }
}

function validateArrayShape(value: unknown, node: Schema, path: string, errors: string[]): void {
  if (!Array.isArray(value)) return;
  const items = node['items'];
  if (typeof items === 'object' && items !== null) {
    value.forEach((item, index) => validateNode(item, items, `${path}[${index}]`, errors));
  }
}

/**
 * Verify that every span quote is a verbatim (case-sensitive) substring of the
 * cited markdown page and — when the field resolves to a string in the value —
 * a verbatim substring of that field value. Returns $-rooted violations.
 */
export function verifySpans(value: unknown, spans: readonly Span[], markdown: readonly string[]): string[] {
  const errors: string[] = [];
  spans.forEach((span, index) => {
    const where = typeof span?.field === 'string' && span.field !== '' ? span.field : `$[${index}]`;
    if (typeof span?.quote !== 'string' || span.quote === '') {
      errors.push(`${where}: span not grounded (empty quote)`);
      return;
    }
    if (typeof span?.page !== 'number' || !Number.isInteger(span.page) || span.page < 0 || span.page >= markdown.length) {
      errors.push(`${where}: span not grounded (page index out of range)`);
      return;
    }
    const pageText = markdown[span.page];
    if (typeof pageText !== 'string' || !pageText.includes(span.quote)) {
      errors.push(`${where}: span not grounded (quote is not a verbatim substring of page ${String(span.page)})`);
      return;
    }
    const fieldValue = resolveField(value, span.field);
    if (typeof fieldValue === 'string' && !fieldValue.includes(span.quote)) {
      errors.push(`${where}: span not grounded (quote is not a verbatim substring of the field value)`);
    }
  });
  return errors;
}

function resolveField(value: unknown, field: string): unknown {
  if (typeof field !== 'string' || !field.startsWith('$')) return undefined;
  const rest = field.slice(1);
  if (rest === '') return value;
  let current: unknown = value;
  for (const segment of rest.split('.').filter((part) => part !== '')) {
    const match = /^([A-Za-z0-9_-]+)(?:\[(\d+)\])?$/.exec(segment);
    if (match === null) return undefined;
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[match[1] as string];
    if (match[2] !== undefined) {
      if (!Array.isArray(current)) return undefined;
      current = current[Number(match[2])];
    }
  }
  return current;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'object' && a !== null && b !== null) {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN';
  return typeof value;
}
