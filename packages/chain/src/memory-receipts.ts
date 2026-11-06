import type { SuiGraphQLClient } from '@mysten/sui/graphql';

/** Walrus mainnet `Blob` type. Every Walrus Memory memory is one of these, owned by the account owner. */
export const WALRUS_BLOB_TYPE = '0xfdc88f7d7cf30afab2f82e8380d11ee8f70efb90e863d1de8616fae1bb09ea77::blob::Blob';

/** BCS of the dynamic-field name `b"metadata"` (vector<u8>, length-prefixed). */
const METADATA_KEY_BCS = 'CG1ldGFkYXRh';

export interface MemoryReceipt {
  objectId: string;
  /** Walrus blob id in its usual base64url form (matches what the memory relayer returns). */
  blobId: string;
  size: string;
  endEpoch: number | null;
  namespace: string | null;
  agentId: string | null;
  owner: string | null;
}

const QUERY = `query($owner: SuiAddress!, $type: String!, $after: String) {
  address(address: $owner) {
    objects(first: 50, after: $after, filter: { type: $type }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        address
        contents { json }
        dynamicField(name: { type: "vector<u8>", bcs: "${METADATA_KEY_BCS}" }) { value { ... on MoveValue { json } } }
      }
    }
  }
}`;

/** u256 decimal → 32 little-endian bytes → base64url without padding. */
export function walrusBlobId(decimal: string): string {
  let n = BigInt(decimal);
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return Buffer.from(bytes).toString('base64url');
}

type Node = {
  address: string;
  contents?: { json?: { blob_id?: string; size?: string; storage?: { end_epoch?: number } } };
  dynamicField?: { value?: { json?: { metadata?: { contents?: { key: string; value: string }[] } } } } | null;
};

/**
 * Walrus Memory receipts: the Walrus `Blob` objects an owner holds that the
 * memory relayer tagged (`memwal_namespace`, `memwal_agent_id`, …). With
 * `agentId`, only blobs written through that delegate key are returned.
 */
export async function listMemoryReceipts(
  graphql: SuiGraphQLClient,
  owner: string,
  opts: { agentId?: string; namespacePrefix?: string; max?: number } = {},
): Promise<MemoryReceipt[]> {
  const out: MemoryReceipt[] = [];
  let after: string | null = null;
  const max = opts.max ?? 200;
  for (let page = 0; page < 20 && out.length < max; page++) {
    const res = (await graphql.query({ query: QUERY, variables: { owner, type: WALRUS_BLOB_TYPE, after } })) as {
      data?: { address?: { objects?: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Node[] } } | null };
      errors?: { message: string }[];
    };
    if (res.errors?.length) throw new Error(`graphql: ${res.errors[0]?.message}`);
    const objects = res.data?.address?.objects;
    if (!objects) break;
    for (const n of objects.nodes) {
      const meta = Object.fromEntries((n.dynamicField?.value?.json?.metadata?.contents ?? []).map((c) => [c.key, c.value]));
      const namespace = meta.memwal_namespace ?? null;
      const agentId = meta.memwal_agent_id ?? null;
      if (!namespace && !agentId) continue;
      if (opts.agentId && agentId?.toLowerCase() !== opts.agentId.toLowerCase()) continue;
      if (opts.namespacePrefix && !namespace?.startsWith(opts.namespacePrefix)) continue;
      const json = n.contents?.json ?? {};
      out.push({
        objectId: n.address,
        blobId: json.blob_id ? walrusBlobId(json.blob_id) : '',
        size: json.size ?? '0',
        endEpoch: json.storage?.end_epoch ?? null,
        namespace,
        agentId,
        owner: meta.memwal_owner ?? null,
      });
      if (out.length >= max) break;
    }
    if (!objects.pageInfo.hasNextPage) break;
    after = objects.pageInfo.endCursor;
  }
  return out;
}
