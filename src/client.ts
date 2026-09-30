import { Wallet, getAddress } from "ethers";
import type { TypedDataDomain, TypedDataField } from "ethers";
import type { AevoClientOptions } from "./config.js";
import { environmentConfig } from "./config.js";
import { generateHmacSignature, unixTimestampNanoseconds } from "./auth.js";
import { AevoApiError, AevoValueError } from "./errors.js";
import { createSignedOrderPayload as buildSignedOrderPayload } from "./orderPayload.js";
import {
  getApproveBuilderTypedData,
  makeSalt,
  signApproveBuilder,
  signRegister,
  signSignKey,
  signTransfer,
  signWithdraw,
  walletAddress,
  type ApproveBuilderTypedData,
  type Hex
} from "./signing.js";
import type {
  AevoSuccess,
  BuilderApproval,
  BuilderConfig,
  BuilderProfile,
  BuilderReportParams,
  BuilderStatsParams,
  CreateOrderParams,
  FetchLike,
  JsonValue,
  MaybePromise,
  OrderResponse,
  PublicMarket,
  RegisterResponse,
  SignedOrderPayload,
  TransferParams,
  WithdrawParams
} from "./types.js";
import { normalizeDecimal6, oneOfRateOrBps } from "./units.js";

type QueryValue = string | number | bigint | boolean | undefined | null;
type QueryParams = Record<string, QueryValue>;
type Body = object;
type EthersTypedDataTypes = Record<string, TypedDataField[]>;
type ViemTypedDataAccount = string | { address?: string };

export interface EthersTypedDataSigner {
  signTypedData(
    domain: TypedDataDomain,
    types: EthersTypedDataTypes,
    value: Record<string, any>
  ): Promise<string>;
  getAddress?: () => MaybePromise<string>;
  address?: string;
}

export interface ViemSignTypedDataArgs {
  account?: ViemTypedDataAccount;
  domain: ApproveBuilderTypedData["domain"];
  types: ApproveBuilderTypedData["types"];
  primaryType: string;
  message: ApproveBuilderTypedData["message"];
}

export interface ViemTypedDataSigner {
  signTypedData(args: ViemSignTypedDataArgs): Promise<Hex>;
  account?: ViemTypedDataAccount;
}

export type ApproveBuilderSigner = EthersTypedDataSigner | ViemTypedDataSigner;

function requireFetch(fetchImpl?: FetchLike): FetchLike {
  if (fetchImpl !== undefined) {
    return fetchImpl;
  }
  if (globalThis.fetch === undefined) {
    throw new AevoValueError("INVALID_ARGUMENT", "fetch is unavailable; pass fetch in AevoClient options");
  }
  return globalThis.fetch.bind(globalThis) as FetchLike;
}

function compactJson(body: Body): string {
  return JSON.stringify(body);
}

function appendQuery(path: string, query?: QueryParams): string {
  if (query === undefined) {
    return path;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      params.set(key, value.toString());
    }
  }
  const text = params.toString();
  return text === "" ? path : `${path}?${text}`;
}

function bodyErrorCode(body: unknown): string | undefined {
  if (body !== null && typeof body === "object" && "error" in body) {
    const error = (body as { error?: unknown }).error;
    return typeof error === "string" ? error : undefined;
  }
  return undefined;
}

function bodyMessage(body: unknown, fallback: string): string {
  if (body !== null && typeof body === "object") {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
    const error = (body as { error?: unknown }).error;
    if (typeof error === "string") {
      return error;
    }
  }
  return fallback;
}

function uintString(value: string | number | bigint, name: string): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new AevoValueError("UNSAFE_NUMBER", `${name} must be a non-negative safe integer`);
    }
    return String(value);
  }
  const text = value.toString();
  if (!/^(0|[1-9][0-9]*)$/.test(text)) {
    throw new AevoValueError("INVALID_ARGUMENT", `${name} must be a non-negative integer`);
  }
  return text;
}

function requireString(value: unknown, name: string, code: "INVALID_ARGUMENT" | "MISSING_CREDENTIALS"): string {
  if (typeof value !== "string" || value === "") {
    throw new AevoValueError(code, `${name} is required`);
  }
  return value;
}

function normalizeAccount(account: unknown): string {
  return getAddress(requireString(account, "account", "MISSING_CREDENTIALS"));
}

function accountAddress(account: unknown): string | undefined {
  if (typeof account === "string") {
    return account;
  }
  if (account !== null && typeof account === "object") {
    const address = (account as { address?: unknown }).address;
    return typeof address === "string" ? address : undefined;
  }
  return undefined;
}

