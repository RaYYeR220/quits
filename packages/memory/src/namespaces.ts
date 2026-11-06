/** Group norms, events and the group's history. */
export const nsGroup = (groupId: string) => `quits:g:${groupId}`;
/** A member's portable preferences and auto-pay limits; follows them to every group. */
export const nsMember = (userId: string) => `quits:m:${userId}`;

/** Walruscan page for a memory's blob. */
export const blobUrl = (blobId: string) => `https://walruscan.com/mainnet/blob/${blobId}`;
