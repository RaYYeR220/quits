import { describe, expect, it } from 'vitest';
import { MAX_LITERALS, watchGroups } from '../src/stream.ts';

const addr = (i: number) => `0x${i.toString(16).padStart(64, '0')}`;

describe('watchGroups', () => {
  it('keeps every filter within the checkpoint filter limit', () => {
    const groups = watchGroups(Array.from({ length: 23 }, (_, i) => addr(i)));
    expect(groups.map((g) => g.length)).toEqual([10, 10, 3]);
    expect(groups.every((g) => g.length <= MAX_LITERALS)).toBe(true);
  });

  it('watches each address once, whatever its case', () => {
    const a = addr(1);
    expect(watchGroups([a, a.toUpperCase().replace('0X', '0x'), addr(2)])).toEqual([[a, addr(2)]]);
  });

  it('opens no stream when nobody has an address', () => {
    expect(watchGroups([])).toEqual([]);
  });
});
