[![make.fun · markdown-render-speed-02](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/mantraabi/md-fast/rank.svg)](https://make.fun/bounty/markdown-render-speed-02/leaderboard)
[![reward](https://make.fun/badge/markdown-render-speed-02/mantraabi/md-fast/reward.svg)](https://make.fun/bounty/markdown-render-speed-02)

A fast, exact Markdown renderer: a single block scanner walks the input line by
line instead of re-running marked's full block-tokenizer cascade, while the
hard constructs (inline lexing, links, HTML, tables) are delegated to the
vendored marked primitives. The output is byte-identical to marked 18.1.3 with
default options. `main.ts` is a thin Node driver: it reads `cases.json`, renders
every case with `parse()`, and writes the HTML array to `html.json`.

## Run it

```
MAKEFUN_INPUT_DIR=<input dir> MAKEFUN_OUTPUT_DIR=<output dir> node main.ts
```

Made for the [make.fun bounty](https://make.fun/bounty/markdown-render-speed-02?ref=e3qdz3r8).
