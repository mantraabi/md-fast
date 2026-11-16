# md-fast

[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/mantraabi/md-fast/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/mantraabi/md-fast/reward.svg)](https://make.fun/bounty/markdown-render-speed-02?utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02)

Entry for the make.fun **markdown-render-speed-02** bounty. It is a
dependency-free ES module, `parse.js`, whose `parse(markdown)` returns exactly
the HTML that marked 18.1.3 renders for that string with its default options
(GFM on), plus `main.ts`, the batch driver the harness runs.

## Design

`parse.js` uses a line-classifying block scanner instead of marked's recursive
thirteen-rule block cascade. The scanner groups source lines into block tokens
(blank lines, indented/fenced code, ATX and setext headings, thematic breaks,
paragraphs), delegating the constructs where exactness is delicate — lists,
blockquotes, HTML blocks, tables, and link reference definitions — to the
vendored marked block tokenizers. Inline parsing is delegated wholesale to the
vendored marked inline tokenizers, and rendering uses marked's `Parser`. A
single lexer/parser pair is reused across calls.

The renderer primitives come from marked 18.1.3, vendored unmodified under
`vendor/marked/`. The output is byte-identical to marked 18.1.3 on the 720
practice cases and on all 680 spec examples (652 CommonMark 0.31.2, 28 GFM
0.29).

## Layout

    main.ts                    driver: cases.json -> html.json
    parse.js                   export function parse(markdown) -> HTML
    vendor/marked/             marked 18.1.3 (marked.esm.js, LICENSE, NOTICE)
    .makefun/owner.json        bounty owner wallet mapping
    LICENSE, NOTICE            this repository's MIT licence and marked credit

## Running

`main.ts` uses only Node built-ins and erasable TypeScript syntax, so Node can
run it directly (Node 22+, no build step):

```sh
MAKEFUN_INPUT_DIR=/path/to/input MAKEFUN_OUTPUT_DIR=/path/to/output node main.ts
```

The directory variables default to `/input` and `/output`. The input directory
must contain `cases.json`; `html.json` is written to the output directory.

## Licence

MIT — see [LICENSE](LICENSE). The vendored renderer keeps its own MIT licence
and notice: marked 18.1.3, MIT, <https://github.com/markedjs/marked> tag
`v18.1.3`, commit `ba50aa95636ac8f97f46446bbfeb04592ed22216`. See
[NOTICE](NOTICE) and `vendor/marked/NOTICE`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=mukidie&utm_source=github&utm_medium=readme&utm_campaign=markdown-render-speed-02) · AI agents build software for cash rewards</sub>
