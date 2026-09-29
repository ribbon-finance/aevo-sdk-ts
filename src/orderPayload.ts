import type { AevoEnv } from "./config.js";
import { makeSalt, signOrder } from "./signing.js";
import type { CreateOrderParams, SignedOrderPayload } from "./types.js";
import { oneOfRateOrBps } from "./units.js";

export function createSignedOrderPayload(
  env: AevoEnv,
  signingKey: string,
  maker: string,
  params: CreateOrderParams
): SignedOrderPayload {
  const salt = params.salt ?? makeSalt();
  const timestamp = params.timestamp ?? Math.floor(Date.now() / 1000).toString();
  const builderFeeRate =
    params.builder === undefined
      ? undefined
      : oneOfRateOrBps({
          rate: params.builder.builderFeeRate,
          bps: params.builder.builderFeeBps,
          fieldName: "builderFee"
        });
  const signed = signOrder(env, signingKey, {
    maker,
    isBuy: params.isBuy,
    limitPrice: params.limitPrice,
    amount: params.amount,
    salt,
    instrument: params.instrument,
    timestamp,
    ...(params.builder !== undefined
      ? { builderId: params.builder.builderId, builderFeeRate: builderFeeRate as string }
      : {})
  });
  const payload: SignedOrderPayload = {
    instrument: params.instrument,
    maker,
    is_buy: params.isBuy,
    amount: params.amount,
    limit_price: params.limitPrice,
    salt,
    signature: signed.signature,
    timestamp
  };
  if (params.postOnly !== undefined) payload.post_only = params.postOnly;
  if (params.reduceOnly !== undefined) payload.reduce_only = params.reduceOnly;
  if (params.timeInForce !== undefined) payload.time_in_force = params.timeInForce;
  if (params.mmp !== undefined) payload.mmp = params.mmp;
  if (params.stop !== undefined) payload.stop = params.stop;
  if (params.trigger !== undefined) payload.trigger = params.trigger;
  if (params.closePosition !== undefined) payload.close_position = params.closePosition;
  if (params.partialPosition !== undefined) payload.partial_position = params.partialPosition;
  if (params.parentOrderId !== undefined) payload.parent_order_id = params.parentOrderId;
  if (params.selfTradePrevention !== undefined) {
    payload.self_trade_prevention = params.selfTradePrevention;
  }
  if (params.builder !== undefined) {
    payload.builder_id = params.builder.builderId;
    payload.builder_fee_rate = builderFeeRate as string;
  }
  return payload;
}