function hasGetAddress(signer: ApproveBuilderSigner): signer is ApproveBuilderSigner & {
  getAddress: () => MaybePromise<string>;
} {
  return "getAddress" in signer && typeof signer.getAddress === "function";
}

function isEthersTypedDataSigner(signer: ApproveBuilderSigner): signer is EthersTypedDataSigner {
  return signer.signTypedData.length >= 3;
}

async function signerAccount(signer: ApproveBuilderSigner, account?: string): Promise<string> {
  if (account !== undefined) {
    return normalizeAccount(account);
  }
  if (hasGetAddress(signer)) {
    return normalizeAccount(await signer.getAddress());
  }
  const address =
    ("address" in signer ? accountAddress(signer.address) : undefined) ??
    ("account" in signer ? accountAddress(signer.account) : undefined);
  if (address !== undefined) {
    return normalizeAccount(address);
  }
  throw new AevoValueError("MISSING_CREDENTIALS", "account is required");
}

async function signApproveBuilderTypedData(
  signer: ApproveBuilderSigner,
  typedData: ApproveBuilderTypedData
): Promise<Hex> {
  if (typeof signer.signTypedData !== "function") {
    throw new AevoValueError("INVALID_ARGUMENT", "signer.signTypedData is required");
  }
  const signature = isEthersTypedDataSigner(signer)
    ? await signer.signTypedData(typedData.domain, typedData.types as EthersTypedDataTypes, typedData.message)
    : await signer.signTypedData(typedData);
  return signature as Hex;
}

export class AevoClient {
  readonly env: AevoClientOptions["env"];
  readonly baseUrl: string;
  readonly wsUrl: string;
  readonly apiKey: string | undefined;
  readonly apiSecret: string | undefined;
  readonly signingKey: string | undefined;
  readonly walletPrivateKey: string | undefined;
  readonly walletAddress: string | undefined;

  private readonly fetchImpl: FetchLike;
  private readonly authMode: NonNullable<AevoClientOptions["authMode"]>;

  constructor(options: AevoClientOptions) {
    const env = environmentConfig(options.env);
    this.env = options.env;
    this.baseUrl = (options.baseUrl ?? env.restUrl).replace(/\/+$/, "");
    this.wsUrl = options.wsUrl ?? env.wsUrl;
    this.apiKey = options.apiKey;
    this.apiSecret = options.apiSecret;
    this.signingKey = options.signingKey;
    this.walletPrivateKey = options.walletPrivateKey;
    this.walletAddress =
      options.walletAddress ??
      (options.walletPrivateKey !== undefined ? walletAddress(options.walletPrivateKey) : undefined);
    this.fetchImpl = requireFetch(options.fetch);
    this.authMode = options.authMode ?? "headers";
  }

  async markets(params: { asset?: string } = {}): Promise<PublicMarket[]> {
    return this.request("GET", "/markets", { query: params });
  }

  async instrument(name: string): Promise<Record<string, unknown>> {
    return this.request("GET", `/instrument/${encodeURIComponent(name)}`);
  }

  async orderbook(name: string): Promise<Record<string, unknown>> {
    return this.request("GET", "/orderbook", { query: { instrument_name: name } });
  }

  async index(asset: string): Promise<Record<string, unknown>> {
    return this.request("GET", "/index", { query: { asset } });
  }

  async time(): Promise<Record<string, unknown>> {
    return this.request("GET", "/time");
  }

  async builderConfig(): Promise<BuilderConfig> {
    return this.request("GET", "/builder-config");
  }

  async builderProfile(builderId: string): Promise<BuilderProfile> {
    return this.request("GET", `/builders/${encodeURIComponent(builderId)}`);
  }

  async account(): Promise<Record<string, unknown>> {
    return this.request("GET", "/account", { auth: true });
  }

  async portfolio(): Promise<Record<string, unknown>> {
    return this.request("GET", "/portfolio", { auth: true });
  }

  async positions(): Promise<Record<string, unknown>> {
    return this.request("GET", "/positions", { auth: true });
  }

  async getOrders(params: QueryParams = {}): Promise<OrderResponse[]> {
    return this.request("GET", "/orders", { query: params, auth: true });
  }

  async tradeHistory(params: { limit?: number; offset?: number } = {}): Promise<Record<string, unknown>> {
    return this.request("GET", "/trade-history", { query: params, auth: true });
  }

