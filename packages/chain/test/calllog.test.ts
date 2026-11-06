import { describe, expect, it } from 'vitest';
import { answered } from '../src/calllog.ts';

describe('answered', () => {
  it('counts a definite answer from the node as answered', () => {
    expect(answered({ ok: true })).toBe(true);
    expect(answered({ ok: false, code: 'NOT_FOUND' })).toBe(true);
    expect(answered({ ok: false, code: 'INVALID_ARGUMENT' })).toBe(true);
    expect(answered({ ok: false, code: '404' })).toBe(true);
  });

  it('counts rate limits, timeouts and gateway errors as failures', () => {
    for (const code of ['RESOURCE_EXHAUSTED', 'UNAVAILABLE', 'DEADLINE_EXCEEDED', 'INTERNAL', 'UNKNOWN', '429', '408', '500', '503']) {
      expect(answered({ ok: false, code })).toBe(false);
    }
  });

  it('counts a failure without a code as a failure', () => {
    expect(answered({ ok: false })).toBe(false);
  });
});
