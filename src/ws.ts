import { EventEmitter } from "node:events";
import { getAddress } from "ethers";
import WebSocket from "ws";
import type { AevoClientOptions, AuthMode } from "./config.js";
import { environmentConfig } from "./config.js";
import { generateHmacSignature, unixTimestampNanoseconds } from "./auth.js";
import { AevoValueError } from "./errors.js";
import { createSignedOrderPayload as buildSignedOrderPayload } from "./orderPayload.js";
import { walletAddress } from "./signing.js";
import type { CreateOrderParams, SignedOrderPayload } from "./types.js";

export type AevoWsOperation =
  | "status"
  | "channels"
  | "auth"
  | "subscribe"
  | "unsubscribe"
  | "ping"
  | "create_order"
  | "edit_order"
  | "cancel_order"
  | "cancel_all_orders";

export interface AevoWsRequest {
  id?: number;
  op: AevoWsOperation;
  data?: unknown;
  auth?: {
    key: string;
    timestamp: string;
    signature: string;
  };
}

export interface AevoWsMessage {
  id?: number;
  op?: string;
  channel?: string;
  data?: unknown;
  error?: string;
  [key: string]: unknown;
}

export interface WebSocketLike {
  readyState?: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener?: (event: string, listener: (event: unknown) => void) => void;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
}

export type WebSocketFactory = new (url: string) => WebSocketLike;

export interface AevoWebSocketClientOptions
  extends Pick<
    AevoClientOptions,
    "env" | "apiKey" | "apiSecret" | "signingKey" | "walletPrivateKey" | "walletAddress" | "wsUrl"
  > {
  authMode?: AuthMode;
  WebSocket?: WebSocketFactory;
}

function compactJson(value: unknown): string {
  return JSON.stringify(value);
}

export class AevoWebSocketClient extends EventEmitter {
  readonly env: AevoClientOptions["env"];
  readonly url: string;
  readonly authMode: AuthMode;

  private readonly WebSocketImpl: WebSocketFactory;
  private socket?: WebSocketLike;
  private nextId = 1;

  constructor(private readonly options: AevoWebSocketClientOptions) {
    super();
    this.env = options.env;
    this.url = options.wsUrl ?? environmentConfig(options.env).wsUrl;
    this.authMode = options.authMode ?? "headers";
    this.WebSocketImpl = options.WebSocket ?? (WebSocket as unknown as WebSocketFactory);
  }

  connect(): Promise<void> {
    this.socket = new this.WebSocketImpl(this.url);
    return new Promise((resolve, reject) => {
      this.listen("open", () => resolve());
      this.listen("error", (error) => reject(error));
      this.listen("close", (...args) => this.emit("close", ...args));
      this.listen("message", (eventOrData) => this.handleMessage(eventOrData));
    });
  }

  auth(id = this.nextRequestId()): number {
    const { key, secret } = this.requireApiCredentials();
    if (this.authMode === "headers") {
      this.send({ id, op: "auth", data: { key, secret } });
      return id;
    }
    const timestamp = unixTimestampNanoseconds();
    const { signature } = generateHmacSignature({
      key,
      secret,
      timestamp,
      method: "ws",
      path: "auth",
      body: ""
    });
    this.send({ id, op: "auth", data: { key, timestamp, signature } });
    return id;
  }

  subscribe(channels: string[], id = this.nextRequestId()): number {
    this.sendAuthed({ id, op: "subscribe", data: channels });
    return id;
  }

  unsubscribe(channels: string[], id = this.nextRequestId()): number {
    this.sendAuthed({ id, op: "unsubscribe", data: channels });
    return id;
  }

  subscribeOrderbook(instrumentName: string): number {
    return this.subscribe([`orderbook:${instrumentName}`]);
  }

  subscribeTicker(asset: string, instrumentType = "PERPETUAL"): number {
    return this.subscribe([`ticker:${asset}:${instrumentType}`]);
  }

  subscribeTrades(instrumentName: string): number {
    return this.subscribe([`trades:${instrumentName}`]);
  }

  subscribeOrders(): number {
    return this.subscribe(["orders"]);
  }