  async createOrder(params: CreateOrderParams): Promise<OrderResponse> {
    return this.request("POST", "/orders", {
      auth: true,
      body: this.createSignedOrderPayload(params)
    });
  }

  async editOrder(orderId: string, params: CreateOrderParams): Promise<OrderResponse> {
    return this.request("POST", `/orders/${encodeURIComponent(orderId)}`, {
      auth: true,
      body: this.createSignedOrderPayload(params)
    });
  }

  async cancelOrder(orderId: string): Promise<{ order_id: string }> {
    return this.request("DELETE", `/orders/${encodeURIComponent(orderId)}`, { auth: true });
  }

  async cancelAllOrders(filters: { asset?: string; instrumentType?: string } = {}): Promise<AevoSuccess> {
    return this.request("DELETE", "/orders-all", {
      auth: true,
      body: {
        ...(filters.asset !== undefined ? { asset: filters.asset } : {}),
        ...(filters.instrumentType !== undefined ? { instrument_type: filters.instrumentType } : {})
      }
    });
  }

  async batchCreateOrders(orders: CreateOrderParams[]): Promise<AevoSuccess> {
    return this.request("POST", "/batch-orders", {
      auth: true,
      body: { orders: orders.map((order) => this.createSignedOrderPayload(order)) }
    });
  }

  async batchCancelOrders(orderIds: string[]): Promise<Record<string, unknown>> {
    return this.request("DELETE", "/orders", { auth: true, body: { order_ids: orderIds } });
  }

  async register(params: {
    walletPrivateKey?: string;
    signingKey?: string;
    expiry?: string | number | bigint;
    referralCode?: string;
    noApiKey?: boolean;
  } = {}): Promise<RegisterResponse & { signingKeyPrivateKey: string }> {
    const walletKey = params.walletPrivateKey ?? this.walletPrivateKey;
    if (walletKey === undefined) {
      throw new AevoValueError("MISSING_CREDENTIALS", "walletPrivateKey is required to register");
    }
    const signingWallet = params.signingKey === undefined ? Wallet.createRandom() : new Wallet(params.signingKey);
    const account = walletAddress(walletKey);
    const signingKeyAddress = signingWallet.address;
    const expiry = params.expiry ?? Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    const registerSig = signRegister(this.env, walletKey, { key: signingKeyAddress, expiry });
    const signKeySig = signSignKey(this.env, signingWallet.privateKey, { account });
    const body = {
      account,
      signing_key: signingKeyAddress,
      expiry: expiry.toString(),
      account_signature: registerSig.signature,
      signing_key_signature: signKeySig.signature,
      ...(params.referralCode !== undefined ? { referral_code: params.referralCode } : {}),
      ...(params.noApiKey !== undefined ? { no_api_key: params.noApiKey } : {})
    };
    const response = await this.request<RegisterResponse>("POST", "/register", { body });
    return { ...response, signingKeyPrivateKey: signingWallet.privateKey };
  }

  async withdraw(params: WithdrawParams): Promise<AevoSuccess> {
    const walletKey = this.requireWalletPrivateKey();
    const account = params.account ?? this.requireWalletAddress();
    const salt = params.salt ?? makeSalt();
    const withdrawInput = {
      collateral: params.collateral,
      to: params.to,
      amount: params.amount,
      salt,
      ...(params.data !== undefined ? { data: params.data } : {})
    };
    const signed = signWithdraw(this.env, walletKey, withdrawInput);
    return this.request("POST", "/withdraw", {
      auth: true,
      body: {
        account,
        collateral: params.collateral,
        to: params.to,
        amount: params.amount,
        salt,
        signature: signed.signature,
        ...(params.data !== undefined ? { data: params.data } : {}),
        ...(params.recipient !== undefined ? { recipient: params.recipient } : {}),
        ...(params.socketFees !== undefined ? { socket_fees: params.socketFees } : {}),
        ...(params.socketMsgGasLimit !== undefined
          ? { socket_msg_gas_limit: params.socketMsgGasLimit }
          : {}),
        ...(params.socketConnector !== undefined ? { socket_connector: params.socketConnector } : {})
      }
    });
  }

