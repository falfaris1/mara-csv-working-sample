import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { paymentMiddleware } from '@x402/express';
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { bazaarResourceServerExtension, declareDiscoveryExtension } from '@x402/extensions/bazaar';

assert.equal(Number(process.versions.node.split('.')[0]), 24, 'Run this experiment with Node.js 24.x');

// All data below is synthetic. These are public test fixtures, not wallets or
// valid payment evidence. The mock NEVER verifies a signature or contacts RPC.
const NETWORK = 'eip155:84532';
const ASSET = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const RECIPIENT = '0x1111111111111111111111111111111111111111';
const PAYER = '0x2222222222222222222222222222222222222222';
const FAKE_SIGNATURE = `0x${'33'.repeat(65)}`;
const FAKE_TRANSACTION = `0x${'ab'.repeat(32)}`;
const INPUT_MARKERS = ['CANARY_PERSON_6137', 'INPUT_CSV_CANARY_6137'];
const OUTPUT_MARKERS = ['RESULT_CSV_CANARY_6137', 'REPORT_CANARY_6137', 'TEXT_REPORT_CANARY_6137'];
const EXAMPLE_INPUT = { csv: 'name,city\nAlice,Berlin\n' };
const EXAMPLE_OUTPUT = { csv: 'name,city\r\nAlice,Berlin\r\n', report: {}, textReport: 'CSV cleaning report' };
const ACTUAL_OUTPUT = { csv: OUTPUT_MARKERS[0], report: { marker: OUTPUT_MARKERS[1] }, textReport: OUTPUT_MARKERS[2] };
const captures = [];
const facilitatorCalls = [];
const fetchTargets = [];

const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const target = new URL(input instanceof Request ? input.url : input);
  assert.equal(target.hostname, '127.0.0.1', 'External HTTP is disabled in this experiment');
  assert.equal(target.protocol, 'http:', 'Only the local HTTP fixture is permitted');
  fetchTargets.push(target.hostname);
  // Also block redirects: checking only the first URL would not constrain a
  // subsequent redirect performed inside native fetch or the SDK.
  return nativeFetch(input, { ...options, redirect: 'error' });
};

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  if (!server.listening) return;
  const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  server.closeAllConnections();
  await closed;
}

const app = express();
const api = createServer(app);
const facilitator = createServer(async (req, res) => {
  facilitatorCalls.push(`${req.method} ${req.url}`);
  res.setHeader('content-type', 'application/json');
  if (req.method === 'GET' && req.url === '/supported') {
    res.end(JSON.stringify({
      kinds: [{ x402Version: 2, scheme: 'exact', network: NETWORK }],
      extensions: ['bazaar'], signers: {},
    }));
    return;
  }
  if (req.method !== 'POST' || !['/verify', '/settle'].includes(req.url)) {
    res.writeHead(404).end('{}');
    return;
  }
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 100_000) throw new Error('Fixture request exceeds its size limit');
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    const value = JSON.parse(raw);
    captures.push({ path: req.url, value, raw });
    const payer = value.paymentPayload.payload.authorization.from;
    // Deliberately fake: success here only lets the real SDK reach its HTTP
    // serialization boundary. It proves nothing about payment validity.
    const response = req.url === '/verify'
      ? { isValid: true, payer }
      : { success: true, payer, network: NETWORK, transaction: FAKE_TRANSACTION };
    res.end(JSON.stringify(response));
  } catch {
    res.writeHead(400).end('{"error":"invalid_fixture_request"}');
  }
});

function fakePayment(required, number, echoDiscovery) {
  const payment = {
    x402Version: 2,
    resource: required.resource,
    accepted: required.accepts[0],
    payload: {
      signature: FAKE_SIGNATURE,
      authorization: {
        from: PAYER, to: RECIPIENT, value: required.accepts[0].amount,
        validAfter: '0', validBefore: '4102444800',
        nonce: `0x${number.toString(16).padStart(64, '0')}`,
      },
    },
  };
  if (echoDiscovery) payment.extensions = structuredClone(required.extensions);
  return Buffer.from(JSON.stringify(payment), 'utf8').toString('base64');
}

