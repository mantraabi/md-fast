# md-fast

An entry for the make.fun **markdown-render-speed-02** competition: a dependency-free ES module,
`parse.js`, whose `parse(markdown)` returns exactly the HTML that marked 18.1.3 renders for that
string with its default options (`gfm: true`, `breaks: false`, `pedantic: false`, `async: false`),
plus `main.ts`, the harness driver, which renders every case of `cases.json` and writes the
resulting HTML strings to `html.json`.

[![make.fun competition](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/c/markdown-render-speed-02)
[![make.fun rank](https://make.fun/badge/markdown-render-speed-02/mantraabi/md-fast/rank.svg)](https://make.fun/c/markdown-render-speed-02)
[![make.fun reward](https://make.fun/badge/markdown-render-speed-02/mantraabi/md-fast/reward.svg)](https://make.fun/c/markdown-render-speed-02)

## How it works

`parse.js` exports a single function, `function parse(markdown: string): string`, and has no
dependencies beyond the vendored copy of marked that ships in this repository.

The block level is scanned by hand. The document is walked once, line by line, and each line is
classified — blank, indented code, fenced code, ATX heading, setext heading, thematic break,
blockquote, list item, HTML block, link reference definition, GFM table, or plain paragraph text —
instead of letting marked's monolithic block regexes re-scan the remaining source from every block
start. The rules that decide where a block ends are reproduced from marked:

* the paragraph interrupt set (headings, fences, blockquotes, HTML block starts, thematic breaks,
  bullets, `1.` / `1)` ordered items, table delimiter rows) — including the cases where a construct
  does *not* interrupt, such as a 4-space indented line or an ordered item numbered anything but 1;
* the setext-heading guards, which is what keeps a `-` or `=` line from being swallowed by a
  paragraph that cannot become a heading;
* HTML blocks of types 1–7 with their respective terminators (`</script>`, `-->`, `?>`, `]]>`, `>`,
  the blank line for types 6 and 7), and the "complete tag alone on its line" test for type 7;
* fenced code with info strings, backtick-fence rejection when the info string contains a backtick,
  closing-fence length and indentation, and marked's `indentCodeCompensation`;
* GFM tables: delimiter row, column count from the header row, per-column alignment, and the
  lookahead that stops the table body at the next block construct;
* link reference definitions, collected in a first phase so a reference may appear before its
  definition.

Inline parsing, list items and blockquotes are handed to the vendored marked tokenizers, and the
token stream is rendered by marked's own `Parser`. That is deliberate: emphasis, links, code spans,
entities, escapes and raw inline HTML — and the exact splitting of list items and the lazy
continuation rules of blockquotes — are marked's code, not a reimplementation, so byte identity
rests on the same inline lexer and the same renderer that produce the reference output.

`parse()` has a bail path: if the scanner ever meets something it cannot classify it throws, and the
whole document is rendered with `marked.parse`. Correctness therefore never depends on the scanner
being complete. On both gates below that path is never taken — the bail counter stays `0`.

## Verification

The two gates, run against the file in this repository:

    cd /tmp/md-lab
    node verify.mjs /home/devabi/project/md-fast/parse.js /tmp/md-kit/practice
    -> { "total": 720, "ok": 720, "fail": 0 }

    node difftest.mjs
    -> total 680 { 'commonmark-0.31.2': 652, 'gfm-0.29': 28 }
       diff vs marked: 680/680 fails 0
       bails 0

That is 720/720 practice cases byte-identical to marked, and 680/680 specification examples
(CommonMark 0.31.2 plus GFM 0.29) byte-identical to marked, with no fallback to the full parser in
either run.

## Performance

The design is meant to be faster than marked's block loop, and the figures quoted when the scanner
was written were block lexing ~1.16–1.20x and full parse ~1.15x. **Those figures did not reproduce
on this machine.** Measured here — WSL2, Node 26.7.0 and Node 22.23.5, interleaved A/B against the
baseline `parse()` that simply returns `marked.parse(markdown)`, render phase only, median of seven
runs:

    720-case practice set (all 720)     0.93x   entry slower
    40 large documents (2.85 MB source) 0.86x   entry slower
    680 spec examples, warm process     ~0.43x  entry slower

So in this environment the scanner is slower than the baseline it replaces, and the earlier lab
numbers should not be relied on. The correctness gates above are unaffected: output is exact, with
zero bails.

## Layout

    main.ts                    harness driver: reads cases.json, renders, writes html.json (unchanged)
    parse.js                   export function parse(markdown) -> HTML
    vendor/marked/             marked 18.1.3 (marked.esm.js, LICENSE, NOTICE), vendored unmodified
    LICENSE, NOTICE            this repository's MIT licence and the credit to marked

## Running locally

    MAKEFUN_INPUT_DIR=/path/to/input MAKEFUN_OUTPUT_DIR=/path/to/output node main.ts

`main.ts` reads `cases.json` (`[{ "id": ..., "markdown": ... }, ...]`) from the input directory and
writes `html.json`, the array of rendered strings in the cases' order, to the output directory.
Inside the sandbox those directories are `/input` and `/output` and the harness runs
`node /bot/main.ts` on Node 22, which strips the type annotations itself.

## Licence

MIT — see [LICENSE](LICENSE). The vendored renderer keeps its own MIT licence and notice:
marked 18.1.3, MIT, <https://github.com/markedjs/marked> tag `v18.1.3`, commit
`ba50aa95636ac8f97f46446bbfeb04592ed22216`. See [NOTICE](NOTICE) and `vendor/marked/NOTICE`.
