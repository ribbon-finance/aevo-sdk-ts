import { describe, expect, it } from "vitest";
import vectors from "./vectors/vectors.json";
import {
  AevoClient,
  AevoWebSocketClient,
  generateHmacSignature,
  type AevoWsMessage,
  type WebSocketLike
} from "../src/index.js";

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

class MockSocket implements WebSocketLike {
  static instances: MockSocket[] = [];
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(readonly url: string) {
    MockSocket.instances.push(this);
    queueMicrotask(() => this.emit("open", {}));
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.emit("close", {});
  }

  addEventListener(event: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  emit(event: string, payload: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(payload);
    }
  }
}

function lastFrame(socket: MockSocket): Record<string, unknown> {
  return JSON.parse(socket.sent.at(-1)!) as Record<string, unknown>;
}

function jsonFetch(body: unknown = { ok: true }) {
  const calls: FetchCall[] = [];
  const fetch = async (input: string | URL, init?: RequestInit) => {
    calls.push({ url: input.toString(), init });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  return { fetch, calls };
}

function parseBody(call: FetchCall): Record<string, unknown> {
  return JSON.parse(String(call.init?.body)) as Record<string, unknown>;
}

const keyMap = new Map(vectors.keys.map((key) => [key.id, key]));
const wallet = keyMap.get("wallet")!;
const signingKey = keyMap.get("signing_key")!;
const orderVector = vectors.domains[0]!.vectors.order_builder[0]!;
const optionalOrderJsonKeys = [
  "post_only",
  "reduce_only",
  "time_in_force",
  "mmp",
  "stop",
  "trigger",
  "close_position",
  "partial_position",
  "parent_order_id",
  "self_trade_prevention",
  "builder_id",
  "builder_fee_rate"
];

describe("AevoWebSocketClient", () => {
  it("sends key/secret auth and subscribe frames", async () => {
    MockSocket.instances = [];
    const client = new AevoWebSocketClient({
      env: "testnet",
      apiKey: "key",
      apiSecret: "secret",
      WebSocket: MockSocket
    });
    await client.connect();
    const socket = MockSocket.instances[0]!;

    client.auth(7);
    expect(lastFrame(socket)).toEqual({
      id: 7,
      op: "auth",
      data: { key: "key", secret: "secret" }
    });

    client.subscribe(["orderbook:ETH-PERP"], 8);
    expect(lastFrame(socket)).toEqual({
      id: 8,
      op: "subscribe",
      data: ["orderbook:ETH-PERP"]
    });
  });

  it("sends HMAC auth frames and per-message auth", async () => {
    MockSocket.instances = [];
    const client = new AevoWebSocketClient({
      env: "testnet",
      apiKey: "key",
      apiSecret: "secret",
      authMode: "hmac",
      WebSocket: MockSocket
    });
    await client.connect();
    const socket = MockSocket.instances[0]!;

    client.auth(1);
    const authFrame = lastFrame(socket);
    const authData = authFrame.data as Record<string, string>;
    expect(authData.secret).toBeUndefined();
    expect(authData.signature).toBe(
      generateHmacSignature({
        key: "key",
        secret: "secret",
        timestamp: authData.timestamp!,
        method: "ws",
        path: "auth",
        body: ""
      }).signature
    );

    client.subscribe(["fills"], 2);
    const subFrame = lastFrame(socket);
    const auth = subFrame.auth as Record<string, string>;
    expect(auth.signature).toBe(
      generateHmacSignature({
        key: "key",
        secret: "secret",
        timestamp: auth.timestamp!,
        method: "ws",
        path: "subscribe",
        body: JSON.stringify(["fills"])
      }).signature
    );
  });

  it("publishes signed create/edit/cancel order frames", async () => {
    MockSocket.instances = [];
    const client = new AevoWebSocketClient({
      env: "mainnet",
      apiKey: "key",
      apiSecret: "secret",
      walletAddress: orderVector.api.maker,
      signingKey: signingKey.private_key,
      WebSocket: MockSocket
    });
    await client.connect();
    const socket = MockSocket.instances[0]!;
    const params = {
      instrument: orderVector.api.instrument,
      isBuy: orderVector.api.is_buy,
      limitPrice: orderVector.api.limit_price,
      amount: orderVector.api.amount,
      salt: orderVector.api.salt,
      timestamp: orderVector.api.timestamp,
      builder: {
        builderId: orderVector.api.builder_id,
        builderFeeRate: orderVector.api.builder_fee_rate
      }
    };

    client.createOrder(params, 3);
    expect(lastFrame(socket)).toMatchObject({
      id: 3,
      op: "create_order",
      data: {
        maker: orderVector.api.maker,
        signature: orderVector.signature,
        builder_id: orderVector.api.builder_id,
        builder_fee_rate: orderVector.api.builder_fee_rate
      }
    });

    client.editOrder("0xold", params, 4);
    expect(lastFrame(socket)).toMatchObject({
      id: 4,
      op: "edit_order",
      data: { order_id: "0xold", signature: orderVector.signature }
    });

    client.cancelOrder("0xold", 5);
    expect(lastFrame(socket)).toEqual({ id: 5, op: "cancel_order", data: { order_id: "0xold" } });
    client.cancelAllOrders(6);
    expect(lastFrame(socket)).toEqual({ id: 6, op: "cancel_all_orders", data: {} });
  });

  it("dispatches parsed messages by message and channel events", async () => {
    MockSocket.instances = [];
    const client = new AevoWebSocketClient({
      env: "testnet",
      WebSocket: MockSocket
    });
    await client.connect();
    const socket = MockSocket.instances[0]!;
    const messages: AevoWsMessage[] = [];
    const channelMessages: AevoWsMessage[] = [];
    client.on("message", (message) => messages.push(message as AevoWsMessage));
    client.on("channel:orders", (message) => channelMessages.push(message as AevoWsMessage));

    socket.emit("message", {
      data: JSON.stringify({ channel: "orders", data: [{ order_id: "0x1" }] })
    });

    expect(messages).toHaveLength(1);
    expect(channelMessages).toHaveLength(1);
    expect(channelMessages[0]!.data).toEqual([{ order_id: "0x1" }]);
  });

  it("supports channel helpers", async () => {
    MockSocket.instances = [];
    const client = new AevoWebSocketClient({ env: "testnet", WebSocket: MockSocket });
    await client.connect();
    const socket = MockSocket.instances[0]!;
    client.subscribeOrderbook("ETH-PERP");
    client.subscribeTicker("ETH");
    client.subscribeTrades("ETH-PERP");
    client.subscribeOrders();
    client.subscribeFills();
    client.subscribePositions();
    expect(socket.sent.map((text) => JSON.parse(text).data)).toEqual([
      ["orderbook:ETH-PERP"],
      ["ticker:ETH:PERPETUAL"],
      ["trades:ETH-PERP"],
      ["orders"],
      ["fills"],
      ["positions"]
    ]);
  });

  it("includes and omits optional order fields in create/edit frames", async () => {
    MockSocket.instances = [];
    const client = new AevoWebSocketClient({
      env: "mainnet",
      apiKey: "key",
      apiSecret: "secret",
      walletAddress: orderVector.api.maker,
      signingKey: signingKey.private_key,
      WebSocket: MockSocket
    });
    await client.connect();
    const socket = MockSocket.instances[0]!;
    const baseParams = {
      instrument: orderVector.api.instrument,
      isBuy: orderVector.api.is_buy,
      limitPrice: orderVector.api.limit_price,
      amount: orderVector.api.amount,
      salt: orderVector.api.salt,
      timestamp: orderVector.api.timestamp
    };
    const optionalJson = {
      post_only: true,
      reduce_only: true,
      time_in_force: "IOC",
      mmp: true,
      stop: "STOP_LOSS",
      trigger: "INDEX_PRICE",
      close_position: true,
      partial_position: true,
      parent_order_id: "0xparent",
      self_trade_prevention: "CANCEL_TAKER",
      builder_id: orderVector.api.builder_id,
      builder_fee_rate: orderVector.api.builder_fee_rate
    };
    const paramsWithOptionalFields = {
      ...baseParams,
      postOnly: optionalJson.post_only,
      reduceOnly: optionalJson.reduce_only,
      timeInForce: optionalJson.time_in_force,
      mmp: optionalJson.mmp,
      stop: optionalJson.stop,
      trigger: optionalJson.trigger,
      closePosition: optionalJson.close_position,
      partialPosition: optionalJson.partial_position,
      parentOrderId: optionalJson.parent_order_id,
      selfTradePrevention: optionalJson.self_trade_prevention,
      builder: {
        builderId: optionalJson.builder_id,
        builderFeeRate: optionalJson.builder_fee_rate
      }
    };

    client.createOrder(paramsWithOptionalFields, 10);
    expect(lastFrame(socket)).toMatchObject({
      id: 10,
      op: "create_order",
      data: optionalJson
    });

    client.editOrder("0xold", paramsWithOptionalFields, 11);
    expect(lastFrame(socket)).toMatchObject({
      id: 11,
      op: "edit_order",
      data: { ...optionalJson, order_id: "0xold" }
    });

    client.createOrder(baseParams, 12);
    const createData = lastFrame(socket).data as Record<string, unknown>;
    for (const key of optionalOrderJsonKeys) {
      expect(createData).not.toHaveProperty(key);
    }

    client.editOrder("0xold", baseParams, 13);
    const editData = lastFrame(socket).data as Record<string, unknown>;
    for (const key of optionalOrderJsonKeys) {
      expect(editData).not.toHaveProperty(key);
    }
    expect(editData.order_id).toBe("0xold");
  });

  it("uses the same signed order payload for REST and websocket", async () => {
    MockSocket.instances = [];
    const { fetch, calls } = jsonFetch({ order_id: "0xorder" });
    const restClient = new AevoClient({
      env: "mainnet",
      fetch,
      baseUrl: "https://example.test",
      apiKey: "key",
      apiSecret: "secret",
      walletAddress: orderVector.api.maker,
      signingKey: signingKey.private_key
    });
    const wsClient = new AevoWebSocketClient({
      env: "mainnet",
      apiKey: "key",
      apiSecret: "secret",
      walletAddress: orderVector.api.maker,
      signingKey: signingKey.private_key,
      WebSocket: MockSocket
    });
    await wsClient.connect();
    const socket = MockSocket.instances[0]!;
    const params = {
      instrument: orderVector.api.instrument,
      isBuy: orderVector.api.is_buy,
      limitPrice: orderVector.api.limit_price,
      amount: orderVector.api.amount,
      salt: orderVector.api.salt,
      timestamp: orderVector.api.timestamp,
      postOnly: true,
      reduceOnly: true,
      timeInForce: "IOC",
      mmp: true,
      stop: "STOP_LOSS",
      trigger: "INDEX_PRICE",
      closePosition: true,
      partialPosition: true,
      parentOrderId: "0xparent",
      selfTradePrevention: "CANCEL_TAKER",
      builder: {
        builderId: orderVector.api.builder_id,
        builderFeeRate: orderVector.api.builder_fee_rate
      }
    };

    await restClient.createOrder(params);
    wsClient.createOrder(params, 20);
    expect(lastFrame(socket).data).toEqual(parseBody(calls[0]!));

    await restClient.editOrder("0xold", params);
    wsClient.editOrder("0xold", params, 21);
    const editData = { ...(lastFrame(socket).data as Record<string, unknown>) };
    delete editData.order_id;
    expect(editData).toEqual(parseBody(calls[1]!));
  });
});
