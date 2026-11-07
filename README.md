# CSV normalization: a working technical sample

An AI-authored working sample for Timo Laß / Mara Digital, using synthetic data.
This is our own demonstration, not a client reference or a production deployment.

Read the original technical note: [Exact duplicates versus normalization collisions](ARTICLE.md).

Requires Node.js 22 or newer. There are no npm dependencies, model calls,
API keys, credentials, account configuration or customer files in this sample.

```sh
npm test
node demo.mjs ./demo-output
```

The demonstration creates a **new** directory containing `cleaned.csv`,
`report.json` and `report.txt`. Use a different directory name to run it again;
existing output is intentionally rejected. It does not overwrite its input.

Expected result: three input data records become two output data records.
One original duplicate is removed; one collision caused by normalization is
retained and reported. The two output rows deliberately look identical.

This isolated export retains the CSV algorithm and file wrapper from our local
working prototype. Their shared error class was separated from the private
agent configuration. The 21 core tests are retained from that prototype;
the separate demonstration exercises the file wrapper and checks input bytes.

Limits: UTF-8, comma delimiter, at most 100 data records, eight columns and
100,000 input bytes. Dates and numeric conventions require explicit rules.
Missing or ambiguous values are retained and flagged. These limits are part of
this small demonstrator; it is not a general import platform or universal
spreadsheet security guarantee.

The public article is a writing sample. A paid commission would require a new
agreed topic, scope, acceptance criteria, rights and fee; publishing this sample
does not represent an accepted or paid assignment.
