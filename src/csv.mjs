import { open, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AgentError } from './errors.mjs';
import { cleanCsv } from './csv-clean.mjs';
import { CSV_LIMITS, decodeUtf8 } from './csv-format.mjs';

async function readBoundedFile(file, maximum) {
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new AgentError('CSV_NOT_A_FILE', 'CSV and rules inputs must be regular files.');
    if (info.size > maximum) throw new AgentError('CSV_BYTE_LIMIT', `Input exceeds its ${maximum}-byte limit.`);
    const data = Buffer.alloc(maximum + 1);
    let size = 0;
    while (size <= maximum) {
      const chunk = await handle.read(data, size, data.length - size, null);
      if (!chunk.bytesRead) break;
      size += chunk.bytesRead;
    }
    if (size > maximum) throw new AgentError('CSV_BYTE_LIMIT', `Input exceeds its ${maximum}-byte limit.`);
    return data.subarray(0, size);
  } finally { await handle.close(); }
}

export async function cleanCsvFile({ input, outputDirectory, rulesFile } = {}) {
  for (const file of [input, outputDirectory, ...(rulesFile === undefined ? [] : [rulesFile])]) {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new AgentError('CSV_ABSOLUTE_PATH_REQUIRED', 'Input, new output directory and optional rules path must be absolute.');
  }
  const bytes = await readBoundedFile(input, CSV_LIMITS.maxInputBytes);
  let rules = { version: 1, columns: {} };
  if (rulesFile !== undefined) {
    const text = decodeUtf8(await readBoundedFile(rulesFile, CSV_LIMITS.maxRulesBytes)).replace(/^\uFEFF/, '');
    try { rules = JSON.parse(text); } catch { throw new AgentError('CSV_INVALID_RULES', 'Rules must be valid JSON; no code is executed.'); }
  }
  const result = cleanCsv(bytes, rules);
  try { await mkdir(outputDirectory); }
  catch (error) {
    if (error.code === 'EEXIST') throw new AgentError('CSV_OUTPUT_EXISTS', 'The output directory must be new. Existing files and the original are never overwritten.');
    throw new AgentError('CSV_OUTPUT_UNAVAILABLE', 'The new output directory could not be created; its parent must already exist.');
  }
  const files = { csv: path.join(outputDirectory, 'cleaned.csv'), report: path.join(outputDirectory, 'report.txt'), machineReport: path.join(outputDirectory, 'report.json') };
  try {
    await writeFile(files.csv, result.csv, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await writeFile(files.report, result.textReport, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await writeFile(files.machineReport, `${JSON.stringify(result.report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch { throw new AgentError('CSV_OUTPUT_WRITE_FAILED', 'Output creation failed. Inspect the new directory for incomplete artifacts; the original was not changed.'); }
  return { status: 'completed', operation: 'csv-clean', files, inputRecords: result.report.input.dataRecords, outputRecords: result.report.output.dataRecords, summary: result.report.summary, modelCalls: 0, originalModified: false };
}
