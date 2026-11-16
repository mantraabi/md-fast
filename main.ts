// Entrypoint the harness runs: `node /bot/main.ts` on Node 22, which strips the
// type annotations below on its own. It loads every case from cases.json, renders
// each markdown string with parse() from ./parse.js, and writes the array of HTML
// strings, in the cases' order, to html.json.
//
// Inside the sandbox /input and /output are the mounted directories; outside one,
// MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR take their place, so the same file runs
// on a laptop against the practice set.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

type Case = { id: string; markdown: string };

const inputDir: string = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir: string = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const raw: string = readFileSync(join(inputDir, 'cases.json'), 'utf8');
const cases: Case[] = JSON.parse(raw) as Case[];

const rendered: string[] = new Array(cases.length);
for (let i = 0; i < cases.length; i++) {
  rendered[i] = parse(cases[i].markdown);
}

writeFileSync(join(outputDir, 'html.json'), JSON.stringify(rendered));
