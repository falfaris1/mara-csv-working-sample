import test from 'node:test';
import assert from 'node:assert/strict';
import { CSV_LIMITS, parseCsv, encodeCsv } from '../src/csv-format.mjs';
import { cleanCsv } from '../src/csv-clean.mjs';
const bytes = (text) => Buffer.from(text, 'utf8');
const rule = (columns) => ({ version: 1, columns });

test('RFC-style quotes preserve embedded comma, quote and CRLF in a data value', () => {
  const input = 'Person,Notiz\r\n"Müller, Lea","Zeile 1\r\nZeile ""2"""\r\n';
  const expected = [['Person', 'Notiz'], ['Müller, Lea', 'Zeile 1\r\nZeile "2"']];
  assert.deepEqual(parseCsv(input), expected);
  const result = cleanCsv(bytes(input));
  assert.deepEqual(parseCsv(result.csv), expected);
  assert.equal(result.csv, input);
  assert.equal(result.report.input.dataRecords, 1);
});

test('UTF-8 BOM is recognized and removed without corrupting generic Unicode headers', () => {
  const result = cleanCsv(bytes('\uFEFFBezeichnung,Größe\nTür,groß\n'));
  assert.equal(result.report.input.hadUtf8Bom, true);
  assert.equal(result.csv.startsWith('\uFEFF'), false);
  assert.deepEqual(parseCsv(result.csv), [['Bezeichnung', 'Größe'], ['Tür', 'groß']]);
});

test('CSV encoder round-trips quoted values and empty trailing fields', () => {
  const records = [['A', 'B', 'C'], ['x,y', 'a"b', ''], ['embedded\nline', 'plain', 'z']];
  assert.deepEqual(parseCsv(encodeCsv(records)), records);
});

test('malformed quoting and inconsistent field counts reject rather than invent values', () => {
  for (const input of ['A\n"unterminated', 'A\na"b\n', 'A\n"x" garbage\n']) {
    assert.throws(() => cleanCsv(bytes(input)), { code: 'CSV_SYNTAX' });
  }
  assert.throws(() => cleanCsv(bytes('A,B\nx\n')), { code: 'CSV_COLUMN_COUNT' });
  assert.throws(() => cleanCsv(bytes('A\nx,y\n')), { code: 'CSV_COLUMN_COUNT' });
});

test('invalid UTF-8, empty input and binary control characters are rejected', () => {
  for (const input of [Buffer.from([0x41, 0x0a, 0xc3, 0x28]), Buffer.from([0x41, 0x0a, 0xf0, 0x9f])]) {
    assert.throws(() => cleanCsv(input), { code: 'CSV_INVALID_UTF8' });
  }
  assert.throws(() => cleanCsv(bytes('')), { code: 'CSV_EMPTY_INPUT' });
  assert.throws(() => cleanCsv(bytes('A\nx\u0000y')), { code: 'CSV_CONTROL_CHARACTER' });
});

test('byte limit is exactly 100000 bytes including the header and BOM', () => {
  const exact = bytes(`A\n${'x'.repeat(CSV_LIMITS.maxInputBytes - 2)}`);
  assert.equal(exact.length, 100000);
  assert.equal(cleanCsv(exact).report.input.bytes, 100000);
  assert.throws(() => cleanCsv(Buffer.concat([exact, Buffer.from('x')])), { code: 'CSV_BYTE_LIMIT' });
});

test('record limit counts input data before deduplication and ignores quoted physical newlines', () => {
  const hundred = `A\n${Array.from({ length: 100 }, () => 'same').join('\n')}\n`;
  assert.equal(cleanCsv(bytes(hundred)).report.input.dataRecords, 100);
  assert.throws(() => cleanCsv(bytes(`${hundred}same\n`)), { code: 'CSV_RECORD_LIMIT' });
  assert.equal(cleanCsv(bytes('A\n"one\ntwo\nthree"\n')).report.input.dataRecords, 1);
});

test('at most eight columns and nonempty unique trimmed headers are accepted', () => {
  assert.equal(cleanCsv(bytes('A,B,C,D,E,F,G,H\n1,2,3,4,5,6,7,8\n')).report.input.columns, 8);
  assert.throws(() => cleanCsv(bytes('A,B,C,D,E,F,G,H,I\n')), { code: 'CSV_COLUMN_LIMIT' });
  assert.throws(() => cleanCsv(bytes('A, A \n1,2\n')), { code: 'CSV_DUPLICATE_HEADER' });
  assert.throws(() => cleanCsv(bytes('A,  \n1,2\n')), { code: 'CSV_EMPTY_HEADER' });
});

test('only originally identical parsed rows are removed; normalized collisions are retained', () => {
  const result = cleanCsv(bytes('Artikel,Wert\n A ,1\n A ,1\nA,1\n'));
  assert.deepEqual(parseCsv(result.csv), [['Artikel', 'Wert'], ['A', '1'], ['A', '1']]);
  assert.equal(result.report.summary.duplicateRowsRemoved, 1);
  assert.equal(result.report.summary.normalizedDuplicateRowsRetained, 1);
  assert.deepEqual(result.report.duplicatesRemoved, [{ record: 3, identicalToRecord: 2 }]);
  assert.deepEqual(result.report.normalizedDuplicatesRetained, [{ record: 4, sameOutputAsRecord: 2 }]);
});

test('deduplication uses entire field arrays rather than concatenated ambiguous keys', () => {
  const result = cleanCsv(bytes('A,B\nab,c\na,bc\n"ab",c\n'));
  assert.equal(result.report.output.dataRecords, 2);
  assert.equal(result.report.summary.duplicateRowsRemoved, 1);
});