try {
  const facilitatorUrl = await listen(facilitator);
  const baseUrl = await listen(api);
  const resourceUrl = `${baseUrl}/v1/csv/clean`;
  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: facilitatorUrl, timeoutMs: 1000 }))
    .register(NETWORK, new ExactEvmScheme());
  server.registerExtension(bazaarResourceServerExtension);
  const extensions = declareDiscoveryExtension({
    bodyType: 'json',
    input: structuredClone(EXAMPLE_INPUT),
    inputSchema: {
      type: 'object',
      properties: { csv: { type: 'string' } },
      required: ['csv'], additionalProperties: false,
    },
    output: {
      example: structuredClone(EXAMPLE_OUTPUT),
      schema: {
        type: 'object',
        properties: { csv: { type: 'string' }, report: { type: 'object' }, textReport: { type: 'string' } },
        required: ['csv', 'report', 'textReport'], additionalProperties: false,
      },
    },
  });
  const routes = {
    'POST /v1/csv/clean': {
      accepts: [{
        scheme: 'exact', network: NETWORK, payTo: RECIPIENT,
        price: { asset: ASSET, amount: '10000', extra: { name: 'USDC', version: '2' } },
        maxTimeoutSeconds: 60,
      }],
      resource: resourceUrl,
      description: 'Synthetic CSV transport privacy experiment; no real payments.',
      mimeType: 'application/json', extensions,
    },
  };
  app.use(express.json({ limit: 100_000, inflate: false }));
  app.use(paymentMiddleware(routes, server));
  // A deterministic, synthetic response, not a production CSV cleaner.
  app.post('/v1/csv/clean', (_req, res) => res.json(ACTUAL_OUTPUT));

  const body = JSON.stringify({ csv: `name,city\n${INPUT_MARKERS.join(',')}\n` });
  const unpaid = await fetch(resourceUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  assert.equal(unpaid.status, 402);
  const header = unpaid.headers.get('PAYMENT-REQUIRED');
  assert.ok(header, 'Expected the official SDK v2 header');
  const required = decodePaymentRequiredHeader(header);
  await unpaid.arrayBuffer();
  assert.equal(required.x402Version, 2);
  assert.deepEqual(required.extensions.bazaar.info.input.body, EXAMPLE_INPUT);
  assert.deepEqual(required.extensions.bazaar.info.output.example, EXAMPLE_OUTPUT);
  for (const marker of [...INPUT_MARKERS, ...OUTPUT_MARKERS]) assert.equal(JSON.stringify(required).includes(marker), false);

  for (const [index, echoDiscovery] of [false, true].entries()) {
    const res = await fetch(resourceUrl, {
      method: 'POST', headers: {
        'content-type': 'application/json',
        'PAYMENT-SIGNATURE': fakePayment(required, index + 1, echoDiscovery),
      }, body,
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), ACTUAL_OUTPUT);
  }

  assert.deepEqual(facilitatorCalls, ['GET /supported', 'POST /verify', 'POST /settle', 'POST /verify', 'POST /settle']);
  assert.equal(captures.length, 4);
  assert.deepEqual(captures.map(entry => entry.path), ['/verify', '/settle', '/verify', '/settle']);
  assert.deepEqual(captures.map(entry => Boolean(entry.value.paymentPayload.extensions?.bazaar)), [false, false, true, true]);
  for (const entry of captures) {
    assert.deepEqual(Object.keys(entry.value).sort(), ['paymentPayload', 'paymentRequirements', 'x402Version']);
    for (const marker of [...INPUT_MARKERS, ...OUTPUT_MARKERS]) assert.equal(entry.raw.includes(marker), false);
    if (entry.value.paymentPayload.extensions?.bazaar) {
      assert.deepEqual(entry.value.paymentPayload.extensions.bazaar.info.input.body, EXAMPLE_INPUT);
      assert.deepEqual(entry.value.paymentPayload.extensions.bazaar.info.output.example, EXAMPLE_OUTPUT);
    }
  }
  assert.ok(fetchTargets.length > 0);
  assert.ok(fetchTargets.every(hostname => hostname === '127.0.0.1'));
  console.log(JSON.stringify({
    result: 'pass', localOnly: true, simulatedPayments: 2,
    facilitatorWireRequests: captures.map(entry => ({
      path: entry.path, fields: Object.keys(entry.value),
      hasEchoedDiscovery: Boolean(entry.value.paymentPayload.extensions?.bazaar),
    })),
    customerInputFound: false, actualOutputFound: false,
    exampleRemainedConstant: true, separateDiscoveryRequest: false,
  }));
} finally {
  try { await Promise.all([close(api), close(facilitator)]); }
  finally { globalThis.fetch = nativeFetch; }
}
