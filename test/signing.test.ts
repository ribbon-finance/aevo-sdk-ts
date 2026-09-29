import { describe, expect, it } from "vitest";
import vectors from "./vectors/vectors.json";
import {
  generateHmacSignature,
  signApproveBuilder,
  signOrder,
  signRegister,
  signSignKey,
  signTransfer,
  signWithdraw
} from "../src/index.js";

type VectorKey = (typeof vectors.keys)[number];
type Domain = (typeof vectors.domains)[number];

const keys = new Map<string, VectorKey>(vectors.keys.map((key) => [key.id, key]));

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
