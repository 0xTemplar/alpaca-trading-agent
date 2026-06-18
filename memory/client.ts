import { MemForksClient } from "@memfork/core";
import { env } from "@/shared/env";

let _client: MemForksClient | null = null;

export async function getMemClient(): Promise<MemForksClient> {
  if (_client) return _client;
  _client = await MemForksClient.connect({
    treeId: env.MEMFORK_TREE_ID(),
    signer: env.MEMFORK_PRIVATE_KEY(),
    network: "testnet",
    memwal: {
      accountId: env.MEMFORK_MEMWAL_ACCOUNT(),
      delegateKey: env.MEMFORK_MEMWAL_KEY(),
    },
  });
  return _client;
}
