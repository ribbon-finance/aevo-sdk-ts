# Changelog

All notable changes to this package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package follows semantic versioning.

## [Unreleased]

### Added

- Added browser-wallet builder approval typed data, signer submission helpers, and account-bearing approval submission without mandatory API credentials.

## [0.1.0] - unreleased

### Added

- Initial TypeScript SDK for Aevo REST endpoints, authenticated signing flows, and websocket operations.
- EIP-712 signing helpers for orders, builder orders, registration, sign-key approval, builder approval, withdrawals, and transfers.
- Money-unit helpers for 6-decimal fixed-point values, builder basis points, and raw-rate conversion.
- Builder order attribution fields and exported builder API error codes.
- Shared signing and HMAC vectors generated from `ribbon-finance/exchange-backend`.
