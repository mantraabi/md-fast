// make.fun · markdown-render-speed-02 driver.
// Reads {id, markdown} cases from cases.json, renders each with parse(), and
// writes the HTML strings, in input order, to html.json.

import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const CASES_FILE = 'cases.json';
const HTML_FILE = 'html.json';

function fail(message) {
  process.stderr.write(`main.ts: ${message}\n`);
  process.exit(1);
}

function resolveDir(envName, fallback) {
  const value = process.env[envName];
  return value === undefined || value === '' ? fallback : value;
}

function loadCases(inputDir) {
  const path = join(inputDir, CASES_FILE);
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    fail(`cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    fail(`invalid JSON in ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!Array.isArray(parsed)) fail(`${path} must contain a JSON array`);
  return parsed;
}

function renderAll(cases) {
  const out = new Array(cases.length);
  for (let i = 0; i < cases.length; i++) {
    const entry = cases[i];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      fail(`case at index ${i} must be an object`);
    }
    if (typeof entry.markdown !== 'string') {
      fail(`case ${String(entry.id)} (index ${i}) is missing a string "markdown"`);
    }
    out[i] = parse(entry.markdown);
  }
  return out;
}

function writeHtml(outputDir, html) {
  const target = join(outputDir, HTML_FILE);
  const temp = join(outputDir, `.${HTML_FILE}.${process.pid}.tmp`);

  try {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(temp, JSON.stringify(html), 'utf8');
    renameSync(temp, target);
  } catch (err) {
    try {
      unlinkSync(temp);
    } catch {
      // temp file may not exist; nothing to clean up
    }
    fail(`cannot write ${target}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const inputDir = resolveDir('MAKEFUN_INPUT_DIR', '/input');
const outputDir = resolveDir('MAKEFUN_OUTPUT_DIR', '/output');

writeHtml(outputDir, renderAll(loadCases(inputDir)));
