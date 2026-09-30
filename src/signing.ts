import {
  getAddress,
  getBytes,
  hashMessage,
  hexlify,
  keccak256,
  randomBytes,
  Signature,
  TypedDataEncoder,
  Wallet
} from "ethers";
import type { AevoEnv } from "./config.js";
import { environmentConfig } from "./config.js";
import { AevoValueError } from "./errors.js";
import { oneOfRateOrBps, rateToRaw } from "./units.js";

export type Hex = `0x${string}`;

export interface SigningResult<TMessage extends Record<string, unknown>> {
  digest: Hex;
  signature: Hex;
  message: TMessage;
}

export interface PersonalSigningResult<TMessage extends Record<string, unknown>>
  extends SigningResult<TMessage> {
  personalDigest: Hex;
  personalSignature: Hex;
}

export interface AevoSigningDomain {
  name: string;
  version: "1";
  chainId: string | number | bigint;
}

export interface Eip712DomainJson {
  name: string;
  version: "1";
  chainId: string | number;
}

export interface Eip712Field {
  name: string;
  type: string;
}

export type Eip712Types = Record<string, readonly Eip712Field[]>;

export interface ApproveBuilderTypedDataMessage {
  [key: string]: string;
  account: string;
  builderId: string;
  maxFeeRate: string;
  nonce: string;
}

export interface ApproveBuilderTypedData {
  domain: Eip712DomainJson;
  types: Eip712Types;
  primaryType: "ApproveBuilder";
  message: ApproveBuilderTypedDataMessage;
}

export interface ApproveBuilderTypedDataParams {
  env?: AevoEnv;
  domain?: AevoSigningDomain;
  account: string;
  builderId: string;
  maxFeeRate?: string;
  maxFeeBps?: string;
  nonce?: string | number | bigint;
  includeEip712Domain?: boolean;
}

const ORDER_TYPES = {
  Order: [
    { name: "maker", type: "address" },
    { name: "isBuy", type: "bool" },
    { name: "limitPrice", type: "uint256" },
    { name: "amount", type: "uint256" },
    { name: "salt", type: "uint256" },
    { name: "instrument", type: "uint256" },
    { name: "timestamp", type: "uint256" }
  ]
} as const;

const BUILDER_ORDER_TYPES = {
  Order: [
    ...ORDER_TYPES.Order,
    { name: "builderId", type: "string" },
    { name: "builderFeeRate", type: "uint256" }
  ]
} as const;

const REGISTER_ADDRESS_TYPES = {
  Register: [
    { name: "key", type: "address" },
    { name: "expiry", type: "uint256" }
  ]
} as const;

const REGISTER_HASHED_TYPES = {
  Register: [
    { name: "key", type: "bytes32" },
    { name: "expiry", type: "uint256" }
  ]
} as const;

const SIGN_KEY_TYPES = {
  SignKey: [{ name: "account", type: "address" }]
} as const;

const EIP712_DOMAIN_TYPES = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" }
] as const;

const APPROVE_BUILDER_TYPES = {
  ApproveBuilder: [
    { name: "account", type: "address" },
    { name: "builderId", type: "string" },
    { name: "maxFeeRate", type: "uint256" },
    { name: "nonce", type: "uint256" }
  ]
} as const;

const WITHDRAW_TYPES = {
  Withdraw: [
    { name: "collateral", type: "address" },
    { name: "to", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "salt", type: "uint256" },
    { name: "data", type: "bytes32" }
  ]
} as const;

const TRANSFER_TYPES = {
  Transfer: [
    { name: "collateral", type: "address" },
    { name: "to", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "salt", type: "uint256" }
  ]
} as const;

function domainFor(envOrDomain: AevoEnv | AevoSigningDomain): AevoSigningDomain {
  if (typeof envOrDomain === "string") {
    return environmentConfig(envOrDomain).signingDomain;
  }
  return envOrDomain;
}

function domainFromParams(params: { env?: AevoEnv; domain?: AevoSigningDomain }): AevoSigningDomain {
  if ((params.env === undefined) === (params.domain === undefined)) {
    throw new AevoValueError("INVALID_ARGUMENT", "pass either env or domain, not both");
  }
  return params.domain ?? environmentConfig(params.env as AevoEnv).signingDomain;
}

