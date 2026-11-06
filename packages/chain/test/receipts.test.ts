import { describe, expect, it } from 'vitest';
import { walrusBlobId, listMemoryReceipts } from '../src/memory-receipts.ts';

describe('memory receipts', () => {
  it('turns a u256 blob id into the base64url form Walrus prints', () => {
    expect(walrusBlobId('0')).toBe('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(walrusBlobId('1')).toBe('AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(walrusBlobId('112348369824897870980032644416957088131665536048862184864742112918046513378294')).toHaveLength(43);
  });

  it('keeps only blobs the memory relayer tagged, optionally for one delegate key', async () => {
    const node = (id: string, meta: Record<string, string>) => ({
      address: id,
      contents: { json: { blob_id: '1', size: '10', storage: { end_epoch: 40 } } },
      dynamicField: { value: { json: { metadata: { contents: Object.entries(meta).map(([key, value]) => ({ key, value })) } } } },
    });
    const graphql = {
      query: async () => ({
        data: {
          address: {
            objects: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                node('0x1', { memwal_namespace: 'quits:g:flat:rules', memwal_agent_id: 'abc', memwal_owner: '0xo' }),
                node('0x2', { memwal_namespace: 'other', memwal_agent_id: 'zzz' }),
                node('0x3', { _walrusBlobType: 'quilt' }),
              ],
            },
          },
        },
      }),
    } as never;
    expect((await listMemoryReceipts(graphql, '0xo')).map((r) => r.objectId)).toEqual(['0x1', '0x2']);
    const mine = await listMemoryReceipts(graphql, '0xo', { agentId: 'ABC' });
    expect(mine).toEqual([{ objectId: '0x1', blobId: walrusBlobId('1'), size: '10', endEpoch: 40, namespace: 'quits:g:flat:rules', agentId: 'abc', owner: '0xo' }]);
  });
});
