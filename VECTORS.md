# Signing Vectors

The shared vectors live at `test/vectors/vectors.json`.

- SHA-256: `d498458d502223fb3d299b18758992365b3791a4df9f3e16bb6a5f0e3beab6ef`
- Source: `ribbon-finance/exchange-backend`
- Generator: `scripts/sdk-vectors`
- Regenerate from the exchange-backend repo with `go run ./scripts/sdk-vectors`

The fixture must include both `mainnet` and `testnet` domains. Each domain must include these vector kinds:

- `order_plain`
- `order_builder`
- `register`
- `sign_key`
- `approve_builder`
- `withdraw`
- `transfer`

The fixture must also include non-empty REST and websocket HMAC vectors. The vitest suite has a guard that fails when any required domain or vector kind is missing.
