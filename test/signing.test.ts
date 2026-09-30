import { describe, expect, it } from "vitest";
import { TypedDataEncoder, Wallet } from "ethers";
import vectors from "./vectors/vectors.json";
import {
  AevoValueError,
  generateHmacSignature,
  getApproveBuilderTypedData,
  signApproveBuilder,
  signOrder,
  signRegister,
  signSignKey,
  signTransfer,
  signWithdraw
} from "../src/index.js";

type VectorKey = (typeof vectors.keys)[number];
type Domain = (typeof vectors.domains)[number];
type EthersTypes = Record<string, Array<{ name: string; type: string }>>;

const EXPECTED_DOMAINS = ["mainnet", "testnet"];
const EXPECTED_VECTOR_KINDS = [
  "approve_builder",
  "order_builder",
  "order_plain",
  "register",
  "sign_key",
  "transfer",
  "withdraw"
];

const keys = new Map<string, VectorKey>(vectors.keys.map((key) => [key.id, key]));
const walletAddressForVectors = keys.get("wallet")!.address;

function key(id: string): string {
  const found = keys.get(id);
  if (found === undefined) {
    throw new Error(`missing key ${id}`);
  }
  return found.private_key;
}

function rawRateToDecimal(raw: string): string {
  const value = BigInt(raw);
  const scale = 1_000_000n;
  const whole = value / scale;
  const fraction = value % scale;
  if (fraction === 0n) {
    return whole.toString();
  }
  return `${whole.toString()}.${fraction.toString().padStart(6, "0").replace(/0+$/, "")}`;
}

function domainId(domain: Domain): "mainnet" | "testnet" {
  return domain.id as "mainnet" | "testnet";
}

function ethersTypes(types: Record<string, readonly { name: string; type: string }[]>): EthersTypes {
  return Object.fromEntries(
    Object.entries(types)
      .filter(([name]) => name !== "EIP712Domain")
      .map(([name, fields]) => [name, [...fields]])
  ) as EthersTypes;
}

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AevoValueError);
    return (error as AevoValueError).code;
  }
  throw new Error("expected an AevoValueError");
}

describe("vector fixture shape", () => {
  it("contains every expected vector kind for each signing domain", () => {
    expect(vectors.domains.map((domain) => domain.id).sort()).toEqual(EXPECTED_DOMAINS);

    for (const domain of vectors.domains) {
      const domainVectors = domain.vectors as Record<string, unknown>;
      expect(Object.keys(domainVectors).sort()).toEqual(EXPECTED_VECTOR_KINDS);

      for (const kind of EXPECTED_VECTOR_KINDS) {
        const bucket = domainVectors[kind];
        expect(Array.isArray(bucket), `${domain.id}.${kind} must be an array`).toBe(true);
        expect((bucket as unknown[]).length, `${domain.id}.${kind} must not be empty`).toBeGreaterThan(0);
      }
    }
  });

  it("contains both REST and websocket HMAC vectors", () => {
    expect(vectors.hmac.rest.length).toBeGreaterThan(0);
    expect(vectors.hmac.websocket.length).toBeGreaterThan(0);
  });
});

