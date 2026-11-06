/**
 * Namespaces are kept small and purposeful so a recall over a rules namespace
 * returns every rule in it (relayer recall tops out at 100 results).
 */

/** The group's learned norms ("rent splits by room size"). */
export const nsGroupRules = (groupId: string) => `quits:g:${groupId}:rules`;
/** The group's history: posted expenses, corrections, settlements. */
export const nsGroupLog = (groupId: string) => `quits:g:${groupId}:log`;
/** A member's portable preferences and auto-pay limit; follows them to every group. */
export const nsMember = (userId: string) => `quits:m:${userId}`;

/** Walruscan page for a memory's blob. */
export const blobUrl = (blobId: string) => `https://walruscan.com/mainnet/blob/${blobId}`;
