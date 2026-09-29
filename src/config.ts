import type { FetchLike } from "./types.js";

export type AevoEnv = "mainnet" | "testnet";
export type AuthMode = "headers" | "hmac";

export interface AevoClientOptions {
  env: AevoEnv;
  apiKey?: string | undefined;
  apiSecret?: string | undefined;
  signingKey?: string | undefined;
  walletPrivateKey?: string | undefined;
  walletAddress?: string | undefined;
  fetch?: FetchLike | undefined;
  baseUrl?: string | undefined;
  wsUrl?: string | undefined;
  authMode?: AuthMode | undefined;
}

export interface AevoEnvironmentConfig {
  restUrl: string;
  wsUrl: string;
  signingDomain: {
    name: string;
    version: "1";
    chainId: string;
  };
}

export const AEVO_ENVIRONMENTS = {
  mainnet: {
    restUrl: "https://api.aevo.xyz",
    wsUrl: "wss://ws.aevo.xyz",
    signingDomain: {
      name: "Aevo Mainnet",
      version: "1",
      chainId: "1"
    }
  },
  testnet: {
    restUrl: "https://api-testnet.aevo.xyz",
    wsUrl: "wss://ws-testnet.aevo.xyz",
    signingDomain: {
      name: "Aevo Testnet",
      version: "1",
      chainId: "11155111"
    }
  }
} as const satisfies Record<AevoEnv, AevoEnvironmentConfig>;

export function environmentConfig(env: AevoEnv): AevoEnvironmentConfig {
  return AEVO_ENVIRONMENTS[env];
}
