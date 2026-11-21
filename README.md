# csv-reader, read faster

An entry for the make.fun bounty [csv-reader-speed-01-run-20261121](https://make.fun/bounty/csv-reader-speed-01-run-20261121): a drop-in replacement for make.fun's csv-reader 1.0.0 that returns its exact answer — `{columns, rows, errors}` — for every input, broken rows and all, in a fraction of its CPU time.

![bounty](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)
![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Lisanye9527/csv-reader-speed-01-run-20261121/rank.svg)
![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Lisanye9527/csv-reader-speed-01-run-20261121/reward.svg)

## How it works

`solve.js` exports `run(input)`, and `main.ts` is the house driver: it reads every case from `/input/cases.json`, answers each with `run`, and writes `/output/answers.json`.

csv-reader 1.0.0 reads one character at a time and builds each field a character at a time. This reader keeps the reference's state machine, its broken-row policy and the exact order its errors are recorded in — stray CRs dropped outside quotes, quote junk appended after a closing quote, a quote that never closes re-read as a literal character, short rows padded and long rows cut to the first record's width — but scans instead of stepping:

- Two regexes find the next character that matters (a comma, a line break, a CR, a quote), and whole runs of plain text are sliced into the field at once instead of being concatenated character by character.
- A record that sits on one line holding no quote and no CR but its own CRLF's is read directly as that line split at its commas, which is exactly what the state machine would produce for it.

Nothing else changes: fields stay strings, never trimmed or converted, and every error keeps its `{code, line, row}` (plus `fields` on a short row, `extra` on a long one).

## Checking it

Against the kit's practice set the answers are byte-identical to the reference's, and against the reference reader itself the implementation was fuzzed with over 100,000 adversarial cases (fragment soup of quotes, CRs, CRLFs and BOMs, plus generated files in the contest generator's style with its broken-row rates): every answer identical. Locally it reads the practice set about 3.3× faster than the house baseline.
