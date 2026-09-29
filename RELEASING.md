# Releasing

Releases are tag-driven. Do not publish manually.

## One-Time Setup

- Create the GitHub `release` environment and require reviewer approval.
- Add `NPM_TOKEN` for publishing `@aevo/sdk` to the npm org `@aevo`.
- Confirm npm org ownership and package access for `@aevo/sdk`.
- The package is MIT-licensed (Copyright (c) 2026 Aevo). The workflow refuses to publish if `package.json` `license` is ever unset, `UNLICENSED` or `TBD`.

## Release Steps

1. Bump the version in `package.json` and `package-lock.json`.
2. Move the release notes from `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` in `CHANGELOG.md`.
3. Run the local checks from `CONTRIBUTING.md`.
4. Open a PR and wait for CI.
5. Merge the PR to `main`.
6. Create and push the release tag:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

7. Approve the GitHub Actions `release` environment when the release workflow pauses.
8. Confirm npm and the GitHub Release were published from the workflow.

## Semver Policy

This package follows semver. While the SDK is `0.x`, minor versions may include breaking changes and patch versions are reserved for backwards-compatible fixes.
