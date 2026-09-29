import { Wallet } from "ethers";
import {
  AevoClient,
  bpsToRate,
  signApproveBuilder,
  signRegister,
  signSignKey,
  toRaw6,
  walletAddress,
  type AevoEnv
} from "../src/index.js";

const SEND = process.env.SEND === "1";
const env = (process.env.AEVO_ENV ?? "testnet") as AevoEnv;
const builderApiKey = requiredEnv("BUILDER_API_KEY");
const builderApiSecret = requiredEnv("BUILDER_API_SECRET");
const builderName = process.env.BUILDER_NAME ?? "TypeScript SDK Builder";
const builderIdFromEnv = process.env.BUILDER_ID;
const maxFeeRate = process.env.MAX_FEE_RATE ?? bpsToRate("5");
const builderFeeRate = process.env.BUILDER_FEE_RATE ?? bpsToRate("3");
const instrument = process.env.INSTRUMENT_ID ?? "1";
const side = (process.env.SIDE ?? "buy").toLowerCase();
const amountRaw = process.env.AMOUNT_RAW ?? toRaw6(process.env.AMOUNT ?? "0.01");
const limitPriceRaw = process.env.LIMIT_PRICE_RAW ?? toRaw6(process.env.LIMIT_PRICE ?? "2500");
const signingKeyDays = Number(process.env.SIGNING_KEY_DAYS ?? "30");

if (side !== "buy" && side !== "sell") {
  throw new Error("SIDE must be buy or sell");
}

async function main() {
  const builder = new AevoClient({
    env,
    apiKey: builderApiKey,
    apiSecret: builderApiSecret
  });

  console.log(`env=${env} mode=${SEND ? "SEND=1" : "dry-run"}\n`);
  console.log("1. Read builder config");
  console.log(await builder.builderConfig());

  console.log("\n2. Find or register builder");
  let builderId = builderIdFromEnv;
  if (builderId === undefined && SEND) {
    try {
      const stats = await builder.builderStats({ period: "24h" });
      builderId = String(stats.builder_id);
      console.log(`existing builder_id=${builderId}`);
    } catch (error) {
      console.log(`no existing builder found; registering ${builderName}`);
      const registered = await builder.registerBuilder(builderName);
      builderId = registered.builder_id;
    }
  }
  builderId ??= "builder_<set BUILDER_ID or run with SEND=1>";
  console.log(`builder_id=${builderId}`);

  console.log("\n3. Prepare fresh wallet and signing key");
  const freshWallet = new Wallet(process.env.FRESH_WALLET_KEY ?? Wallet.createRandom().privateKey);
  const signingWallet = new Wallet(process.env.FRESH_SIGNING_KEY ?? Wallet.createRandom().privateKey);
  const expiry = Math.floor(Date.now() / 1000) + signingKeyDays * 24 * 60 * 60;
  console.log(`wallet=${freshWallet.address}`);
  console.log(`signing_key=${signingWallet.address}`);

  const user = new AevoClient({
    env,
    walletPrivateKey: freshWallet.privateKey,
    signingKey: signingWallet.privateKey,
    apiKey: process.env.USER_API_KEY,
    apiSecret: process.env.USER_API_SECRET
  });

  const registerPayload = {
    account: freshWallet.address,
    signing_key: signingWallet.address,
    expiry: expiry.toString(),
    account_signature: signRegister(env, freshWallet.privateKey, {
      key: signingWallet.address,
      expiry
    }).signature,
    signing_key_signature: signSignKey(env, signingWallet.privateKey, {
      account: freshWallet.address
    }).signature
  };
  console.log("\n4. Register account payload");
  console.log(registerPayload);

  let userKey = process.env.USER_API_KEY;
  let userSecret = process.env.USER_API_SECRET;
  if (SEND && (userKey === undefined || userSecret === undefined)) {
    const registered = await user.register({
      signingKey: signingWallet.privateKey,
      expiry
    });
    userKey = registered.api_key;
    userSecret = registered.api_secret;
    console.log(`registered api_key=${userKey}`);
  }

  const authedUser = new AevoClient({
    env,
    walletPrivateKey: freshWallet.privateKey,
    signingKey: signingWallet.privateKey,
    apiKey: userKey,
    apiSecret: userSecret
  });

  console.log("\n5. Approve builder payload");
  const nonce = Date.now();
  const approvalSignature = signApproveBuilder(env, freshWallet.privateKey, {
    account: freshWallet.address,
    builderId,
    maxFeeRate,
    nonce
  }).signature;
  console.log({
    builder_id: builderId,
    max_fee_rate: maxFeeRate,
    nonce: nonce.toString(),
    signature: approvalSignature
  });
  if (SEND) {
    await authedUser.approveBuilder({ builderId, maxFeeRate, nonce });
  }

  console.log("\n6. Optional testnet faucet");
  if (SEND && env === "testnet" && process.env.FUND !== "none") {
    await faucet(authedUser);
  } else {
    console.log("skipped");
  }

  console.log("\n7. Builder-attributed order payload");
  const order = authedUser.createSignedOrderPayload({
    maker: walletAddress(freshWallet.privateKey),
    instrument,
    isBuy: side === "buy",
    limitPrice: limitPriceRaw,
    amount: amountRaw,
    postOnly: false,
    timeInForce: "IOC",
    builder: {
      builderId,
      builderFeeRate
    }
  });
  console.log(order);
  if (SEND) {
    const response = await authedUser.createOrder({
      instrument,
      isBuy: side === "buy",
      limitPrice: limitPriceRaw,
      amount: amountRaw,
      postOnly: false,
      timeInForce: "IOC",
      builder: {
        builderId,
        builderFeeRate
      }
    });
    console.log(response);
  }

  console.log("\n8. Verify");
  console.log(
    SEND
      ? "Check tradeHistory(), builderFills(), and the builder account balance after the fill settles."
      : "Dry-run only. Re-run with SEND=1 after funding credentials are set."
  );
}

async function faucet(client: AevoClient) {
  if (client.apiKey === undefined || client.apiSecret === undefined) {
    throw new Error("USER_API_KEY/USER_API_SECRET or a successful registration is required for faucet");
  }
  const response = await fetch(`${client.baseUrl}/faucet`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "AEVO-KEY": client.apiKey,
      "AEVO-SECRET": client.apiSecret
    },
    body: "{}"
  });
  if (!response.ok) {
    throw new Error(`faucet failed: ${response.status} ${await response.text()}`);
  }
  console.log(await response.text());
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