function normalizeDomain(domain: AevoSigningDomain) {
  return {
    name: domain.name,
    version: domain.version,
    chainId: BigInt(domain.chainId)
  };
}

function jsonChainId(chainId: string | number | bigint): string | number {
  const text = uintString(chainId, "chainId");
  const value = BigInt(text);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(text) : text;
}

function jsonDomain(domain: AevoSigningDomain): Eip712DomainJson {
  return {
    name: domain.name,
    version: domain.version,
    chainId: jsonChainId(domain.chainId)
  };
}

function signDigest(privateKey: string, digest: string): Hex {
  const signature = new Wallet(privateKey).signingKey.sign(digest);
  return Signature.from(signature).serialized as Hex;
}

function typedDigest(
  envOrDomain: AevoEnv | AevoSigningDomain,
  types: Record<string, readonly { name: string; type: string }[]>,
  message: Record<string, unknown>
): Hex {
  return TypedDataEncoder.hash(
    normalizeDomain(domainFor(envOrDomain)),
    types as unknown as Record<string, Array<{ name: string; type: string }>>,
    message
  ) as Hex;
}

function withSignature<TMessage extends Record<string, unknown>>(
  privateKey: string,
  digest: Hex,
  message: TMessage
): SigningResult<TMessage> {
  return {
    digest,
    signature: signDigest(privateKey, digest),
    message
  };
}