  async transfer(params: TransferParams): Promise<AevoSuccess> {
    const walletKey = this.requireWalletPrivateKey();
    const account = params.account ?? this.requireWalletAddress();
    const salt = params.salt ?? makeSalt();
    const signed = signTransfer(this.env, walletKey, {
      collateral: params.collateral,
      to: params.to,
      amount: params.amount,
      salt
    });
    return this.request("POST", "/transfer", {
      auth: true,
      body: {
        account,
        collateral: params.collateral,
        to: params.to,
        amount: params.amount,
        salt,
        signature: signed.signature,
        ...(params.label !== undefined ? { label: params.label } : {}),
        ...(params.referenceId !== undefined ? { reference_id: params.referenceId } : {})
      }
    });
  }

  async registerBuilder(name: string): Promise<{ success: boolean; builder_id: string }> {
    return this.request("POST", "/builder/register", { auth: true, body: { name } });
  }

  async updateBuilderProfile(name: string): Promise<{ success: boolean; builder_id: string }> {
    return this.request("POST", "/builder/profile", { auth: true, body: { name } });
  }

  async approveBuilder(params: {
    builderId: string;
    maxFeeRate?: string;
    maxFeeBps?: string;
    nonce?: string | number | bigint;
  }): Promise<AevoSuccess> {
    const walletKey = this.requireWalletPrivateKey();
    const account = this.requireWalletAddress();
    const maxFeeRate = oneOfRateOrBps({
      rate: params.maxFeeRate,
      bps: params.maxFeeBps,
      fieldName: "maxFee"
    });
    const nonce = params.nonce ?? Date.now();
    const signed = signApproveBuilder(this.env, walletKey, {
      account,
      builderId: params.builderId,
      maxFeeRate,
      nonce
    });
    return this.submitApproveBuilder({
      builderId: params.builderId,
      maxFeeRate,
      nonce,
      signature: signed.signature,
      account
    });
  }

  async submitApproveBuilder(params: {
    builderId: string;
    maxFeeRate: string;
    nonce: string | number | bigint;
    signature: string;
    account: string;
  }): Promise<AevoSuccess> {
    const builderId = requireString(params.builderId, "builderId", "INVALID_ARGUMENT");
    const signature = requireString(params.signature, "signature", "INVALID_ARGUMENT");
    const account = normalizeAccount(params.account);
    const maxFeeRate = normalizeDecimal6(params.maxFeeRate, "maxFee");
    const nonce = uintString(params.nonce, "nonce");
    return this.request("POST", "/builder/approve", {
      auth: this.hasApiCredentials(),
      body: {
        builder_id: builderId,
        max_fee_rate: maxFeeRate,
        nonce,
        signature,
        account
      }
    });
  }

  async approveBuilderWithSigner(
    signer: ApproveBuilderSigner,
    params: {
      builderId: string;
      maxFeeRate?: string;
      maxFeeBps?: string;
      nonce?: string | number | bigint;
      account?: string;
    }
  ): Promise<AevoSuccess> {
    const account = await signerAccount(signer, params.account);
    const maxFeeRate = oneOfRateOrBps({
      rate: params.maxFeeRate,
      bps: params.maxFeeBps,
      fieldName: "maxFee"
    });
    const typedData = getApproveBuilderTypedData({
      env: this.env,
      account,
      builderId: params.builderId,
      maxFeeRate,
      ...(params.nonce !== undefined ? { nonce: params.nonce } : {})
    });
    const signature = await signApproveBuilderTypedData(signer, typedData);
    return this.submitApproveBuilder({
      builderId: params.builderId,
      maxFeeRate,
      nonce: typedData.message.nonce,
      signature,
      account
    });
  }

  async revokeBuilder(builderId: string): Promise<AevoSuccess> {
    return this.request("POST", "/builder/revoke", { auth: true, body: { builder_id: builderId } });
  }

  async builderApprovals(): Promise<BuilderApproval[]> {
    return this.request("GET", "/account/builder-approvals", { auth: true });
  }

  async builderApproval(account: string): Promise<BuilderApproval> {
    return this.request("GET", "/builder/approval", { auth: true, query: { account: getAddress(account) } });
  }

  async builderStats(params: BuilderStatsParams = {}): Promise<Record<string, unknown>> {
    return this.builderReport("stats", params);
  }

  async builderMarkets(params: BuilderReportParams = {}): Promise<Record<string, unknown>> {
    return this.builderReport("markets", params);
  }

  async builderUsers(params: BuilderReportParams = {}): Promise<Record<string, unknown>> {
    this.assertNoCursorOffset(params);
    return this.builderReport("users", params);
  }

  async builderFills(params: BuilderReportParams = {}): Promise<Record<string, unknown>> {
    this.assertNoCursorOffset(params);
    return this.builderReport("fills", params);
  }

