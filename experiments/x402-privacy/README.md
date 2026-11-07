# x402 Bazaar: a local HTTP privacy canary

This independent work sample checks which JSON reaches a mock facilitator through the official x402 SDK. It uses synthetic CSV input and output, fixed public discovery examples, and **simulated payments only**. It is not a customer project or an earnings claim.

Use Node.js **24.x**. Direct dependencies are pinned to `@x402/core`, `@x402/express`, `@x402/evm`, and `@x402/extensions` **2.30.0**, plus Express **5.3.0**. The included lockfile fixes the dependency tree.

From this directory:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

Dependency installation accesses the configured npm registry. The experiment itself binds both HTTP servers to `127.0.0.1` on OS-assigned ports. Its global `fetch` guard rejects other hosts and blocks redirects. The harness does not load an `.env` file or read operator names, mailbox addresses, credentials, or provider configuration. It imports no private service code and needs no account, wallet key, RPC, cloud provider, or real payment.

The `0x33…33` signature, payer/recipient fixtures, nonces, and `0xab…ab` transaction are deliberately fake. The local facilitator answers verification and settlement requests without cryptographic validation or blockchain access.

## What it measures

1. A JSON POST contains the synthetic CSV record `CANARY_PERSON_6137,INPUT_CSV_CANARY_6137`.
2. The real SDK produces an unpaid HTTP 402 response. Bazaar advertises the fixed input example `name,city\nAlice,Berlin\n` and a fixed output example with CRLF line endings.
3. Two requests use fake payment authorizations: the first omits discovery extensions; the second explicitly echoes the advertised Bazaar extension in `paymentPayload.extensions`.
4. The mock records the actual `/verify` and `/settle` request JSON. The protected handler returns separate CSV, report, and text-report canaries.
5. Assertions require exactly four payment wire captures, the three top-level fields `x402Version`, `paymentPayload`, and `paymentRequirements`, constant examples, and no input/output canaries in those captures. The only additional facilitator request is `GET /supported`.

The script prints one JSON success record. `hasEchoedDiscovery` is `false` for the first request's verify **and** settle captures, then `true` for both captures of the second request. In that second pair, the public Alice/Berlin examples remain unchanged. No separate discovery upload occurs in this scenario.

## Limits

This tests a specific SDK version and configuration. It does not prove signature validity, successful payment, production readiness, complete GDPR compliance, or the behavior of every cloud provider or facilitator. The handler returns a predetermined synthetic result; it does not implement CSV cleaning.

Client-provided payment payloads, including echoed extensions, are forwarded. A client that puts sensitive data into its payment payload is outside the canary claim. This sample also does not establish what an external facilitator would retain or index. A changed SDK version, extension, hook, or configuration should be rechecked.

Upstream context: [official HTTP transport specification](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md) and [official Bazaar server implementation](https://github.com/x402-foundation/x402/blob/main/typescript/packages/extensions/src/bazaar/server.ts). These links track upstream `main`; the experiment's installed versions are fixed by its own package and lockfile.
