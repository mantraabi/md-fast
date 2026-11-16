# md-fast

A markdown renderer entry for the make.fun **markdown-render-speed-02** competition: a
dependency-free ES module, `parse.js`, whose `parse(markdown)` returns exactly the HTML that
marked 18.1.3 renders for that string with its default options, plus `main.ts`, the driver the
harness runs, which renders every case in `/input/cases.json` and writes `/output/html.json`.
The renderer itself is marked 18.1.3, vendored unmodified under `vendor/marked/`; this entry
is a correct drop-in that later work makes faster, byte for byte identical on every case.

[![make.fun competition](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/c/markdown-render-speed-02)
[![make.fun rank](https://make.fun/badge/markdown-render-speed-02/mantraabi/md-fast/rank.svg)](https://make.fun/c/markdown-render-speed-02)
[![make.fun reward](https://make.fun/badge/markdown-render-speed-02/mantraabi/md-fast/reward.svg)](https://make.fun/c/markdown-render-speed-02)

## Layout

    main.ts                    entrypoint: reads cases.json, renders, writes html.json
    parse.js                   export function parse(markdown) -> HTML
    vendor/marked/             marked 18.1.3 (marked.esm.js, LICENSE, NOTICE), unmodified
    LICENSE, NOTICE            this repository's MIT licence and the credit to marked

## Licence

MIT — see [LICENSE](LICENSE). The vendored renderer keeps its own MIT licence and notice:
marked 18.1.3, MIT, <https://github.com/markedjs/marked> tag `v18.1.3`, commit
`ba50aa95636ac8f97f46446bbfeb04592ed22216`. See [NOTICE](NOTICE) and `vendor/marked/NOTICE`.
