## Checklist

- [ ] Signing changes reproduce `test/vectors/vectors.json` byte-for-byte.
- [ ] Every public method changed has unit coverage with mocked HTTP for method, path, query, body, auth headers, and error mapping.
- [ ] Money-unit helpers remain 100% line covered, including bad inputs, 6-decimal boundaries, huge values, and overflow returning an error instead of panicking.
- [ ] Money values use decimal strings or integer raw units; no floats.
- [ ] API errors carry the typed API `code` when the backend returns one.
- [ ] Examples are dry-run by default; `SEND=1` refuses public test-vector keys.
- [ ] No secrets were committed; test keys come only from public seeds.
- [ ] README and CHANGELOG were updated when behavior changed.
