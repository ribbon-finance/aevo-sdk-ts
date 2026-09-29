export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type MaybePromise<T> = T | Promise<T>;

export type StringRecord = Record<string, string>;

export interface AevoSuccess {
  success: boolean;
}

export interface PublicMarket {
  instrument_id?: string | number;
  instrument_name?: string;
  instrument_type?: string;
  asset?: string;
  [key: string]: unknown;
}

export interface OrderResponse {
  order_id: string;
  account?: string;
  instrument_id?: string;
  instrument_name?: string;
  builder_id?: string;
  builder_fee_rate?: string;
  [key: string]: unknown;
}

export interface RegisterResponse {
  success: boolean;
  signing_keys?: Array<{
    signing_key: string;
    expiry: string;
    created_timestamp: string;
  }>;
  api_key?: string;
  api_secret?: string;
  read_only?: boolean;
  [key: string]: unknown;
}

export type BuilderErrorCode =
  | "BUILDER_NOT_APPROVED"
  | "BUILDER_FEE_EXCEEDS_USER_LIMIT"
  | "BUILDER_FEE_EXCEEDS_AEVO_LIMIT"
  | "BUILDER_NOT_ACTIVE"
  | "BUILDER_NOT_SUPPORTED"
  | "BUILDER_INVALID_FEE_RATE"
  | "BUILDER_INVALID_ID"
  | "BUILDER_NOT_FOUND"
  | "BUILDER_INVALID_SIGNATURE"
  | "BUILDER_INVALID_NONCE"
  | "BUILDER_CURSOR_WITH_OFFSET"
  | "CSV_RANGE_TOO_LARGE";

export interface BuilderConfig {
  max_fee_rate_perps: string | null;
  min_create_balance: string | null;
  max_fee_rate_options: string | null;
  option_premium_cap: string | null;
}

export interface BuilderProfile {
  builder_id: string;
  name?: string;
  status?: "ACTIVE" | "SUSPENDED" | "DISABLED" | string;
  [key: string]: unknown;
}

export interface BuilderApproval {
  account?: string;
  builder_id: string;
  builder_name?: string;
  max_fee_rate?: string;
  approved?: boolean;
  [key: string]: unknown;
}

export interface BuilderReportParams {
  period?: "24h" | "7d" | "30d" | "90d";
  start?: string | number | bigint;
  end?: string | number | bigint;
  instrument?: string;
  limit?: number;
  offset?: number;
  cursor?: string;
}

export interface BuilderStatsParams {
  period?: "24h" | "7d" | "30d" | "90d";
  start?: string | number | bigint;
  end?: string | number | bigint;
  instrument?: string;
}

export interface BuilderOrderAttribution {
  builderId: string;
  builderFeeRate?: string;
  builderFeeBps?: string;
}

export interface CreateOrderParams {
  instrument: string | number;
  maker?: string;
  isBuy: boolean;
  amount: string;
  limitPrice: string;
  salt?: string;
  timestamp?: string | number;
  postOnly?: boolean;
  reduceOnly?: boolean;
  timeInForce?: "GTC" | "IOC" | string;
  mmp?: boolean;
  stop?: string;
  trigger?: string;
  closePosition?: boolean;
  partialPosition?: boolean;
  parentOrderId?: string;
  selfTradePrevention?: string;
  builder?: BuilderOrderAttribution;
}

export interface SignedOrderPayload {
  instrument: string | number;
  maker: string;
  is_buy: boolean;
  amount: string;
  limit_price: string;
  salt: string;
  signature: string;
  timestamp: string | number;
  post_only?: boolean;
  reduce_only?: boolean;
  time_in_force?: string;
  mmp?: boolean;
  stop?: string;
  trigger?: string;
  close_position?: boolean;
  partial_position?: boolean;
  parent_order_id?: string;
  self_trade_prevention?: string;
  builder_id?: string;
  builder_fee_rate?: string;
}

export interface WithdrawParams {
  account?: string;
  collateral: string;
  to: string;
  amount: string;
  salt?: string;
  data?: string;
  recipient?: string;
  socketFees?: string;
  socketMsgGasLimit?: string;
  socketConnector?: string;
}

export interface TransferParams {
  account?: string;
  collateral: string;
  to: string;
  amount: string;
  salt?: string;
  label?: string;
  referenceId?: string;
}
