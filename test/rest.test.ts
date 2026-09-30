import { describe, expect, it, vi } from "vitest";
import vectors from "./vectors/vectors.json";
import { AevoApiError, AevoClient, generateHmacSignature } from "../src/index.js";
import type { ApproveBuilderSigner } from "../src/index.js";

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function jsonFetch(body: unknown = { ok: true }, status = 200) {
  const calls: FetchCall[] = [];
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: input.toString(), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
      statusText: status === 200 ? "OK" : "Bad Request"
    });
  });
  return { fetch, calls };
}

function textFetch(body: string, status = 200) {
  const calls: FetchCall[] = [];
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: input.toString(), init });
    return new Response(body, { status, statusText: status === 200 ? "OK" : "Bad Request" });
  });
  return { fetch, calls };
}

function parseBody(call: FetchCall): Record<string, unknown> {
  return JSON.parse(String(call.init?.body)) as Record<string, unknown>;
}

const keyMap = new Map(vectors.keys.map((key) => [key.id, key]));
const wallet = keyMap.get("wallet")!;
const signingKey = keyMap.get("signing_key")!;
const orderVector = vectors.domains[0]!.vectors.order_builder[0]!;
const approveVector = vectors.domains[0]!.vectors.approve_builder[0]!;
const withdrawVector = vectors.domains[0]!.vectors.withdraw[0]!;
const transferVector = vectors.domains[0]!.vectors.transfer[0]!;

