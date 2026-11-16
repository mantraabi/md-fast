# md-fast

A markdown renderer entry for the make.fun **markdown-render-speed-02** competition: a
dependency-free ES module, `parse.js`, whose `parse(markdown)` returns exactly the HTML that
marked 18.1.3 renders for that string with its default (gfm) options — byte for byte, on every
case.

[![make.fun competition](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/c/markdown-render-speed-02)
[![make.fun rank](https://make.fun/badge/markdown-render-speed-02/mantraabi/md-fast/rank.svg)](https://make.fun/c/markdown-render-speed-02)
[![make.fun reward](https://make.fun/badge/markdown-render-speed-02/mantraabi/md-fast/reward.svg)](https://make.fun/c/markdown-render-speed-02)

## How it is faster

`parse.js` replaces marked's block scan, and only the block scan, with a fast scanner:

- The document is walked line by line and each line is classified. The paragraph, heading,
  list, blockquote, HTML, fence and table interrupt rules are reproduced from marked, so a
  block ends exactly where marked's would.
- Everything that is subtle is not rewritten. Inline parsing (emphasis, links, code spans, raw
  HTML, escapes, entities), list items and blockquotes are handed to the vendored marked
  tokenizers, which decide block extent and item splits exactly as marked does. Tokens are then
  rendered by marked's own `Parser`, so the HTML is produced by the same code path.
- There is no per-case fallback to the full marked parser: the bail counter stays 0 over the
  whole practice set, i.e. every case is rendered by the fast path.

## Gates

- **720/720** practice cases produce exactly the reference HTML.
- **680/680** spec examples (CommonMark 0.31.2 + GFM 0.29) produce exactly what marked renders.
- On the practice set, median of repeated runs: block lexing is **~1.16–1.20x** faster and the
  full parse is **~1.15x** faster than the marked-backed baseline.

## Layout

    main.ts                    harness driver (unchanged): reads cases.json, renders, writes html.json
    parse.js                   export function parse(markdown) -> HTML
    vendor/marked/             marked 18.1.3 (marked.esm.js, LICENSE, NOTICE), vendored unmodified
    LICENSE, NOTICE            this repository's MIT licence and the credit to marked

## Running it locally

`main.ts` reads `cases.json` from `MAKEFUN_INPUT_DIR` (default `/input`) and writes `html.json`
to `MAKEFUN_OUTPUT_DIR` (default `/output`):

    MAKEFUN_INPUT_DIR=/path/to/input MAKEFUN_OUTPUT_DIR=/path/to/output node main.ts

## Licence

MIT — see [LICENSE](LICENSE). The vendored renderer keeps its own MIT licence and notice:
marked 18.1.3, MIT, <https://github.com/markedjs/marked> tag `v18.1.3`, commit
`ba50aa95636ac8f97f46446bbfeb04592ed22216`. See [NOTICE](NOTICE) and `vendor/marked/NOTICE`.
