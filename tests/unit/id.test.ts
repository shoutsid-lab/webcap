import { describe, expect, it } from 'vitest';
import { newId } from '../../src/util/id.js';

describe('util/id', () => {
  it('newId returns prefix + 16 hex chars', () => {
    expect(newId('inv')).toMatch(/^inv_[0-9a-f]{16}$/);
    expect(newId('cap')).toMatch(/^cap_[0-9a-f]{16}$/);
  });

  it('ids are unique across calls', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId('inv')));
    expect(ids.size).toBe(200);
  });
});
