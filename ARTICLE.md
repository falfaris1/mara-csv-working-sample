# Exact duplicates are not normalization collisions

*An original, AI-written technical working sample for Timo Laß / Mara Digital.
The input is synthetic. This is not a client case study or a claim of human
authorship. The code and reproduction commands are in this repository.*

A cleanup pipeline can make two records look identical without proving that
they represented the same source record. That distinction matters when a tool
both normalizes values and removes duplicates. If it trims whitespace first
and then deduplicates, it can silently turn a formatting decision into a data
deletion decision.

Consider this small input, including the leading space before the first Mug:

```csv
sku,name
A-01, Mug
A-01,Mug
A-01,Mug
```

There are three data records. The second and third have identical parsed
fields. The first has a different name value because it contains a leading
space. Trimming that space is reasonable under this example's explicit
cleanup rule. Deciding that the resulting record should also disappear is a
separate choice.

## Make the identity rule explicit

This demonstrator removes only originally identical **parsed field arrays**.
That is not the same as comparing raw physical CSV lines: a quoted field may
contain a newline, and quoted and unquoted spellings can parse to the same
value. The parser handles CSV structure before any identity comparison.

The cleaner computes its original identity key with `JSON.stringify(row)`.
Serializing the complete field array preserves field boundaries. Joining
values without a delimiter would confuse `['ab', 'c']` with `['a', 'bc']`.
The original values are used for the first comparison, before trimming or
explicit number and date conversions.

A second map tracks normalized output. When two originally different records
produce the same output, both are retained and the report identifies the
collision. The caller can then ask the data owner whether a stronger business
rule is appropriate. Even the removal of exact duplicates is a selected rule,
not a universal truth: two identical transaction rows might be legitimate in
another dataset.

## Reproduce the result

With Node.js 22 or newer, run:

```sh
npm test
node demo.mjs ./demo-output
```

The demo reads `examples/input.csv`, calls the file wrapper, and checks the
result. It expects this output:

```csv
sku,name
A-01,Mug
A-01,Mug
```

Keeping both rows is intentional. The report must show three input data
records, two output records, one removed original duplicate, one trimmed cell
and one retained normalized collision. Record numbers include the header:
record 4 is the duplicate of record 3; record 3 collides with record 2 after
trimming. These are logical CSV records, not physical line numbers.

The demo reads the input again after the run and compares its bytes and
SHA-256 digest. It also checks the exact output text, including CRLF line
endings. The three generated files contain the cleaned CSV, a readable report
and the full structured change report. The destination directory must be new,
so repeating the same command fails instead of overwriting earlier output.

## Keep uncertainty visible

Identity is only one boundary. A value such as `01/02/2026` does not establish
whether the source intended January 2 or February 1. The default mode retains
date-like text and flags it. A date conversion requires an explicit supported
input format. Numeric separators are also supplied by a column rule; the tool
does not infer a locale or use floating-point arithmetic to normalize strings.

Missing cells remain missing. Malformed quoting, inconsistent column counts
and invalid UTF-8 reject the input rather than inventing replacement values.
This deliberately small implementation accepts at most 100 data records,
eight columns and 100,000 bytes. Those are operational limits, not performance
benchmark results.

Formula-like text receives a leading apostrophe, with the change recorded.
That is a conservative text mitigation, not a guarantee about every spreadsheet
or downstream importer. Check the actual destination's interpretation before
relying on exported text in a different workflow.

## Give the model a narrow role

The CSV execution itself makes no model calls. An agent can help establish
the requested rules, run the deterministic tool and explain its report. It
should not silently turn a flagged collision into permission to delete a row.
For a future MCP workflow, that boundary belongs in the tool contract and its
acceptance tests. This repository does not claim an implemented or tested
`mcp-agent` integration.

The practical result is a handover that distinguishes observed input,
explicit transformations and unresolved decisions. The apparent redundancy of
the two output rows is useful evidence: the cleanup preserved a question that
the original source alone could not answer.