describe("signing vectors", () => {
  for (const domain of vectors.domains) {
    describe(domain.id, () => {
      for (const vector of domain.vectors.order_plain) {
        it(`signs plain order ${vector.id}`, () => {
          const signed = signOrder(domainId(domain), key(vector.signer_key), {
            maker: vector.api.maker,
            isBuy: vector.api.is_buy,
            limitPrice: vector.api.limit_price,
            amount: vector.api.amount,
            salt: vector.api.salt,
            instrument: vector.api.instrument,
            timestamp: vector.api.timestamp
          });
          expect(signed.digest).toBe(vector.eip712.digest);
          expect(signed.signature).toBe(vector.signature);
        });
      }

      for (const vector of domain.vectors.order_builder) {
        it(`signs builder order ${vector.id}`, () => {
          const signed = signOrder(domainId(domain), key(vector.signer_key), {
            maker: vector.api.maker,
            isBuy: vector.api.is_buy,
            limitPrice: vector.api.limit_price,
            amount: vector.api.amount,
            salt: vector.api.salt,
            instrument: vector.api.instrument,
            timestamp: vector.api.timestamp,
            builderId: vector.api.builder_id,
            builderFeeRate: vector.api.builder_fee_rate
          });
          expect(signed.digest).toBe(vector.eip712.digest);
          expect(signed.signature).toBe(vector.signature);
        });
      }

      for (const vector of domain.vectors.register) {
        it(`signs register ${vector.id}`, () => {
          const signed = signRegister(domainId(domain), key(vector.signer_key), {
            key: vector.message.key,
            expiry: vector.message.expiry,
            hashedKey: vector.variant === "hashed_key"
          });
          expect(signed.digest).toBe(vector.eip712.digest);
          expect(signed.signature).toBe(vector.signature);
          expect(signed.personalSignature).toBe(vector.personal_signature);
        });
      }

      for (const vector of domain.vectors.sign_key) {
        it(`signs sign-key ${vector.id}`, () => {
          const signed = signSignKey(domainId(domain), key(vector.signer_key), vector.message);
          expect(signed.digest).toBe(vector.eip712.digest);
          expect(signed.signature).toBe(vector.signature);
        });
      }

      for (const vector of domain.vectors.approve_builder) {
        it(`signs approve-builder ${vector.id}`, () => {
          const signed = signApproveBuilder(domainId(domain), key(vector.signer_key), {
            account: vector.message.account,
            builderId: vector.message.builderId,
            maxFeeRate: rawRateToDecimal(vector.message.maxFeeRate),
            nonce: vector.message.nonce
          });
          expect(signed.digest).toBe(vector.eip712.digest);
          expect(signed.signature).toBe(vector.signature);
        });

        it(`builds approve-builder typed data ${vector.id}`, async () => {
          const typedData = getApproveBuilderTypedData({
            env: domainId(domain),
            account: vector.message.account,
            builderId: vector.message.builderId,
            maxFeeRate: rawRateToDecimal(vector.message.maxFeeRate),
            nonce: vector.message.nonce
          });
          const types = ethersTypes(typedData.types);

          expect(typedData.primaryType).toBe("ApproveBuilder");
          expect(typedData.message).toEqual(vector.message);
          expect(TypedDataEncoder.hash(typedData.domain, types, typedData.message)).toBe(
            vector.eip712.digest
          );
          await expect(new Wallet(key(vector.signer_key)).signTypedData(typedData.domain, types, typedData.message))
            .resolves.toBe(vector.signature);

          const ethSignTypedDataV4 = getApproveBuilderTypedData({
            env: domainId(domain),
            account: vector.message.account,
            builderId: vector.message.builderId,
            maxFeeRate: rawRateToDecimal(vector.message.maxFeeRate),
            nonce: vector.message.nonce,
            includeEip712Domain: true
          });
          expect(ethSignTypedDataV4.types.EIP712Domain).toEqual([
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" }
          ]);
          expect(TypedDataEncoder.hash(ethSignTypedDataV4.domain, ethersTypes(ethSignTypedDataV4.types), ethSignTypedDataV4.message)).toBe(
            vector.eip712.digest
          );
        });
      }

      for (const vector of domain.vectors.withdraw) {
        it(`signs withdraw ${vector.id}`, () => {
          const signed = signWithdraw(domainId(domain), key(vector.signer_key), {
            collateral: vector.api.collateral,
            to: vector.api.to,
            amount: vector.api.amount,
            salt: vector.api.salt,
            data: vector.api.data
          });
          expect(signed.digest).toBe(vector.eip712.digest);
          expect(signed.signature).toBe(vector.signature);
          expect(signed.personalSignature).toBe(vector.personal_signature);
        });
      }

      for (const vector of domain.vectors.transfer) {
        it(`signs transfer ${vector.id}`, () => {
          const signed = signTransfer(domainId(domain), key(vector.signer_key), vector.api);
          expect(signed.digest).toBe(vector.eip712.digest);
          expect(signed.signature).toBe(vector.signature);
          expect(signed.personalSignature).toBe(vector.personal_signature);
        });
      }
    });
  }
});

describe("approve-builder typed data validation", () => {
  it("reports AevoValueError codes for bad inputs", () => {
    expect(
      errorCode(() =>
        getApproveBuilderTypedData({
          env: "testnet",
          account: walletAddressForVectors,
          builderId: "builder-alpha",
          maxFeeRate: 0.1 as unknown as string
        })
      )
    ).toBe("UNSAFE_NUMBER");
    expect(
      errorCode(() =>
        getApproveBuilderTypedData({
          env: "testnet",
          account: walletAddressForVectors,
          builderId: "builder-alpha",
          maxFeeRate: "0.0000001"
        })
      )
    ).toBe("TOO_MANY_DECIMALS");
    expect(
      errorCode(() =>
        getApproveBuilderTypedData({
          env: "testnet",
          account: undefined as unknown as string,
          builderId: "builder-alpha",
          maxFeeRate: "0.0003"
        })
      )
    ).toBe("MISSING_CREDENTIALS");
  });
});

describe("HMAC vectors", () => {
  for (const vector of vectors.hmac.rest) {
    it(`matches REST HMAC ${vector.id}`, () => {
      const signed = generateHmacSignature({
        key: vector.key,
        secret: vector.secret,
        timestamp: vector.timestamp,
        method: vector.method,
        path: vector.request_target,
        body: vector.body
      });
      expect(signed.canonicalString).toBe(vector.canonical_string);
      expect(signed.signature).toBe(vector.signature);
    });
  }

  for (const vector of vectors.hmac.websocket) {
    it(`matches websocket HMAC ${vector.id}`, () => {
      const signed = generateHmacSignature({
        key: vector.key,
        secret: vector.secret,
        timestamp: vector.timestamp,
        method: vector.method,
        path: vector.request_target,
        body: vector.body
      });
      expect(signed.canonicalString).toBe(vector.canonical_string);
      expect(signed.signature).toBe(vector.signature);
    });
  }
});