test('default cleanup keeps missing values and ambiguous dates without guessing', () => {
  const result = cleanCsv(bytes('Datum,Wert\n01/02/2026,\n'));
  assert.deepEqual(parseCsv(result.csv), [['Datum', 'Wert'], ['01/02/2026', '']]);
  assert.equal(result.report.summary.missingValues, 1);
  assert.equal(result.report.summary.retainedAmbiguousValues, 1);
  assert.ok(result.report.issues.some((entry) => entry.code === 'date_like_text_without_explicit_rule'));
  assert.equal(result.report.summary.rejectedRows, 0);
});

test('an explicitly selected date format resolves day/month ordering without Date parsing heuristics', () => {
  const input = bytes('Datum\n01/02/2026\n');
  const dayFirst = cleanCsv(input, rule({ Datum: { type: 'date', inputFormat: 'DD/MM/YYYY' } }));
  const monthFirst = cleanCsv(input, rule({ Datum: { type: 'date', inputFormat: 'MM/DD/YYYY' } }));
  assert.equal(parseCsv(dayFirst.csv)[1][0], '2026-02-01');
  assert.equal(parseCsv(monthFirst.csv)[1][0], '2026-01-02');
});

test('calendar-invalid dates stay unchanged and flagged while valid leap dates normalize', () => {
  const result = cleanCsv(bytes('Datum\n31.02.2026\n29.02.2024\n29.02.2026\n'), rule({ Datum: { type: 'date', inputFormat: 'DD.MM.YYYY' } }));
  assert.deepEqual(parseCsv(result.csv).slice(1), [['31.02.2026'], ['2024-02-29'], ['29.02.2026']]);
  assert.equal(result.report.summary.retainedAmbiguousValues, 2);
  assert.equal(result.report.summary.normalizedDates, 1);
});

test('explicit numeric grouping and decimal rules normalize without floating point conversion', () => {
  const result = cleanCsv(bytes('Betrag\n"1.234,50"\n"12,00"\n'), rule({ Betrag: { type: 'number', decimalSeparator: ',', thousandsSeparator: '.' } }));
  assert.deepEqual(parseCsv(result.csv).slice(1), [['1234.50'], ['12.00']]);
  const large = '123456789012345678901234567890';
  assert.equal(parseCsv(cleanCsv(bytes(`Wert\n${large}\n`), rule({ Wert: { type: 'number', decimalSeparator: '.' } })).csv)[1][0], large);
});

test('ambiguous grouping and leading zeros are retained rather than silently stripped', () => {
  const result = cleanCsv(bytes('Betrag\n00123\n"12.34,56"\n'), rule({ Betrag: { type: 'number', decimalSeparator: ',', thousandsSeparator: '.' } }));
  assert.deepEqual(parseCsv(result.csv).slice(1), [['00123'], ['12.34,56']]);
  assert.equal(result.report.summary.retainedAmbiguousValues, 2);
});

test('spreadsheet formula prefixes in text and headers are escaped and fully reported', () => {
  const values = ['=HYPERLINK("https://example.invalid")', '+SUM(1,2)', '-12', '@SUM(A1)', '\u200B=1+1', "'=already_safe"];
  const source = encodeCsv([['=Header'], ...values.map((value) => [value])]);
  const result = cleanCsv(bytes(source));
  const actual = parseCsv(result.csv);
  assert.equal(actual[0][0], "'=Header");
  values.forEach((value, index) => assert.equal(actual[index + 1][0], index === values.length - 1 ? value : `'${value}`));
  assert.equal(result.report.summary.formulaProtectedCells, 6);
  assert.ok(result.report.changes.some((entry) => entry.kind === 'formula_protection' && entry.before === '-12' && entry.after === "'-12"));
});

test('explicit validated negative numbers remain numbers while equivalent text is formula-safe', () => {
  const result = cleanCsv(bytes('Text,Zahl\n-12,-12\n'), rule({ Zahl: { type: 'number', decimalSeparator: '.' } }));
  assert.deepEqual(parseCsv(result.csv)[1], ["'-12", '-12']);
});

test('formula protection never silently creates duplicate export headers', () => {
  assert.throws(() => cleanCsv(bytes("=A,'=A\n1,2\n")), { code: 'CSV_HEADER_COLLISION' });
});

test('unsupported rules and unbound column names reject instead of evaluating code or guessing formats', () => {
  for (const rules of [
    rule({ Missing: { type: 'text' } }), rule({ A: { type: 'date' } }),
    rule({ A: { type: 'date', inputFormat: 'auto' } }), rule({ A: { type: 'number', decimalSeparator: ',', thousandsSeparator: ',' } }),
    rule({ A: { type: 'text', transform: 'process.exit(1)' } }), { version: 1, columns: {}, execute: 'anything' },
  ]) assert.throws(() => cleanCsv(bytes('A\nvalue\n'), rules), { code: 'CSV_INVALID_RULES' });
});

test('generic object-member header names are data, not prototype mutations', () => {
  const rules = JSON.parse('{"version":1,"columns":{"__proto__":{"type":"text"},"constructor":{"type":"text"}}}');
  const result = cleanCsv(bytes('__proto__,constructor\na,b\n'), rules);
  assert.deepEqual(parseCsv(result.csv), [['__proto__', 'constructor'], ['a', 'b']]);
  assert.equal(Object.hasOwn({}, 'type'), false);
});

test('same bytes and rules produce identical CSV and reports', () => {
  const input = bytes(' A ,B\n x ,01/02/2026\n');
  const first = cleanCsv(input);
  const second = cleanCsv(input);
  assert.deepEqual(first, second);
});