  async downloadBuilderFillsCsv(
    params: Pick<BuilderReportParams, "start" | "end" | "instrument"> = {}
  ): Promise<string> {
    return this.requestText("GET", "/builder/fills", {
      auth: true,
      query: {
        start_time: params.start,
        end_time: params.end,
        instrument: params.instrument,
        format: "csv"
      }
    });
  }

  createSignedOrderPayload(params: CreateOrderParams): SignedOrderPayload {
    const signingKey = this.requireSigningKey();
    const maker = getAddress(params.maker ?? this.requireWalletAddress());
    return buildSignedOrderPayload(this.env, signingKey, maker, params);
  }

  private async builderReport(report: string, params: BuilderReportParams | BuilderStatsParams) {
    return this.request<Record<string, unknown>>("GET", `/builder/${report}`, {
      auth: true,
      query: {
        period: params.period,
        start_time: params.start,
        end_time: params.end,
        instrument: params.instrument,
        limit: "limit" in params ? params.limit : undefined,
        offset: "offset" in params ? params.offset : undefined,
        cursor: "cursor" in params ? params.cursor : undefined
      }
    });
  }

  private assertNoCursorOffset(params: BuilderReportParams): void {
    if (params.cursor !== undefined && params.offset !== undefined) {
      throw new AevoValueError("INVALID_ARGUMENT", "pass either cursor or offset, not both");
    }
  }

  private requireSigningKey(): string {
    if (this.signingKey === undefined) {
      throw new AevoValueError("MISSING_CREDENTIALS", "signingKey is required");
    }
    return this.signingKey;
  }

  private requireWalletPrivateKey(): string {
    if (this.walletPrivateKey === undefined) {
      throw new AevoValueError("MISSING_CREDENTIALS", "walletPrivateKey is required");
    }
    return this.walletPrivateKey;
  }

  private requireWalletAddress(): string {
    if (this.walletAddress === undefined) {
      throw new AevoValueError("MISSING_CREDENTIALS", "walletAddress or walletPrivateKey is required");
    }
    return this.walletAddress;
  }

  private requireApiCredentials(): { key: string; secret: string } {
    if (this.apiKey === undefined || this.apiSecret === undefined) {
      throw new AevoValueError("MISSING_CREDENTIALS", "apiKey and apiSecret are required");
    }
    return { key: this.apiKey, secret: this.apiSecret };
  }

  private hasApiCredentials(): boolean {
    return this.apiKey !== undefined && this.apiSecret !== undefined;
  }

  private async request<T = JsonValue>(
    method: string,
    path: string,
    options: { query?: QueryParams; body?: Body; auth?: boolean } = {}
  ): Promise<T> {
    const text = await this.requestText(method, path, options);
    if (text === "") {
      return undefined as T;
    }
    return JSON.parse(text) as T;
  }

  private async requestText(
    method: string,
    path: string,
    options: { query?: QueryParams; body?: Body; auth?: boolean } = {}
  ): Promise<string> {
    const requestPath = appendQuery(path, options.query);
    const body = options.body === undefined ? undefined : compactJson(options.body);
    const headers: Record<string, string> = {
      accept: "application/json"
    };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (options.auth === true) {
      const { key, secret } = this.requireApiCredentials();
      if (this.authMode === "headers") {
        headers["AEVO-KEY"] = key;
        headers["AEVO-SECRET"] = secret;
      } else {
        const timestamp = unixTimestampNanoseconds();
        const signed = generateHmacSignature({
          key,
          secret,
          timestamp,
          method,
          path,
          ...(body !== undefined ? { body } : {})
        });
        headers["AEVO-KEY"] = key;
        headers["AEVO-TIMESTAMP"] = timestamp;
        headers["AEVO-SIGNATURE"] = signed.signature;
      }
    }
    const init: RequestInit = {
      method,
      headers
    };
    if (body !== undefined) {
      init.body = body;
    }
    const response = await this.fetchImpl(`${this.baseUrl}${requestPath}`, init);
    const responseText = await response.text();
    if (!response.ok) {
      let parsed: unknown = responseText;
      try {
        parsed = responseText === "" ? undefined : JSON.parse(responseText);
      } catch {
        parsed = responseText;
      }
      throw new AevoApiError({
        status: response.status,
        code: bodyErrorCode(parsed),
        message: bodyMessage(parsed, response.statusText),
        body: parsed
      });
    }
    return responseText;
  }
}
