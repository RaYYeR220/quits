import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLimiter, sharedLimiter } from '../src/limiter.ts';

describe('limiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('limiter_caps_rps', async () => {
    const limiter = createLimiter({ rps: 3 });
    const t0 = Date.now();
    const started: number[] = [];
    const all = Array.from({ length: 7 }, () => limiter.take().then(() => started.push(Date.now() - t0)));

    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual([0, 0, 0]);

    await vi.advanceTimersByTimeAsync(999);
    expect(started).toHaveLength(3);

    await vi.advanceTimersByTimeAsync(1);
    expect(started).toEqual([0, 0, 0, 1000, 1000, 1000]);

    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all(all);
    expect(started).toEqual([0, 0, 0, 1000, 1000, 1000, 2000]);
  });

  it('window slides, so an idle limiter allows a full burst again', async () => {
    const limiter = createLimiter({ rps: 2 });
    await limiter.take();
    await vi.advanceTimersByTimeAsync(600);
    await limiter.take();

    let third = false;
    void limiter.take().then(() => {
      third = true;
    });
    await vi.advanceTimersByTimeAsync(399);
    expect(third).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(third).toBe(true);
  });

  it('rejects a non-positive rate', () => {
    expect(() => createLimiter({ rps: 0 })).toThrow();
  });

  it('shares one budget per api key', () => {
    expect(sharedLimiter('key-a')).toBe(sharedLimiter('key-a'));
    expect(sharedLimiter('key-a')).not.toBe(sharedLimiter('key-b'));
  });
});
