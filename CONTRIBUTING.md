# Contributing

Follow this SDK standard for every change.

## Local Checks

```bash
npm ci
npm run build
npm run typecheck
npm test
npm run test:coverage
npm pack --dry-run
npm audit --omit=dev --audit-level=high
```

## SDK Standard

- Signing must reproduce the shared vectors in `test/vectors/vectors.json` byte-for-byte.
- Add unit tests for every public method. Mock HTTP and cover method, path, query, body, auth headers, and API error mapping.
- Keep money-unit helpers at 100% line coverage. Cover bad inputs, 6-decimal boundaries, huge values, and overflow returning an error instead of panicking.
- Never use floats for money. Use decimal strings at public boundaries and integer raw units for signed/API payloads.
- Preserve typed errors. `AevoApiError` must carry the backend API `code` whenever the response includes one.
- Examples must be dry-run by default. `SEND=1` paths must refuse the public test-vector keys.
- Do not commit secrets. The only private keys in tests must be deterministic keys derived from public seeds.
- Keep `README.md` and `CHANGELOG.md` updated for user-visible behavior, compatibility, or release-process changes.

## Vectors

See [VECTORS.md](VECTORS.md) for the current vector file SHA-256, expected fixture shape, and regeneration source.