describe("REST client", () => {
  it("calls public endpoints with the documented paths", async () => {
    const { fetch, calls } = jsonFetch([]);
    const client = new AevoClient({ env: "testnet", fetch, baseUrl: "https://example.test" });

    await client.markets({ asset: "ETH" });
    await client.instrument("ETH-PERP");
    await client.orderbook("ETH-PERP");
    await client.index("ETH");
    await client.time();
    await client.builderConfig();
    await client.builderProfile("builder_0123456789abcdef");

    expect(calls.map((call) => [call.init?.method, new URL(call.url).pathname + new URL(call.url).search])).toEqual([
      ["GET", "/markets?asset=ETH"],
      ["GET", "/instrument/ETH-PERP"],
      ["GET", "/orderbook?instrument_name=ETH-PERP"],
      ["GET", "/index?asset=ETH"],
      ["GET", "/time"],
      ["GET", "/builder-config"],
      ["GET", "/builders/builder_0123456789abcdef"]
    ]);
    expect(calls[0]!.init?.headers).not.toMatchObject({ "AEVO-KEY": expect.any(String) });
  });

  it("adds key/secret headers and maps authenticated methods", async () => {
    const { fetch, calls } = jsonFetch({ success: true });
    const client = new AevoClient({
      env: "testnet",
      fetch,
      baseUrl: "https://example.test",
      apiKey: "key",
      apiSecret: "secret",
      walletPrivateKey: wallet.private_key,
      signingKey: signingKey.private_key
    });

    await client.account();
    await client.portfolio();
    await client.positions();
    await client.getOrders({ limit: 2 });
    await client.tradeHistory({ limit: 5, offset: 1 });
    await client.cancelOrder("0xabc");
    await client.cancelAllOrders({ asset: "ETH", instrumentType: "PERPETUAL" });
    await client.batchCancelOrders(["0x1", "0x2"]);
    await client.registerBuilder("Builder");
    await client.updateBuilderProfile("Builder 2");
    await client.revokeBuilder("builder_0123456789abcdef");
    await client.builderApprovals();
    await client.builderApproval(wallet.address);
    await client.builderStats({ period: "24h" });
    await client.builderMarkets({ period: "7d", limit: 10, offset: 0 });
    await client.builderUsers({ period: "30d", limit: 10, cursor: "next" });
    await client.builderFills({ start: "1", end: "2", instrument: "ETH-PERP", limit: 10 });

    expect(calls.map((call) => [call.init?.method, new URL(call.url).pathname + new URL(call.url).search])).toEqual([
      ["GET", "/account"],
      ["GET", "/portfolio"],
      ["GET", "/positions"],
      ["GET", "/orders?limit=2"],
      ["GET", "/trade-history?limit=5&offset=1"],
      ["DELETE", "/orders/0xabc"],
      ["DELETE", "/orders-all"],
      ["DELETE", "/orders"],
      ["POST", "/builder/register"],
      ["POST", "/builder/profile"],
      ["POST", "/builder/revoke"],
      ["GET", "/account/builder-approvals"],
      [`GET`, `/builder/approval?account=${encodeURIComponent(wallet.address)}`],
      ["GET", "/builder/stats?period=24h"],
      ["GET", "/builder/markets?period=7d&limit=10&offset=0"],
      ["GET", "/builder/users?period=30d&limit=10&cursor=next"],
      ["GET", "/builder/fills?start_time=1&end_time=2&instrument=ETH-PERP&limit=10"]
    ]);
    for (const call of calls) {
      expect(call.init?.headers).toMatchObject({ "AEVO-KEY": "key", "AEVO-SECRET": "secret" });
    }
    expect(parseBody(calls[6]!)).toEqual({ asset: "ETH", instrument_type: "PERPETUAL" });
    expect(parseBody(calls[7]!)).toEqual({ order_ids: ["0x1", "0x2"] });
  });

  it("signs builder create/edit/batch orders and sends builder fields", async () => {
    const { fetch, calls } = jsonFetch({ order_id: "0xorder" });
    const client = new AevoClient({
      env: "mainnet",
      fetch,
      baseUrl: "https://example.test",
      apiKey: "key",
      apiSecret: "secret",
      walletAddress: orderVector.api.maker,
      signingKey: signingKey.private_key
    });
    const params = {
      instrument: orderVector.api.instrument,
      isBuy: orderVector.api.is_buy,
      limitPrice: orderVector.api.limit_price,
      amount: orderVector.api.amount,
      salt: orderVector.api.salt,
      timestamp: orderVector.api.timestamp,
      postOnly: false,
      builder: {
        builderId: orderVector.api.builder_id,
        builderFeeRate: orderVector.api.builder_fee_rate
      }
    };

    await client.createOrder(params);
    await client.editOrder("0xold", params);
    await client.batchCreateOrders([params]);

    const body = parseBody(calls[0]!);
    expect(body).toMatchObject({
      maker: orderVector.api.maker,
      is_buy: true,
      instrument: orderVector.api.instrument,
      limit_price: orderVector.api.limit_price,
      amount: orderVector.api.amount,
      salt: orderVector.api.salt,
      timestamp: orderVector.api.timestamp,
      builder_id: orderVector.api.builder_id,
      builder_fee_rate: orderVector.api.builder_fee_rate,
      signature: orderVector.signature
    });
    expect(new URL(calls[1]!.url).pathname).toBe("/orders/0xold");
    expect((parseBody(calls[2]!).orders as Array<Record<string, unknown>>)[0]!.signature).toBe(
      orderVector.signature
    );
  });

  it("signs register, approveBuilder, withdraw, and transfer request bodies", async () => {
    const { fetch, calls } = jsonFetch({ success: true });
    const client = new AevoClient({
      env: "mainnet",
      fetch,
      baseUrl: "https://example.test",
      apiKey: "key",
      apiSecret: "secret",
      walletPrivateKey: wallet.private_key,
      signingKey: signingKey.private_key
    });

    await client.register({
      signingKey: signingKey.private_key,
      expiry: vectors.domains[0]!.vectors.register[0]!.message.expiry
    });
    await client.approveBuilder({
      builderId: approveVector.message.builderId,
      maxFeeRate: "0.0003",
      nonce: approveVector.message.nonce
    });
    await client.withdraw({
      collateral: withdrawVector.api.collateral,
      to: withdrawVector.api.to,
      amount: withdrawVector.api.amount,
      salt: withdrawVector.api.salt,
      data: withdrawVector.api.data
    });
    await client.transfer({
      collateral: transferVector.api.collateral,
      to: transferVector.api.to,
      amount: transferVector.api.amount,
      salt: transferVector.api.salt
    });

    expect(parseBody(calls[0]!)).toMatchObject({
      account: wallet.address,
      signing_key: signingKey.address,
      account_signature: vectors.domains[0]!.vectors.register[0]!.signature,
      signing_key_signature: vectors.domains[0]!.vectors.sign_key[0]!.signature
    });
    expect(parseBody(calls[1]!)).toMatchObject({
      builder_id: approveVector.message.builderId,
      max_fee_rate: "0.0003",
      nonce: approveVector.message.nonce,
      signature: approveVector.signature,
      account: wallet.address
    });
    expect(parseBody(calls[2]!)).toMatchObject({
      account: wallet.address,
      collateral: withdrawVector.api.collateral,
      to: withdrawVector.api.to,
      amount: withdrawVector.api.amount,
      salt: withdrawVector.api.salt,
      signature: withdrawVector.signature
    });
    expect(parseBody(calls[3]!)).toMatchObject({
      account: wallet.address,
      collateral: transferVector.api.collateral,
      to: transferVector.api.to,
      amount: transferVector.api.amount,
      salt: transferVector.api.salt,
      signature: transferVector.signature
    });
  });

  it("uses HMAC auth headers without leaking the secret", async () => {
    const { fetch, calls } = jsonFetch({ ok: true });
    const client = new AevoClient({
      env: "testnet",
      fetch,
      baseUrl: "https://example.test",
      apiKey: "key",
      apiSecret: "secret",
      authMode: "hmac"
    });
    await client.account();
    const headers = calls[0]!.init?.headers as Record<string, string>;
    const timestamp = headers["AEVO-TIMESTAMP"]!;
    expect(headers["AEVO-SECRET"]).toBeUndefined();
    expect(headers["AEVO-SIGNATURE"]).toBe(
      generateHmacSignature({ key: "key", secret: "secret", timestamp, method: "GET", path: "/account" })
        .signature
    );
  });

  it("submits builder approval with account and optional API auth", async () => {
    const authed = jsonFetch({ success: true });
    const authedClient = new AevoClient({
      env: "mainnet",
      fetch: authed.fetch,
      baseUrl: "https://example.test",
      apiKey: "key",
      apiSecret: "secret"
    });
    await authedClient.submitApproveBuilder({
      builderId: approveVector.message.builderId,
      maxFeeRate: "0.000300",
      nonce: approveVector.message.nonce,
      signature: approveVector.signature,
      account: wallet.address
    });

    expect(authed.calls.map((call) => [call.init?.method, new URL(call.url).pathname])).toEqual([
      ["POST", "/builder/approve"]
    ]);
    expect(parseBody(authed.calls[0]!)).toEqual({
      builder_id: approveVector.message.builderId,
      max_fee_rate: "0.0003",
      nonce: approveVector.message.nonce,
      signature: approveVector.signature,
      account: wallet.address
    });
    expect(authed.calls[0]!.init?.headers).toMatchObject({
      "AEVO-KEY": "key",
      "AEVO-SECRET": "secret"
    });

    const unsigned = jsonFetch({ success: true });
    const unsignedClient = new AevoClient({
      env: "mainnet",
      fetch: unsigned.fetch,
      baseUrl: "https://example.test"
    });
    await unsignedClient.submitApproveBuilder({
      builderId: approveVector.message.builderId,
      maxFeeRate: "0.0003",
      nonce: approveVector.message.nonce,
      signature: approveVector.signature,
      account: wallet.address
    });

    expect(parseBody(unsigned.calls[0]!)).toEqual({
      builder_id: approveVector.message.builderId,
      max_fee_rate: "0.0003",
      nonce: approveVector.message.nonce,
      signature: approveVector.signature,
      account: wallet.address
    });
    expect(unsigned.calls[0]!.init?.headers).not.toMatchObject({
      "AEVO-KEY": expect.any(String),
      "AEVO-SECRET": expect.any(String)
    });
  });

  it("approves builder with ethers-style and viem-style signers", async () => {
    const ethersFetch = jsonFetch({ success: true });
    const ethersClient = new AevoClient({
      env: "mainnet",
      fetch: ethersFetch.fetch,
      baseUrl: "https://example.test"
    });
    let ethersSignCalls = 0;
    const ethersSigner = {
      getAddress: async () => wallet.address,
      signTypedData: async (domain: unknown, types: unknown, message: unknown) => {
        ethersSignCalls += 1;
        expect(domain).toEqual({ name: "Aevo Mainnet", version: "1", chainId: 1 });
        expect(types).toEqual({
          ApproveBuilder: [
            { name: "account", type: "address" },
            { name: "builderId", type: "string" },
            { name: "maxFeeRate", type: "uint256" },
            { name: "nonce", type: "uint256" }
          ]
        });
        expect(message).toEqual(approveVector.message);
        return approveVector.signature;
      }
    } satisfies ApproveBuilderSigner;

    await ethersClient.approveBuilderWithSigner(ethersSigner, {
      builderId: approveVector.message.builderId,
      maxFeeRate: "0.0003",
      nonce: approveVector.message.nonce
    });

    expect(ethersSignCalls).toBe(1);
    expect(parseBody(ethersFetch.calls[0]!)).toEqual({
      builder_id: approveVector.message.builderId,
      max_fee_rate: "0.0003",
      nonce: approveVector.message.nonce,
      signature: approveVector.signature,
      account: wallet.address
    });

    const viemFetch = jsonFetch({ success: true });
    const viemClient = new AevoClient({
      env: "mainnet",
      fetch: viemFetch.fetch,
      baseUrl: "https://example.test"
    });
    let viemSignCalls = 0;
    const viemSigner = {
      account: { address: wallet.address },
      signTypedData: async (typedData: unknown) => {
        viemSignCalls += 1;
        expect(typedData).toEqual({
          domain: { name: "Aevo Mainnet", version: "1", chainId: 1 },
          types: {
            ApproveBuilder: [
              { name: "account", type: "address" },
              { name: "builderId", type: "string" },
              { name: "maxFeeRate", type: "uint256" },
              { name: "nonce", type: "uint256" }
            ]
          },
          primaryType: "ApproveBuilder",
          message: approveVector.message
        });
        return approveVector.signature;
      }
    } satisfies ApproveBuilderSigner;

    await viemClient.approveBuilderWithSigner(viemSigner, {
      builderId: approveVector.message.builderId,
      maxFeeBps: "3",
      nonce: approveVector.message.nonce
    });

    expect(viemSignCalls).toBe(1);
    expect(parseBody(viemFetch.calls[0]!)).toEqual({
      builder_id: approveVector.message.builderId,
      max_fee_rate: "0.0003",
      nonce: approveVector.message.nonce,
      signature: approveVector.signature,
      account: wallet.address
    });
  });

  it("reports AevoValueError codes for bad builder approval inputs", async () => {
    const client = new AevoClient({ env: "testnet", fetch: jsonFetch().fetch, baseUrl: "https://example.test" });
    await expect(
      client.submitApproveBuilder({
        builderId: approveVector.message.builderId,
        maxFeeRate: 0.1 as unknown as string,
        nonce: approveVector.message.nonce,
        signature: approveVector.signature,
        account: wallet.address
      })
    ).rejects.toMatchObject({ code: "UNSAFE_NUMBER" });
    await expect(
      client.submitApproveBuilder({
        builderId: approveVector.message.builderId,
        maxFeeRate: "0.0000001",
        nonce: approveVector.message.nonce,
        signature: approveVector.signature,
        account: wallet.address
      })
    ).rejects.toMatchObject({ code: "TOO_MANY_DECIMALS" });
    await expect(
      client.submitApproveBuilder({
        builderId: approveVector.message.builderId,
        maxFeeRate: "0.0003",
        nonce: approveVector.message.nonce,
        signature: approveVector.signature,
        account: undefined as unknown as string
      })
    ).rejects.toMatchObject({ code: "MISSING_CREDENTIALS" });
  });

  it("maps non-2xx responses to AevoApiError", async () => {
    const { fetch } = jsonFetch({ error: "BUILDER_FEE_EXCEEDS_USER_LIMIT" }, 400);
    const client = new AevoClient({ env: "testnet", fetch, baseUrl: "https://example.test" });
    await expect(client.builderConfig()).rejects.toMatchObject({
      status: 400,
      code: "BUILDER_FEE_EXCEEDS_USER_LIMIT",
      message: "BUILDER_FEE_EXCEEDS_USER_LIMIT"
    } satisfies Partial<AevoApiError>);
  });

  it("guards builder cursor and offset", async () => {
    const client = new AevoClient({
      env: "testnet",
      fetch: jsonFetch().fetch,
      apiKey: "key",
      apiSecret: "secret"
    });
    await expect(client.builderUsers({ cursor: "c", offset: 1 })).rejects.toThrow("cursor or offset");
    await expect(client.builderFills({ cursor: "c", offset: 1 })).rejects.toThrow("cursor or offset");
  });

  it("returns builder CSV text", async () => {
    const { fetch, calls } = textFetch("a,b\n1,2\n");
    const client = new AevoClient({
      env: "testnet",
      fetch,
      baseUrl: "https://example.test",
      apiKey: "key",
      apiSecret: "secret"
    });
    await expect(client.downloadBuilderFillsCsv({ start: "1", end: "2", instrument: "ETH-PERP" })).resolves.toBe(
      "a,b\n1,2\n"
    );
    expect(new URL(calls[0]!.url).pathname + new URL(calls[0]!.url).search).toBe(
      "/builder/fills?start_time=1&end_time=2&instrument=ETH-PERP&format=csv"
    );
  });
});
