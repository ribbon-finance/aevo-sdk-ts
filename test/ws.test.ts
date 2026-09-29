import { describe, expect, it } from "vitest";
import vectors from "./vectors/vectors.json";
import {
  AevoWebSocketClient,
  generateHmacSignature,
  type AevoWsMessage,
  type WebSocketLike
} from "../src/index.js";

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

const keyMap = new Map(vectors.keys.map((key) => [key.id, key]));
const wallet = keyMap.get("wallet")!;
const signingKey = keyMap.get("signing_key")!;
const orderVector = vectors.domains[0]!.vectors.order_builder[0]!;

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
});
