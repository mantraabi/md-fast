// Batch driver for the make.fun markdown-render-speed-02 harness.
//
// Reads cases.json (a bare array of { id, markdown }) from the input directory,
// renders each markdown with parse() from ./parse.js, and writes html.json (a
// bare array of HTML strings, same order) to the output directory.
//
// Node runs this directly: `node main.ts`. The type annotations are erasable,
// so Node's built-in type stripping handles them without a compiler.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from 'node:process';
import { parse } from './parse.js';

type Case = { id: string; markdown: string };

function loadCases(inputDir: string): Case[] {
  const text = readFileSync(join(inputDir, 'cases.json'), 'utf8');
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) {
    throw new TypeError('cases.json must contain a JSON array');
  }
  return data as Case[];
}

const inputDir: string = env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir: string = env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases: Case[] = loadCases(inputDir);
const html: string[] = new Array(cases.length);
for (let i = 0; i < cases.length; i++) {
  html[i] = parse(cases[i].markdown);
}

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'html.json'), JSON.stringify(html));
