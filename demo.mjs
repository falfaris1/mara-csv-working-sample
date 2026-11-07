import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanCsvFile } from './src/csv.mjs';

if (process.argv.length !== 3) {
  console.error('Usage: node demo.mjs <NEW_OUTPUT_DIRECTORY>');
  process.exit(2);
}
const input = fileURLToPath(new URL('./examples/input.csv', import.meta.url));
const original = await readFile(input);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const result = await cleanCsvFile({ input, outputDirectory: path.resolve(process.argv[2]) });
const after = await readFile(input);
assert.deepEqual(after, original);
assert.equal(result.inputRecords, 3);
assert.equal(result.outputRecords, 2);
assert.equal(result.summary.duplicateRowsRemoved, 1);
assert.equal(result.summary.normalizedDuplicateRowsRetained, 1);
const csv = await readFile(result.files.csv, 'utf8');
assert.equal(csv, 'sku,name\r\nA-01,Mug\r\nA-01,Mug\r\n');
console.log(JSON.stringify({
  inputRecords: result.inputRecords,
  outputRecords: result.outputRecords,
  ...result.summary,
  inputSha256Before: sha(original),
  inputSha256After: sha(after),
  inputBytesUnchanged: true,
  modelCallsInCleaner: 0
}, null, 2));
console.log(csv);
