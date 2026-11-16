import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parse } from './parse.js';

type RenderCase = {
  id: string;
  markdown: string;
};

const CASES_FILE = 'cases.json';
const HTML_FILE = 'html.json';
const FALLBACK_INPUT = '/input';
const FALLBACK_OUTPUT = '/output';

function resolveInputDirectory(): string {
  const configured = process.env.MAKEFUN_INPUT_DIR;
  return configured !== undefined && configured.length > 0 ? configured : FALLBACK_INPUT;
}

function resolveOutputDirectory(): string {
  const configured = process.env.MAKEFUN_OUTPUT_DIR;
  return configured !== undefined && configured.length > 0 ? configured : FALLBACK_OUTPUT;
}

function abort(message: string): never {
  process.stderr.write(`main.ts: ${message}\n`);
  process.exit(1);
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function coerceCase(entry: unknown, index: number): RenderCase {
  if (!isRecord(entry)) {
    abort(`case at index ${index} is not an object`);
  }
  const { id, markdown } = entry;
  if (typeof id !== 'string') {
    abort(`case at index ${index} has a non-string "id"`);
  }
  if (typeof markdown !== 'string') {
    abort(`case at index ${index} has a non-string "markdown"`);
  }
  return { id, markdown };
}

async function loadCases(directory: string): Promise<RenderCase[]> {
  const file = join(directory, CASES_FILE);

  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    abort(`cannot read ${file}: ${describeError(error)}`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    abort(`${file} is not valid JSON: ${describeError(error)}`);
  }

  if (!Array.isArray(payload)) {
    abort(`${file} must contain a JSON array`);
  }

  return payload.map((entry, index) => coerceCase(entry, index));
}

function renderAll(cases: RenderCase[]): string[] {
  const rendered: string[] = new Array(cases.length);

  for (let index = 0; index < cases.length; index += 1) {
    const current = cases[index];
    try {
      rendered[index] = parse(current.markdown);
    } catch (error) {
      abort(`failed to render case "${current.id}": ${describeError(error)}`);
    }
  }

  return rendered;
}

async function saveHtml(directory: string, html: string[]): Promise<void> {
  const file = join(directory, HTML_FILE);

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(file, JSON.stringify(html), 'utf8');
  } catch (error) {
    abort(`cannot write ${file}: ${describeError(error)}`);
  }
}

async function main(): Promise<void> {
  const cases = await loadCases(resolveInputDirectory());
  const rendered = renderAll(cases);
  await saveHtml(resolveOutputDirectory(), rendered);
  process.stdout.write(`wrote ${rendered.length} HTML string(s) to ${HTML_FILE}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`main.ts: unexpected failure: ${describeError(error)}\n`);
  process.exitCode = 1;
});
