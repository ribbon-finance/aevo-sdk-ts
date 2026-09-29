# aevo-sdk-ts

Official TypeScript SDK for [Aevo](https://aevo.xyz).

> **Status: pre-release, unpublished.** The package name is `@aevo/sdk` and the repo is configured for npm, but this build has not been published.

## Install

```bash
npm install @aevo/sdk
```

For local development in this repo:

```bash
npm install
npm run build
npm test
```

## Development

CI runs the same package checks documented in [CONTRIBUTING.md](CONTRIBUTING.md): install, build, typecheck, tests, coverage thresholds, package dry-run, and production dependency audit. See [RELEASING.md](RELEASING.md) for the tag-driven release flow.

## Versioning

The SDK follows semver. While the package is `0.x`, minor versions may include breaking changes and patch versions are reserved for backwards-compatible fixes.

## Quick Start

```ts
import { AevoClient, toRaw6 } from "@aevo/sdk";

const aevo = new AevoClient({
  env: "testnet",
  apiKey: process.env.AEVO_API_KEY,
  apiSecret: process.env.AEVO_API_SECRET,
  walletPrivateKey: process.env.WALLET_PRIVATE_KEY,
  signingKey: process.env.AEVO_SIGNING_KEY
});

const markets = await aevo.markets({ asset: "ETH" });

const order = await aevo.createOrder({
  instrument: markets[0].instrument_id!,
  isBuy: true,
  amount: toRaw6("1"),
  limitPrice: toRaw6("2500"),
  postOnly: false
});
```

## Configuration

```ts
new AevoClient({
  env: "mainnet" | "testnet",
  apiKey,
  apiSecret,
  signingKey,
  walletPrivateKey,
  walletAddress,
  fetch,
  baseUrl,
  wsUrl,
  authMode: "headers" | "hmac"
});
```

Default URLs:

| Env | REST | WebSocket |
| --- | --- | --- |
| mainnet | `https://api.aevo.xyz` | `wss://ws.aevo.xyz` |
| testnet | `https://api-testnet.aevo.xyz` | `wss://ws-testnet.aevo.xyz` |

## Signing And Units

All signing helpers are exported and covered by generated exchange vectors in `test/vectors/vectors.json`.

```ts
import { bpsToRate, rateToRaw, signOrder, toRaw6 } from "@aevo/sdk";

toRaw6("12.345678"); // "12345678"
bpsToRate("3"); // "0.0003"
rateToRaw("0.0003"); // "300"
```

Money helpers accept decimal strings only. JS numbers/floats, negatives, scientific notation, and values with more than 6 decimal places are rejected.

## REST Methods

Public:

`markets`, `instrument`, `orderbook`, `index`, `time`, `builderConfig`, `builderProfile`.

Authenticated:

`account`, `portfolio`, `positions`, `getOrders`, `createOrder`, `editOrder`, `cancelOrder`, `cancelAllOrders`, `batchCreateOrders`, `batchCancelOrders`, `tradeHistory`, `register`, `withdraw`, `transfer`.

Builder:

`registerBuilder`, `updateBuilderProfile`, `approveBuilder`, `revokeBuilder`, `builderApprovals`, `builderApproval`, `builderStats`, `builderMarkets`, `builderUsers`, `builderFills`, `downloadBuilderFillsCsv`.

## Builder Orders

```ts
await aevo.approveBuilder({
  builderId: "builder_0123456789abcdef",
  maxFeeBps: "5"
});

await aevo.createOrder({
  instrument: 1,
  isBuy: true,
  amount: toRaw6("1"),
  limitPrice: toRaw6("2500"),
  builder: {
    builderId: "builder_0123456789abcdef",
    builderFeeBps: "3"
  }
});
```

Builder order signatures include `builderId` and raw `builderFeeRate` exactly as the backend expects.

## WebSocket

```ts
import { AevoWebSocketClient } from "@aevo/sdk";

const ws = new AevoWebSocketClient({
  env: "testnet",
  apiKey,
  apiSecret,
  signingKey,
  walletPrivateKey
});

await ws.connect();
ws.auth();
ws.subscribeOrderbook("ETH-PERP");
ws.on("message", console.log);
```

Reconnect is not implemented; callers should recreate the client or call `connect()` again after `close`.

## Errors

Non-2xx REST responses throw `AevoApiError`:

```ts
import { AevoApiError } from "@aevo/sdk";

try {
  await aevo.createOrder(order);
} catch (error) {
  if (error instanceof AevoApiError) {
    console.log(error.status, error.code, error.body);
  }
}
```

Known builder codes are exported as the `BuilderErrorCode` union, including `BUILDER_FEE_EXCEEDS_USER_LIMIT`.

## Builder E2E Example

`examples/builder-e2e.ts` mirrors the backend builder fresh-account script. It is dry-run by default and only sends transactions with `SEND=1`.

## Sibling SDKs

| Language | Repository |
| --- | --- |
| Python | [aevoxyz/aevo-sdk](https://github.com/aevoxyz/aevo-sdk) |
| TypeScript | [ribbon-finance/aevo-sdk-ts](https://github.com/ribbon-finance/aevo-sdk-ts) (this repo) |
| Rust | [ribbon-finance/aevo-sdk-rust](https://github.com/ribbon-finance/aevo-sdk-rust) |

## License

MIT. Copyright (c) 2026 Aevo. See [LICENSE](LICENSE).
