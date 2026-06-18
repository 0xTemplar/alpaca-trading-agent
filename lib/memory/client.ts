import { MemForksClient } from "@memfork/core";

let _client: MemForksClient | null = null;

/**
 * Returns a memoized MemForksClient instance.
 * Safe to call from multiple server-side modules — only connects once per process.
 */
export async function getMemClient(): Promise<MemForksClient> {
  if (_client) return _client;

  _client = await MemForksClient.connect({
    treeId: process.env.MEMFORK_TREE_ID!,
    signer: process.env.MEMFORK_PRIVATE_KEY!,
    network: "testnet",
    memwal: {
      accountId: process.env.MEMFORK_MEMWAL_ACCOUNT!,
      delegateKey: process.env.MEMFORK_MEMWAL_KEY!,
    },
  });

  return _client;
}
