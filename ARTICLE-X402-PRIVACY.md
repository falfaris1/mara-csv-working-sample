# Checking a payment middleware data boundary before cloud deployment

*Original technical working sample from Mara Digital; synthetic data.*

A CSV cleaner can process a file locally while its payment middleware contacts another service. Before deploying that combination to a cloud host, check what the payment layer actually sends. Reading the route handler is useful, but it does not show every field added during SDK serialization.

This working sample measures one boundary: HTTP request bodies sent by the x402 SDK to a facilitator. It uses synthetic CSV data, a local mock, and pinned SDK packages. It is a local experiment before deployment, with no cloud deployment, real payment, paid customer, or mainnet settlement.

## Reproduce the experiment

From the repository root, using Node.js 24:

```sh
cd experiments/x402-privacy
npm ci --ignore-scripts --no-audit --no-fund
npm test
```

The [self-contained experiment](experiments/x402-privacy/) contains the harness and lockfile. Its x402 packages are pinned to version 2.30.0. Inspect the code before running it. Dependency installation needs registry access; the network restriction below applies to the canary, not to npm. The test uses fixtures rather than asking for wallet credentials.

## Identify the boundary

In this setup, there are three roles: a caller supplying CSV, a protected resource server, and a facilitator handling payment checks. The [official x402 repository](https://github.com/x402-foundation/x402) provides the SDK implementation. The question here is narrower than whether an entire application is private: does this configured payment path serialize the submitted CSV or the response payload into its facilitator requests?

The harness replaces the facilitator with a local HTTP server. It captures the bodies received at `/verify` and `/settle`, after the SDK has constructed and serialized them. Checking these captured bodies tests the wire representation, rather than just an object created by application code.

Global `fetch` is restricted to `127.0.0.1`. That restriction keeps its requests local and makes an unexpected external fetch fail. The mock returns controlled responses. It does not validate a cryptographic signature, check a blockchain, or transfer assets.

## Use distinguishable synthetic values

The experiment sends the same synthetic CSV body in two requests with separate fixture payment authorizations. That body contains two distinctive input markers. The protected fixture handler returns three separate output markers in its `csv`, `report`, and `textReport` fields. It does not execute a CSV-cleaning algorithm; the predetermined response isolates the payment boundary. Distinctive markers make accidental copying easier to detect than a generic search for common words.

The route also declares fixed Bazaar examples containing Alice and Berlin. Those examples are intentionally synthetic and distinct from the canary values. This separates two possible sources of data: an example deliberately declared in service metadata, and a value taken from the current customer request.

The [Bazaar documentation](https://docs.x402.org/extensions/bazaar) describes discovery declarations and their input/output examples. An example is configuration data that can travel beyond the cleaner. Its contents deserve review even when the actual customer body stays inside the application.

## Read the captured result

The two simulated payments produce four facilitator POST requests: one verification and one settlement for each payment. There is also one initialization `GET /supported`. The POST bodies have these top-level JSON fields:

```text
x402Version
paymentPayload
paymentRequirements
```

None of the two input markers or three output markers appears in those four POST bodies. The first payment omits discovery extensions: neither its verification nor settlement body contains a Bazaar extension. The second payment explicitly echoes the advertised extension: both bodies contain the unchanged Alice/Berlin examples. No separate discovery request is observed.

These observations answer different questions. Absence of the customer markers supports the limited claim that this route configuration did not automatically copy those inputs into the captured facilitator bodies. Presence of the fixed example shows that declared metadata is still information crossing a boundary. A familiar name appearing on the wire is not, by itself, evidence that it came from a customer file.

Keep the distinction visible in a test report. A single statement such as “no data sent” would discard information that this experiment actually records.

## Check caller-controlled extensions separately

In the echoed case, the client’s `paymentPayload.extensions` reaches both captured facilitator requests. That payload is different from the CSV request body, but it is still a place where a caller can put data.

Consequently, this experiment does not establish that a facilitator can never receive customer information. A client could place such information in an extension. The useful conclusion is about this configured flow and the fields examined, not a universal property of x402.

When adapting the sample, keep payment metadata separate from document content. Review which fields the application accepts and forwards, and add representative tests for that policy. Do not assume that removing a document field from the route configuration also removes arbitrary caller-supplied extension values. Test the actual SDK version and inspect what crosses the boundary.

## Carry the finding into a deployment review

Before choosing a host, draw the other data paths too: incoming requests, application memory, response generation, logs, persistent storage, error reporting, and any later retries. This harness measures facilitator HTTP bodies. It does not inspect a future cloud provider’s proxy logs, telemetry, backups, retention settings, or operator access.

A practical deployment check can use the same method: synthetic input, distinctive markers, captured outbound requests, and explicit assertions. Keep real customer files out of the diagnostic fixture. After changing the SDK, discovery declaration, payment adapter, or logging configuration, rerun the relevant checks instead of carrying the old result forward as an assumption.

The mock is useful precisely because it makes a small question reproducible without paying or signing. Successful mock responses are not evidence of working production authentication or valid settlement. Those require separate checks. Likewise, this sample makes no legal-compliance or general privacy guarantee.

This article and its experiment are an original public working sample. They are not a commissioned article or a client case study. Any paid commission would require a separately agreed, new and unpublished topic.
