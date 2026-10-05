export { AevoClient } from "./client.js";
export { AevoWebSocketClient } from "./ws.js";
export type {
  AevoWebSocketClientOptions,
  AevoWsMessage,
  AevoWsOperation,
  AevoWsRequest,
  WebSocketFactory,
  WebSocketLike
} from "./ws.js";
export type { AevoClientOptions, AevoEnv, AuthMode, AevoEnvironmentConfig } from "./config.js";
export { AEVO_ENVIRONMENTS, environmentConfig } from "./config.js";
export { AevoApiError, AevoSdkError, AevoValueError } from "./errors.js";
export {
  bpsToRate,
  normalizeDecimal6,
  oneOfRateOrBps,
  rateToRaw,
  toRaw6
} from "./units.js";
export {
  getApproveBuilderTypedData,
  hashWithdrawData,
  makeSalt,
  orderMessage,
  signApproveBuilder,
  signOrder,
  signRegister,
  signSignKey,
  signTransfer,
  signWithdraw,
  walletAddress
} from "./signing.js";
export type {
  AevoSigningDomain,
  ApproveBuilderTypedData,
  ApproveBuilderTypedDataMessage,
  ApproveBuilderTypedDataParams,
  Eip712DomainJson,
  Eip712Field,
  Eip712Types,
  Hex,
  OrderToSign,
  PersonalSigningResult,
  SigningResult
} from "./signing.js";
export type {
  ApproveBuilderSigner,
  EthersTypedDataSigner,
  ViemSignTypedDataArgs,
  ViemTypedDataSigner
} from "./client.js";
export { generateHmacSignature, pathWithoutQuery, unixTimestampNanoseconds } from "./auth.js";
export type {
  AevoSuccess,
  BuilderApproval,
  BuilderConfig,
  BuilderErrorCode,
  BuilderOrderAttribution,
  BuilderProfile,
  BuilderReportParams,
  BuilderStatsParams,
  CreateOrderParams,
  FetchLike,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  OrderResponse,
  PublicMarket,
  RegisterResponse,
  SignedOrderPayload,
  TransferParams,
  WithdrawParams
} from "./types.js";
