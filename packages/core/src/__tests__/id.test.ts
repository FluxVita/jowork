import { describe, it, expect } from 'vitest';
import { createId } from '../utils/id';

describe('createId', () => {
  it('generates unique IDs', () => {
    const id1 = createId();
    const id2 = createId();
    expect(id1).not.toBe(id2);
  });

  it('applies prefix when provided', () => {
    const id = createId('ses');
    expect(id).toMatch(/^ses_/);
  });

  it('generates 12-char nanoid after prefix', () => {
    const id = createId('msg');
    const suffix = id.replace('msg_', '');
    expect(suffix.length).toBe(12);
  });

  it('generates bare nanoid without prefix', () => {
    const id = createId();
    expect(id.length).toBe(12);
    expect(id).not.toContain('_');
  });
});
