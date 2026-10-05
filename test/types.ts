import type { JsonRpcSigner, Wallet } from "ethers";
import type { AevoClient, ApproveBuilderTypedData } from "../src/index.js";

declare const client: AevoClient;
declare const wallet: Wallet;
declare const jsonRpcSigner: JsonRpcSigner;

type ViemAddress = `0x${string}`;

interface ViemWalletClientStandIn {
  account?: { address: ViemAddress };
  signTypedData(args: {
    account?: ViemAddress | { address: ViemAddress };
    domain: ApproveBuilderTypedData["domain"];
    types: ApproveBuilderTypedData["types"];
    primaryType: string;
    message: ApproveBuilderTypedData["message"];
  }): Promise<`0x${string}`>;
}

declare const viemWalletClient: ViemWalletClientStandIn;

void client.approveBuilderWithSigner(wallet, {
  builderId: "builder_0123456789abcdef",
  maxFeeBps: "5"
});

void client.approveBuilderWithSigner(jsonRpcSigner, {
  builderId: "builder_0123456789abcdef",
  maxFeeBps: "5"
});

void client.approveBuilderWithSigner(viemWalletClient, {
  builderId: "builder_0123456789abcdef",
  maxFeeBps: "5"
});