  subscribeFills(): number {
    return this.subscribe(["fills"]);
  }

  subscribePositions(): number {
    return this.subscribe(["positions"]);
  }

  ping(id = this.nextRequestId()): number {
    this.send({ id, op: "ping" });
    return id;
  }

  createOrder(params: CreateOrderParams, id = this.nextRequestId()): number {
    this.sendAuthed({ id, op: "create_order", data: this.createSignedOrderPayload(params) });
    return id;
  }

  editOrder(orderId: string, params: CreateOrderParams, id = this.nextRequestId()): number {
    this.sendAuthed({
      id,
      op: "edit_order",
      data: { ...this.createSignedOrderPayload(params), order_id: orderId }
    });
    return id;
  }

  cancelOrder(orderId: string, id = this.nextRequestId()): number {
    this.sendAuthed({ id, op: "cancel_order", data: { order_id: orderId } });
    return id;
  }

  cancelAllOrders(id = this.nextRequestId()): number {
    this.sendAuthed({ id, op: "cancel_all_orders", data: {} });
    return id;
  }

  close(code?: number, reason?: string): void {
    this.socket?.close(code, reason);
  }

  send(request: AevoWsRequest): void {
    if (this.socket === undefined) {
      throw new AevoValueError("INVALID_ARGUMENT", "websocket is not connected");
    }
    this.socket.send(compactJson(request));
  }

  createSignedOrderPayload(params: CreateOrderParams): SignedOrderPayload {
    const signingKey = this.options.signingKey;
    if (signingKey === undefined) {
      throw new AevoValueError("MISSING_CREDENTIALS", "signingKey is required");
    }
    const wallet =
      this.options.walletAddress ??
      (this.options.walletPrivateKey === undefined
        ? undefined
        : walletAddress(this.options.walletPrivateKey));
    if (wallet === undefined && params.maker === undefined) {
      throw new AevoValueError("MISSING_CREDENTIALS", "walletAddress or walletPrivateKey is required");
    }
    const maker = getAddress(params.maker ?? wallet!);
    return buildSignedOrderPayload(this.env, signingKey, maker, params);
  }

  private sendAuthed(request: AevoWsRequest): void {
    if (this.authMode === "hmac") {
      const { key, secret } = this.requireApiCredentials();
      const timestamp = unixTimestampNanoseconds();
      const body = request.data === undefined ? "" : compactJson(request.data);
      const { signature } = generateHmacSignature({
        key,
        secret,
        timestamp,
        method: "ws",
        path: request.op,
        body
      });
      this.send({ ...request, auth: { key, timestamp, signature } });
      return;
    }
    this.send(request);
  }

  private listen(event: string, listener: (...args: unknown[]) => void): void {
    const socket = this.socket;
    if (socket === undefined) {
      return;
    }
    if (socket.addEventListener !== undefined) {
      socket.addEventListener(event, (e) => listener(e));
    } else if (socket.on !== undefined) {
      socket.on(event, listener);
    }
  }

  private handleMessage(eventOrData: unknown): void {
    const data =
      typeof eventOrData === "object" &&
      eventOrData !== null &&
      "data" in eventOrData
        ? (eventOrData as { data: unknown }).data
        : eventOrData;
    const text = typeof data === "string" ? data : Buffer.isBuffer(data) ? data.toString("utf8") : "";
    if (text === "") {
      return;
    }
    const parsed = JSON.parse(text) as AevoWsMessage;
    this.emit("message", parsed);
    if (parsed.channel !== undefined) {
      this.emit("channel", parsed.channel, parsed);
      this.emit(`channel:${parsed.channel}`, parsed);
    }
    if (parsed.op !== undefined) {
      this.emit(`op:${parsed.op}`, parsed);
    }
  }

  private nextRequestId(): number {
    return this.nextId++;
  }

  private requireApiCredentials(): { key: string; secret: string } {
    if (this.options.apiKey === undefined || this.options.apiSecret === undefined) {
      throw new AevoValueError("MISSING_CREDENTIALS", "apiKey and apiSecret are required");
    }
    return { key: this.options.apiKey, secret: this.options.apiSecret };
  }
}