function withPersonalSignature<TMessage extends Record<string, unknown>>(
  privateKey: string,
  digest: Hex,
  message: TMessage
): PersonalSigningResult<TMessage> {
  const personalDigest = hashMessage(getBytes(digest)) as Hex;
  return {
    ...withSignature(privateKey, digest, message),
    personalDigest,
    personalSignature: signDigest(privateKey, personalDigest)
  };
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

function randomSalt(): string {
  return BigInt(hexlify(randomBytes(16))).toString();
}

function requireString(value: unknown, name: string, code: "INVALID_ARGUMENT" | "MISSING_CREDENTIALS"): string {
  if (typeof value !== "string" || value === "") {
    throw new AevoValueError(code, `${name} is required`);
  }
  return value;
}

function approveBuilderMessage(input: {
  account: string;
  builderId: string;
  maxFeeRate: string;
  nonce: string | number | bigint;
}): ApproveBuilderTypedDataMessage {
  return {
    account: getAddress(requireString(input.account, "account", "MISSING_CREDENTIALS")),
    builderId: requireString(input.builderId, "builderId", "INVALID_ARGUMENT"),
    maxFeeRate: rateToRaw(input.maxFeeRate),
    nonce: uintString(input.nonce, "nonce")
  };
}

export interface OrderToSign {
  maker: string;
  isBuy: boolean;
  limitPrice: string | number | bigint;
  amount: string | number | bigint;
  salt: string | number | bigint;
  instrument: string | number | bigint;
  timestamp: string | number | bigint;
  builderId?: string;
  builderFeeRate?: string;
}

export function orderMessage(input: OrderToSign): Record<string, unknown> {
  const message: Record<string, unknown> = {
    maker: getAddress(input.maker),
    isBuy: input.isBuy,
    limitPrice: uintString(input.limitPrice, "limitPrice"),
    amount: uintString(input.amount, "amount"),
    salt: uintString(input.salt, "salt"),
    instrument: uintString(input.instrument, "instrument"),
    timestamp: uintString(input.timestamp, "timestamp")
  };
  if (input.builderId !== undefined) {
    if (input.builderFeeRate === undefined) {
      throw new AevoValueError("INVALID_ARGUMENT", "builderFeeRate is required with builderId");
    }
    message.builderId = input.builderId;
    message.builderFeeRate = rateToRaw(input.builderFeeRate);
  }
  return message;
}

export function signOrder(
  envOrDomain: AevoEnv | AevoSigningDomain,
  privateKey: string,
  input: OrderToSign
): SigningResult<Record<string, unknown>> {
  const message = orderMessage(input);
  const digest = typedDigest(
    envOrDomain,
    input.builderId === undefined ? ORDER_TYPES : BUILDER_ORDER_TYPES,
    message
  );
  return withSignature(privateKey, digest, message);
}

export function signRegister(
  envOrDomain: AevoEnv | AevoSigningDomain,
  walletPrivateKey: string,
  input: { key: string; expiry: string | number | bigint; hashedKey?: boolean }
): PersonalSigningResult<Record<string, unknown>> {
  const message = {
    key: input.hashedKey ? input.key : getAddress(input.key),
    expiry: uintString(input.expiry, "expiry")
  };
  const digest = typedDigest(
    envOrDomain,
    input.hashedKey ? REGISTER_HASHED_TYPES : REGISTER_ADDRESS_TYPES,
    message
  );
  return withPersonalSignature(walletPrivateKey, digest, message);
}

export function signSignKey(
  envOrDomain: AevoEnv | AevoSigningDomain,
  signingPrivateKey: string,
  input: { account: string }
): SigningResult<{ account: string }> {
  const message = { account: getAddress(input.account) };
  const digest = typedDigest(envOrDomain, SIGN_KEY_TYPES, message);
  return withSignature(signingPrivateKey, digest, message);
}

export function signApproveBuilder(
  envOrDomain: AevoEnv | AevoSigningDomain,
  walletPrivateKey: string,
  input: {
    account: string;
    builderId: string;
    maxFeeRate: string;
    nonce: string | number | bigint;
  }
): SigningResult<ApproveBuilderTypedDataMessage> {
  const message = approveBuilderMessage(input);
  const digest = typedDigest(envOrDomain, APPROVE_BUILDER_TYPES, message);
  return withSignature(walletPrivateKey, digest, message);
}

export function getApproveBuilderTypedData(params: ApproveBuilderTypedDataParams): ApproveBuilderTypedData {
  const domain = domainFromParams(params);
  const maxFeeRate = oneOfRateOrBps({
    rate: params.maxFeeRate,
    bps: params.maxFeeBps,
    fieldName: "maxFee"
  });
  const message = approveBuilderMessage({
    account: params.account,
    builderId: params.builderId,
    maxFeeRate,
    nonce: params.nonce ?? Date.now()
  });
  return {
    domain: jsonDomain(domain),
    types:
      params.includeEip712Domain === true
        ? { EIP712Domain: EIP712_DOMAIN_TYPES, ...APPROVE_BUILDER_TYPES }
        : APPROVE_BUILDER_TYPES,
    primaryType: "ApproveBuilder",
    message
  };
}

export function hashWithdrawData(data?: string | Uint8Array): Hex {
  if (data === undefined || data === "") {
    return keccak256("0x") as Hex;
  }
  if (typeof data !== "string") {
    return keccak256(data) as Hex;
  }
  const hex = data.startsWith("0x") ? data : `0x${data}`;
  return keccak256(hex) as Hex;
}

export function signWithdraw(
  envOrDomain: AevoEnv | AevoSigningDomain,
  walletPrivateKey: string,
  input: {
    collateral: string;
    to: string;
    amount: string | number | bigint;
    salt: string | number | bigint;
    data?: string | Uint8Array;
  }
): PersonalSigningResult<Record<string, unknown>> {
  const message = {
    collateral: getAddress(input.collateral),
    to: getAddress(input.to),
    amount: uintString(input.amount, "amount"),
    salt: uintString(input.salt, "salt"),
    data: hashWithdrawData(input.data)
  };
  const digest = typedDigest(envOrDomain, WITHDRAW_TYPES, message);
  return withPersonalSignature(walletPrivateKey, digest, message);
}

export function signTransfer(
  envOrDomain: AevoEnv | AevoSigningDomain,
  walletPrivateKey: string,
  input: {
    collateral: string;
    to: string;
    amount: string | number | bigint;
    salt: string | number | bigint;
  }
): PersonalSigningResult<Record<string, unknown>> {
  const message = {
    collateral: getAddress(input.collateral),
    to: getAddress(input.to),
    amount: uintString(input.amount, "amount"),
    salt: uintString(input.salt, "salt")
  };
  const digest = typedDigest(envOrDomain, TRANSFER_TYPES, message);
  return withPersonalSignature(walletPrivateKey, digest, message);
}

export function walletAddress(privateKey: string): string {
  return new Wallet(privateKey).address;
}

export function makeSalt(): string {
  return randomSalt();
}
