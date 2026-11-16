// parse(markdown) -> the HTML that marked 18.1.3 produces for that markdown with
// marked's default options (gfm: true, breaks: false, pedantic: false).
//
// The vendored renderer (./vendor/marked/marked.esm.js) is used unchanged for
// two things: the inline lexer (emphasis, links, code spans, raw HTML, escapes,
// entities ...) and the renderer that turns tokens into HTML. Only the *block*
// scan is ours: the document is walked line by line and classified into block
// tokens, instead of being re-scanned from every block start by marked's
// monolithic block regexes.
//
// Reference link definitions are collected in a first phase (they may be used
// before they are defined), and anything the scanner is not sure about aborts
// the fast path for the whole document: the document is then rendered with
// marked.parse(md). Correctness never depends on the scanner being complete.

import { Lexer, Parser, marked } from './vendor/marked/marked.esm.js';

class Bail extends Error {}

const TAB = 9;
const SP = 32;

function isBlank(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c !== SP && c !== TAB) return false;
  }
  return true;
}

function leadSpaces(s) {
  let i = 0;
  while (i < s.length && s.charCodeAt(i) === SP) i++;
  return i;
}

function firstNonSpace(s) {
  let i = 0;
  while (i < s.length && s.charCodeAt(i) === SP) i++;
  return i;
}

// marked's J(): expand tabs to the next multiple of four columns, starting at
// column `col`, over the whole string.
function expandTabs(s, col) {
  let t = col || 0;
  let out = '';
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === TAB) {
      const w = 4 - (t % 4);
      out += s.slice(last, i) + '    '.slice(0, w);
      last = i + 1;
      t += w;
    } else {
      t++;
    }
  }
  return out + s.slice(last);
}

// marked's J() applied to the leading whitespace run only (leadingSpaceTab)
function expandLead(s, col) {
  let k = 0;
  while (k < s.length) {
    const c = s.charCodeAt(k);
    if (c !== SP && c !== TAB) break;
    k++;
  }
  if (k === 0) return s;
  const head = s.slice(0, k);
  if (head.indexOf('\t') === -1) return s;
  return expandTabs(head, col) + s.slice(k);
}

// marked's ge(): trailing blank lines are dropped only when that removes more
// than one line, which is what makes short html/code blocks keep their newline
function trimTrailingBlankLines(a) {
  const e = a.split('\n');
  let t = e.length - 1;
  while (t >= 0 && isBlank(e[t])) t--;
  return e.length - t <= 2 ? a : e.slice(0, t + 1).join('\n');
}

// marked's L(): drop trailing occurrences of a character
function stripEnd(a, ch) {
  let i = a.length;
  while (i > 0 && a.charCodeAt(i - 1) === ch) i--;
  return i === a.length ? a : a.slice(0, i);
}

// how many source lines a raw block spans
function lineSpan(a) {
  let nl = 0;
  for (let i = 0; i < a.length; i++) if (a.charCodeAt(i) === 10) nl++;
  return a.length > 0 && a.charCodeAt(a.length - 1) === 10 ? nl : nl + 1;
}

// marked's F(): the key a link reference definition is stored under
function normLabel(a) {
  return a.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase().toLowerCase();
}

// balanced-paren check used to reject definitions whose destination has
// unbalanced parentheses (marked's ke() === -1 test)
function parensBalanced(a) {
  if (a.indexOf('(') === -1 && a.indexOf(')') === -1) return true;
  let depth = 0;
  for (let i = 0; i < a.length; i++) {
    const ch = a[i];
    if (ch === '\\') i++;
    else if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

const PUNCT = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

// marked's anyPunctuation replacement: a backslash escapes ASCII punctuation
function unescapePunct(s) {
  if (s.indexOf('\\') === -1) return s;
  let out = '';
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 92 && i + 1 < s.length && PUNCT.indexOf(s[i + 1]) !== -1) {
      out += s.slice(last, i) + s[i + 1];
      last = i + 2;
      i++;
    }
  }
  return last === 0 ? s : out + s.slice(last);
}

// ---------------------------------------------------------------------------
// single-line patterns.  Every one of these mirrors a sub-pattern of marked's
// block rules, applied to one line at a time.

const R_ATX = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const R_ATX_BARE = /^#{1,6}(?:[ \t]|$)/;
const R_HR_BARE = /^(?:(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})$/;
const R_HR = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})$/;
const R_BQ = /^ {0,3}>/;
const R_LIST = /^ {0,3}(?:[*+-]|\d{1,9}[.)])(?:[ \t]|$)/;
const R_SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const R_SETEXT_ANY = /^ {0,3}(?:=+|-+) *$/;
const R_DELIM = /^ {0,3}(?:\| *)?:?-+:? *(?:\| *:?-+:? *)*(?:\| *)?$/;
// a paragraph is interrupted by "1." / "1)" only, but by any bullet character
const R_PARA_LIST = /^ {0,3}(?:[*+-]|1[.)])[ \t]+[^ \t]/;
const R_LH_GUARD_LIST = /^ {0,3}(?:[*+-]|\d{1,9}[.)]) /;
const R_LH_GUARD_HTML = /^ {0,3}<[^\n>]+>$/;
const R_LH_GUARD_TABLE = /^ {0,3}\|?(?:[:\- ]*\|)+[:\- ]*$/;
const R_ALIGN_RIGHT = /^ *-+: *$/;
const R_ALIGN_CENTER = /^ *:-+: *$/;
const R_ALIGN_LEFT = /^ *:-+ *$/;

const BLOCK_TAGS =
  'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|' +
  'dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|' +
  'hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|' +
  'search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';
const TAG_SET = new Set(BLOCK_TAGS.split('|'));

const R_TAG_NAME = /^[a-z][a-z0-9]*/i;
const R_RAW_TAG = /^<(script|pre|style|textarea)(?:[\s>]|$)/i;
const R_ATTR =
  /^[ \t]+[a-zA-Z:_][\w.:-]*(?:[ \t]*=[ \t]*(?:"[^"]*"|'[^']*'|[^ \t"'=<>`]+))?/;

// the html block start rules, in marked's order; 0 means "not an html block"
function htmlBlockStart(line) {
  let k = 0;
  while (k < 3 && line.charCodeAt(k) === SP) k++;
  if (line.charCodeAt(k) !== 60) return 0;
  const s = line.slice(k);
  const m = R_RAW_TAG.exec(s);
  if (m) return 1;
  if (s.charCodeAt(1) === 33) {
    if (s.charCodeAt(2) === 45 && s.charCodeAt(3) === 45) return 2;
    if (s.startsWith('<![CDATA[')) return 5;
    const c = s.charCodeAt(2);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) return 4;
    return 0;
  }
  if (s.charCodeAt(1) === 63) return 3;
  // block level tag name
  let p = 1;
  if (s.charCodeAt(1) === 47) p = 2;
  const nm = R_TAG_NAME.exec(s.slice(p));
  if (nm && TAG_SET.has(nm[0].toLowerCase())) {
    const q = p + nm[0].length;
    const c = s.charCodeAt(q);
    if (q === s.length || c === SP || c === TAB || c === 62 || (c === 47 && s.charCodeAt(q + 1) === 62)) {
      return 6;
    }
  }
  // type 7: a complete tag, alone on its line
  if (s.charCodeAt(1) === 47) {
    let q = 2;
    const nm2 = R_TAG_NAME.exec(s.slice(q));
    if (!nm2) return 0;
    q += nm2[0].length;
    while (q < s.length && (s.charCodeAt(q) === SP || s.charCodeAt(q) === TAB)) q++;
    if (s.charCodeAt(q) !== 62) return 0;
    q++;
    while (q < s.length && (s.charCodeAt(q) === SP || s.charCodeAt(q) === TAB)) q++;
    return q === s.length ? 7 : 0;
  }
  let q = 1;
  const nm3 = R_TAG_NAME.exec(s.slice(q));
  if (!nm3) return 0;
  q += nm3[0].length;
  const name = nm3[0].toLowerCase();
  if ((name === 'script' || name === 'pre' || name === 'style' || name === 'textarea') && true) {
    // such a tag is only html type 1 (already handled), never type 7
    return 0;
  }
  for (;;) {
    if (q >= s.length) return 0;
    const a = R_ATTR.exec(s.slice(q));
    if (!a) break;
    q += a[0].length;
  }
  while (q < s.length && (s.charCodeAt(q) === SP || s.charCodeAt(q) === TAB)) q++;
  if (s.charCodeAt(q) === 62) q++;
  else if (s.charCodeAt(q) === 47 && s.charCodeAt(q + 1) === 62) q += 2;
  else return 0;
  while (q < s.length && (s.charCodeAt(q) === SP || s.charCodeAt(q) === TAB)) q++;
  return q === s.length ? 7 : 0;
}

// the looser "<tag" test marked uses inside list items and paragraphs
function htmlBeginAt(line, R) {
  const lead = leadSpaces(line);
  const s = line.slice(lead > R ? R : lead);
  if (s.charCodeAt(0) !== 60) return false;
  const m = R_RAW_TAG.exec(s);
  if (m) return true;
  if (s.charCodeAt(1) === 33) {
    if (s.charCodeAt(2) === 45 && s.charCodeAt(3) === 45) return true;
    if (s.startsWith('<![CDATA[')) return true;
    const c = s.charCodeAt(2);
    return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
  }
  if (s.charCodeAt(1) === 63) return true;
  let p = 1;
  if (s.charCodeAt(1) === 47) p = 2;
  const nm = R_TAG_NAME.exec(s.slice(p));
  if (!nm || !TAG_SET.has(nm[0].toLowerCase())) return false;
  const q = p + nm[0].length;
  const c = s.charCodeAt(q);
  return q === s.length || c === SP || (c === 47 && s.charCodeAt(q + 1) === 62) || c === 62;
}

// a fence opening here -> {ch, len, indent, info}
function fenceOpen(line) {
  let k = 0;
  while (k < 3 && line.charCodeAt(k) === SP) k++;
  const c = line.charCodeAt(k);
  if (c !== 96 && c !== 126) return null;
  let e = k;
  while (e < line.length && line.charCodeAt(e) === c) e++;
  if (e - k < 3) return null;
  const info = line.slice(e);
  if (c === 96 && info.indexOf('`') !== -1) return null;
  return { ch: c === 96 ? '`' : '~', len: e - k, indent: k, info };
}

function fenceClose(line, op) {
  let k = 0;
  while (k < 3 && line.charCodeAt(k) === SP) k++;
  if (line.charCodeAt(k) !== op.ch.charCodeAt(0)) return false;
  let e = k;
  while (e < line.length && line[e] === op.ch) e++;
  if (e - k < op.len) return false;
  for (let i = e; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== SP && c !== TAB) return false;
  }
  return true;
}

// an indented code line: four spaces, or up to three spaces and a tab, then at
// least one more character
function isCodeLine(line) {
  let k = 0;
  while (k < 4 && line.charCodeAt(k) === SP) k++;
  if (k === 4) return line.length > 4;
  if (line.charCodeAt(k) === TAB) return line.length > k + 1;
  return false;
}

// marked's codeRemoveIndent: drop one indentation level from a code line
function stripCodeIndent(line) {
  let k = 0;
  while (k < 4 && line.charCodeAt(k) === SP) k++;
  if (k < 4) {
    if (line.charCodeAt(k) === TAB) return line.slice(k + 1);
    return line.slice(k);
  }
  return line.slice(4);
}

// does this line interrupt a paragraph?  (the lookahead of marked's gfm
// paragraph rule; the table case is handled by the caller)
function interruptsParagraph(line) {
  const lead = leadSpaces(line);
  if (lead >= 4) return false;
  const c = line.charCodeAt(lead);
  if (c === TAB) return false;
  if (lead > 3) return false;
  switch (c) {
    case 35: // #
      return R_ATX.test(line);
    case 62: // >
      return true;
    case 96: // `
    case 126: // ~
      return fenceOpen(line) !== null;
    case 60: // <
      return htmlBeginAt(line, 3);
    case 42: // *
    case 43: // +
    case 45: // -
      if (R_HR.test(line)) return true;
      return R_PARA_LIST.test(line);
    case 95: // _
      return R_HR.test(line);
    default:
      if (c >= 48 && c <= 57) return /^ {0,3}1[.)][ \t]+[^ \t]/.test(line);
      return false;
  }
}

// does this line break the content of a setext heading?  (the guards of
// marked's lheading rule)
function lheadingGuard(line, isLast) {
  const lead = leadSpaces(line);
  if (lead >= 4) return true;
  const c = line.charCodeAt(lead);
  if (c === TAB) return true;
  if (lead > 3) return false;
  switch (c) {
    case 35: // #
      return R_ATX.test(line);
    case 62: // >
      return true;
    case 96: // `
    case 126: // ~
      return fenceOpen(line) !== null;
    case 60: // <
      return R_LH_GUARD_HTML.test(line) && !isLast;
    case 124: // |
      return R_LH_GUARD_TABLE.test(line) && !isLast;
    case 42: // *
    case 43: // +
    case 45: // -
    case 95: // _
      if (R_HR.test(line)) return true;
      return R_LH_GUARD_LIST.test(line);
    default:
      if (c >= 48 && c <= 57) return /^ {0,3}\d{1,9}[.)] /.test(line);
      return false;
  }
}

// ---------------------------------------------------------------------------
// cells of a table row, exactly like marked's de()
function splitCells(text, cols) {
  let t = '';
  let last = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 124) {
      let odd = false;
      for (let p = i - 1; p >= 0 && text.charCodeAt(p) === 92; p--) odd = !odd;
      t += text.slice(last, i) + (odd ? '|' : ' |');
      last = i + 1;
    }
  }
  t += text.slice(last);
  const n = t.split(' |');
  if (!n[0].trim()) n.shift();
  if (n.length > 0 && !n[n.length - 1].trim()) n.pop();
  if (cols) {
    if (n.length > cols) n.length = cols;
    else for (let i = n.length; i < cols; i++) n.push('');
  }
  for (let i = 0; i < n.length; i++) n[i] = n[i].trim().replace(/\\\|/g, '|');
  return n;
}

// ---------------------------------------------------------------------------

function makeCtx(src, top, merge) {
  const L = src.split('\n');
  const off = new Array(L.length + 1);
  off[0] = 0;
  for (let i = 0; i < L.length; i++) off[i + 1] = off[i] + L[i].length + 1;
  return { src, L, off, len: L.length, top, merge };
}

class Scanner {
  constructor(lexer) {
    this.lexer = lexer;
    this.queue = lexer.inlineQueue;
    this.links = Object.create(null);
  }

  // register an inline chunk and return the token array it will fill
  inline(src) {
    const tokens = [];
    this.queue.push({ src, tokens });
    return tokens;
  }

  slice(ctx, a, b) {
    const to = b < ctx.off.length ? ctx.off[b] : ctx.src.length;
    return ctx.src.slice(ctx.off[a], to > ctx.src.length ? ctx.src.length : to);
  }

  run(markdown) {
    let src = markdown;
    if (src.indexOf('\r') !== -1) src = src.replace(/\r\n|\r/g, '\n');
    return this.blocks(makeCtx(src, true, false));
  }

  // -------------------------------------------------------------------------
  // block loop

  blocks(ctx) {
    const L = ctx.L;
    const n = ctx.len;
    const out = [];
    let i = 0;
    let lineStart = true;

    while (i < n) {
      let line = L[i];

      if (isBlank(line)) {
        let k = 0;
        while (i < n && isBlank(L[i])) {
          k++;
          i++;
        }
        const nl = k + (lineStart ? 0 : 1);
        if (nl > 1 || out.length === 0) out.push({ type: 'space', nl });
        lineStart = true;
        continue;
      }

      const type = this.classify(ctx, i);

      switch (type) {
        case 'code': {
          const r = this.indentedCode(ctx, i);
          i = r.end;
          const prev = out[out.length - 1];
          if (prev && (prev.type === 'paragraph' || prev.type === 'text')) {
            prev.raw += prev.raw.endsWith('\n') ? '' : '\n';
            prev.raw += r.raw;
            prev.text += '\n' + r.text;
            this.queue[this.queue.length - 1].src = prev.text;
          } else out.push(r.token);
          lineStart = true;
          continue;
        }
        case 'fence': {
          const r = this.fence(ctx, i);
          out.push(r.token);
          i = r.end;
          lineStart = false;
          continue;
        }
        case 'atx': {
          const line = L[i];
          const depth = atxDepth(line);
          let text = line.slice(leadSpaces(line) + depth).trim();
          if (text.endsWith('#')) {
            const s = stripEnd(text, 35);
            if (!s || s.endsWith(' ') || s.endsWith('\t')) text = s.trim();
          }
          out.push({ type: 'heading', raw: line, depth, text, tokens: this.inline(text) });
          i++;
          lineStart = true;
          while (i < n && isBlank(L[i])) i++;
          continue;
        }
        case 'hr': {
          out.push({ type: 'hr', raw: L[i] });
          i++;
          lineStart = true;
          while (i < n && L[i] === '') i++;
          continue;
        }
        case 'bq': {
          const r = this.blockquote(ctx, i);
          out.push(r.token);
          i = r.end;
          lineStart = true;
          continue;
        }
        case 'list': {
          const r = this.list(ctx, i);
          out.push(r.token);
          i = r.end;
          lineStart = true;
          continue;
        }
        case 'html': {
          const r = this.html(ctx, i);
          out.push(r.token);
          i = r.end;
          lineStart = true;
          continue;
        }
        case 'def': {
          const r = this.def(ctx, i);
          const prev = out[out.length - 1];
          if (prev && (prev.type === 'paragraph' || prev.type === 'text')) {
            prev.raw += prev.raw.endsWith('\n') ? '' : '\n';
            prev.raw += r.raw;
            prev.text += '\n' + r.raw;
            this.queue[this.queue.length - 1].src = prev.text;
          } else {
            if (!Object.prototype.hasOwnProperty.call(this.links, r.tag)) {
              this.links[r.tag] = { href: r.href, title: r.title };
            }
            out.push({ type: 'def', tag: r.tag, raw: r.raw, href: r.href, title: r.title });
          }
          i = r.end;
          lineStart = true;
          continue;
        }
        case 'table': {
          const r = this.table(ctx, i);
          out.push(r.token);
          i = r.end;
          lineStart = true;
          continue;
        }
        case 'setext': {
          const r = this.setext(ctx, i);
          out.push(r.token);
          i = r.end;
          lineStart = true;
          while (i < n && L[i] === '') i++;
          continue;
        }
        default: {
          const r = this.textRun(ctx, i);
          const prev = out[out.length - 1];
          if (ctx.merge && prev && prev.type === 'paragraph' && r.token.type === 'paragraph') {
            prev.raw += prev.raw.endsWith('\n') ? '' : '\n';
            prev.raw += r.token.raw;
            prev.text += '\n' + r.token.text;
            this.queue.pop();
            this.queue[this.queue.length - 1].src = prev.text;
          } else out.push(r.token);
          i = r.end;
          lineStart = false;
          continue;
        }
      }
    }
    return out;
  }

  // -------------------------------------------------------------------------

  classify(ctx, i) {
    const L = ctx.L;
    const line = L[i];
    if (isBlank(line)) return 'blank';
    const lead = leadSpaces(line);
    if (lead >= 4) return 'code';
    const c = line.charCodeAt(lead);
    if (c === TAB) return 'code';
    switch (c) {
      case 96: // `
      case 126: // ~
        return fenceOpen(line) ? 'fence' : 'plain';
      case 35: // #
        return R_ATX.test(line) ? 'atx' : 'plain';
      case 42: // *
      case 43: // +
      case 45: // -
      case 95: // _
        if (R_HR.test(line)) return 'hr';
        if (c !== 95 && R_LIST.test(line)) return 'list';
        break;
      case 62: // >
        return 'bq';
      case 60: // <
        if (htmlBlockStart(line)) return 'html';
        break;
      case 91: // [
        if (this.defAt(ctx, i)) return 'def';
        break;
      default:
        if (c >= 48 && c <= 57 && R_LIST.test(line)) return 'list';
        break;
    }
    if (this.tableAt(ctx, i)) return 'table';
    if (this.setextAt(ctx, i)) return 'setext';
    return 'plain';
  }

  // -------------------------------------------------------------------------

  indentedCode(ctx, i) {
    const L = ctx.L;
    const n = ctx.len;
    let k = i;
    let lastContent = i;
    while (k < n) {
      const line = L[k];
      if (isCodeLine(line)) {
        k++;
        lastContent = k;
        continue;
      }
      if (isBlank(line)) {
        k++;
        continue;
      }
      break;
    }
    const rawSrc = this.slice(ctx, i, k);
    const body = rawSrc.split('\n');
    let text = '';
    for (let j = 0; j < body.length; j++) {
      if (j) text += '\n';
      text += stripCodeIndent(body[j]);
    }
    text = stripEnd(text, 10);
    return {
      token: { type: 'code', raw: rawSrc, codeBlockStyle: 'indented', text },
      end: k,
      raw: rawSrc,
      text,
    };
  }

  fence(ctx, i) {
    const L = ctx.L;
    const n = ctx.len;
    const op = fenceOpen(L[i]);
    let j = i + 1;
    while (j < n && !fenceClose(L[j], op)) j++;
    const closed = j < n;
    const end = closed ? j + 1 : n;
    // content spans lines i+1 .. (closed ? j-1 : n-1); marked's captured group
    // ends right before the closing fence line, without its final newline
    let content = this.slice(ctx, i + 1, closed ? j : n);
    if (content.endsWith('\n')) content = content.slice(0, -1);
    // an unterminated fence never keeps trailing whitespace-only lines
    if (!closed) {
      let cut = content.length;
      while (cut > 0) {
        const ls = content.lastIndexOf('\n', cut - 1) + 1;
        if (!isBlank(content.slice(ls, cut))) break;
        cut = ls > 0 ? ls - 1 : 0;
      }
      content = content.slice(0, cut);
    }
    // marked's indentCodeCompensation, only for backtick fences
    if (op.ch === '`' && op.indent > 0) {
      const parts = content.split('\n');
      for (let q = 0; q < parts.length; q++) {
        const p = parts[q];
        let w = 0;
        while (w < p.length && (p.charCodeAt(w) === SP || p.charCodeAt(w) === TAB)) w++;
        if (w > 0) parts[q] = p.slice(w < op.indent ? w : op.indent);
      }
      content = parts.join('\n');
    }
    const info = op.info;
    const lang = info ? unescapePunct(info.trim()) : info;
    return {
      token: { type: 'code', raw: this.slice(ctx, i, end), lang, text: content },
      end,
    };
  }

  html(ctx, i) {
    const L = ctx.L;
    const n = ctx.len;
    const t = htmlBlockStart(L[i]);
    let j = i;
    if (t === 6 || t === 7) {
      while (j < n && !isBlank(L[j])) j++;
      if (j < n) j++;
    } else if (t === 2) {
      const first = L[i];
      let p = 0;
      while (p < 3 && first.charCodeAt(p) === SP) p++;
      p += 4; // <!--
      let idx = first.indexOf('-->', p);
      if (idx === -1) {
        const alt = first.indexOf('>', p);
        if (alt !== -1 && (alt === p || first.charCodeAt(alt - 1) === 45)) idx = alt;
      }
      if (idx !== -1) j = i + 1;
      else {
        for (j = i + 1; j < n; j++) {
          if (L[j].indexOf('-->') !== -1) {
            j++;
            break;
          }
        }
      }
    } else if (t === 1) {
      const tag = R_RAW_TAG.exec(L[i].slice(leadSpaces(L[i])))[1];
      const re = new RegExp('</' + tag, 'i');
      if (re.test(L[i].slice(L[i].indexOf('>') + 1))) j = i + 1;
      else {
        for (j = i + 1; j < n; j++) {
          if (re.test(L[j])) {
            j++;
            break;
          }
        }
      }
    } else {
      const tok = t === 3 ? '?>' : t === 5 ? ']]>' : '>';
      const first = L[i];
      const start = t === 3 ? 2 : t === 5 ? 9 : 3;
      if (first.indexOf(tok, start) !== -1) j = i + 1;
      else {
        for (j = i + 1; j < n; j++) {
          if (L[j].indexOf(tok) !== -1) {
            j++;
            break;
          }
        }
      }
    }
    const raw = t === 6 || t === 7 ? this.slice(ctx, i, j) : this.slice(ctx, i, j);
    let text = trimTrailingBlankLines(raw);
    // marked's html match ends before the blank line that terminates it (the blank
    // run becomes its own space token), but keeps the newline when a non-blank
    // line stops the block.  Mirror that for the multi-line scans.
    if (j < n - 1 && L[j] === '') {
      let e = text.length;
      while (e > 0 && (text.charCodeAt(e - 1) === 10 || text.charCodeAt(e - 1) === SP)) e--;
      if (e > 0 && e < text.length) text = text.slice(0, e);
    }
    return {
      token: { type: 'html', block: true, raw: text, pre: t === 1, text },
      end: j,
    };
  }

  // does a setext heading start here?
  setextAt(ctx, i) {
    const L = ctx.L;
    const n = ctx.len;
    if (lheadingGuard(L[i], i === n - 1)) return false;
    let j = i + 1;
    while (j < n) {
      const line = L[j];
      if (isBlank(line)) return false;
      if (R_SETEXT.test(line)) return true;
      if (lheadingGuard(line, j === n - 1)) return false;
      j++;
    }
    return false;
  }

  setext(ctx, i) {
    const L = ctx.L;
    const n = ctx.len;
    let j = i + 1;
    while (j < n && !R_SETEXT.test(L[j])) j++;
    const text = this.slice(ctx, i, j).trim();
    const depth = L[j].trim().charCodeAt(0) === 61 ? 1 : 2;
    return {
      token: { type: 'heading', raw: this.slice(ctx, i, j + 1), depth, text, tokens: this.inline(text) },
      end: j + 1,
    };
  }

  // a GFM table header starts here?
  tableAt(ctx, i) {
    const L = ctx.L;
    if (i + 1 >= ctx.len) return false;
    const line = L[i];
    const lead = leadSpaces(line);
    if (lead === line.length) return false;
    const delim = L[i + 1];
    if (!R_DELIM.test(delim)) return false;
    if (!/[:|]/.test(delim)) return false;
    const head = splitCells(line.slice(lead), 0);
    const aligns = delim.replace(/^\||\| *$/g, '').split('|');
    return head.length === aligns.length;
  }

  table(ctx, i) {
    const L = ctx.L;
    const n = ctx.len;
    const lead = leadSpaces(L[i]);
    const head = splitCells(L[i].slice(lead), 0);
    const delim = L[i + 1];
    const aligns = delim.replace(/^\||\| *$/g, '').split('|');
    const align = [];
    for (const a of aligns) {
      if (R_ALIGN_RIGHT.test(a)) align.push('right');
      else if (R_ALIGN_CENTER.test(a)) align.push('center');
      else if (R_ALIGN_LEFT.test(a)) align.push('left');
      else align.push(null);
    }
    let j = i + 2;
    const rows = [];
    while (j < n) {
      const row = L[j];
      // marked's table regex accepts a line that is nothing but a tab as a row
      if (row.trim() === '' && row.indexOf('\t') !== -1) {
        if (j === n - 1) break;
        rows.push(row);
        j++;
        continue;
      }
      if (isBlank(row)) break;
      const k = leadSpaces(row);
      if (k >= 4) break;
      const c = row.charCodeAt(k);
      if (c === TAB) break;
      if (c === 62) break;
      if (c === 35 && R_ATX.test(row)) break;
      if (c === 96 || c === 126) {
        if (fenceOpen(row)) break;
      }
      if (c === 60 && htmlBeginAt(row, 3)) break;
      if (R_HR.test(row)) break;
      if (/^ {0,3}(?:[*+-]|1[.)])[ \t]/.test(row)) break;
      rows.push(row);
      j++;
    }
    const token = { type: 'table', raw: this.slice(ctx, i, j), header: [], align, rows: [] };
    for (let q = 0; q < head.length; q++) {
      token.header.push({
        text: head[q],
        tokens: this.inline(head[q]),
        header: true,
        align: align[q],
      });
    }
    for (const row of rows) {
      const cells = splitCells(row, token.header.length);
      token.rows.push(
        cells.map((cell, q) => ({
          text: cell,
          tokens: this.inline(cell),
          header: false,
          align: align[q],
        })),
      );
    }
    return { token, end: j };
  }

  // -------------------------------------------------------------------------
  // paragraphs, and the plain "text" runs used inside list items

  textRun(ctx, i) {
    const L = ctx.L;
    const n = ctx.len;
    if (!ctx.top) {
      let j = i + 1;
      while (j < n) {
        if (isBlank(L[j])) break;
        if (this.startsAnyBlock(ctx, j)) break;
        j++;
      }
      const text = this.slice(ctx, i, j);
      return { token: { type: 'text', raw: text, text, tokens: this.inline(text) }, end: j };
    }
    let j = i + 1;
    let lhOK = true;
    let under = -1;
    let stop = -1;
    if (lheadingGuard(L[i], i === n - 1)) lhOK = false;
    while (j < n) {
      const line = L[j];
      if (isBlank(line)) {
        if (stop < 0) stop = j;
        break;
      }
      if (lhOK) {
        const c0 = line.charCodeAt(leadSpaces(line));
        if ((c0 === 61 || c0 === 45) && R_SETEXT.test(line)) {
          under = j;
          break;
        }
        if (lheadingGuard(line, j === n - 1)) lhOK = false;
      }
      if (stop < 0) {
        if (interruptsParagraph(line) || this.tableAt(ctx, j)) stop = j;
      }
      j++;
      if (stop >= 0 && !lhOK) break;
    }
    if (under >= 0) {
      const text = this.slice(ctx, i, under).trim();
      const depth = L[under].trim().charCodeAt(0) === 61 ? 1 : 2;
      return {
        token: { type: 'heading', raw: this.slice(ctx, i, under + 1), depth, text, tokens: this.inline(text) },
        end: under + 1,
      };
    }
    const end = stop < 0 ? n : stop;
    const raw = this.slice(ctx, i, end);
    // marked keeps raw's trailing newline but strips exactly one from text
    const text = raw.charCodeAt(raw.length - 1) === 10 ? raw.slice(0, -1) : raw;
    return { token: { type: 'paragraph', raw, text, tokens: this.inline(text) }, end };
  }

  // would a block other than a paragraph start at line j?
  startsAnyBlock(ctx, j) {
    const L = ctx.L;
    const line = L[j];
    const lead = leadSpaces(line);
    if (lead >= 4) return true;
    const c = line.charCodeAt(lead);
    if (c === TAB) return true;
    switch (c) {
      case 96:
      case 126:
        return fenceOpen(line) !== null;
      case 35:
        return R_ATX.test(line);
      case 42:
      case 43:
      case 45:
      case 95:
        if (R_HR.test(line)) return true;
        return c !== 95 && R_LIST.test(line);
      case 62:
        return true;
      case 60:
        return htmlBlockStart(line) !== 0;
      case 91:
        return this.defAt(ctx, j) !== null;
      default:
        if (c >= 48 && c <= 57) return R_LIST.test(line);
        return this.tableAt(ctx, j) || this.setextAt(ctx, j);
    }
  }

  // -------------------------------------------------------------------------
  // link reference definitions

  defAt(ctx, i) {
    return this.def(ctx, i, true) !== null;
  }

  // Link reference definitions are delegated to marked's def tokenizer: its
  // regex settles the label, destination and title (including titles that wrap
  // onto following lines), and it is pure, so the dry lookahead can call it too.
  def(ctx, i, dry) {
    const token = this.lexer.tokenizer.def(ctx.src.slice(ctx.off[i]));
    if (!token) return null;
    const raw = token.raw;
    let nl = 0;
    for (let q = 0; q < raw.length; q++) if (raw.charCodeAt(q) === 10) nl++;
    const end = raw.charCodeAt(raw.length - 1) === 10 ? i + nl : i + nl + 1;
    if (dry) return { tag: token.tag, href: '', title: undefined, raw, end };
    return { tag: token.tag, href: token.href, title: token.title, raw: stripEnd(raw, 10), end };
  }

  // -------------------------------------------------------------------------
  // lists

  // Lists are handed to marked's own list tokenizer: its regex decides the
  // block extent and the item split, and the item bodies are scanned by
  // marked's block rules.  Every list shape marked accepts therefore stays
  // exactly marked's, and the block is still walked only as far as it goes.
  list(ctx, i) {
    const lexer = this.lexer;
    const tk = lexer.tokenizer;
    const token = tk.list(ctx.src.slice(ctx.off[i]));
    if (!token) throw new Bail('list');
    const raw = token.raw;
    let nl = 0;
    for (let q = 0; q < raw.length; q++) if (raw.charCodeAt(q) === 10) nl++;
    const end = raw.charCodeAt(raw.length - 1) === 10 ? i + nl : i + nl + 1;
    return { token, end };
  }

  // the lheading rule applied to a two line string (used by the list scanner)
  lheadingOn(s) {
    const j = s.indexOf('\n');
    if (j < 0) return false;
    if (!R_SETEXT.test(s.slice(j + 1))) return false;
    return !lheadingGuard(s.slice(0, j), false);
  }

  // -------------------------------------------------------------------------
  // block quotes

  // Block quotes are handed to marked's own blockquote tokenizer for the same
  // reason as lists: the quote's extent depends on the paragraph rule's
  // lookahead (lazy continuation, indented content, setext-looking lines), and
  // delegating keeps every one of those shapes exactly marked's.
  blockquote(ctx, i) {
    const token = this.lexer.tokenizer.blockquote(ctx.src.slice(ctx.off[i]));
    if (!token) throw new Bail('blockquote');
    return { token, end: i + lineSpan(token.raw) };
  }
}

const BAIL = Symbol('bail');

// read a link title at position p of `s`; returns {text, end} or BAIL when the
// title would have to continue on another line
function readTitle(s, p) {
  const c = s.charCodeAt(p);
  if (c !== 34 && c !== 39 && c !== 40) return null;
  const close = c === 34 ? '"' : c === 39 ? "'" : ')';
  let q = p + 1;
  while (q < s.length) {
    const ch = s.charCodeAt(q);
    if (ch === 92) {
      q += 2;
      continue;
    }
    if (ch === close) break;
    q++;
  }
  if (q >= s.length) return BAIL;
  return { text: s.slice(p + 1, q), end: q + 1 };
}

function atxDepth(line) {
  let k = 0;
  while (k < 3 && line.charCodeAt(k) === SP) k++;
  let e = k;
  while (e - k < 6 && line.charCodeAt(e) === 35) e++;
  return e - k;
}

// `R` spaces may precede the construct; fewer are allowed as well
function atIndent(line, R) {
  const lead = leadSpaces(line);
  return line.slice(lead > R ? R : lead);
}

function fenceAt(line, R) {
  const s = atIndent(line, R);
  return s.startsWith('```') || s.startsWith('~~~');
}

function headingAt(line, R) {
  return R_ATX_BARE.test(atIndent(line, R));
}

function hrAt(line, R) {
  const s = atIndent(line, R);
  return R_HR_BARE.test(s);
}

function bqAt(line, R) {
  return atIndent(line, R).charCodeAt(0) === 62;
}

function nextBulletAt(line, R) {
  const s = atIndent(line, R);
  const c = s.charCodeAt(0);
  if (c === 42 || c === 43 || c === 45) {
    const d = s.charCodeAt(1);
    return s.length === 1 || d === SP || d === TAB;
  }
  if (c >= 48 && c <= 57) {
    let e = 0;
    while (e < 9) {
      const d = s.charCodeAt(e);
      if (d < 48 || d > 57) break;
      e++;
    }
    const d = s.charCodeAt(e);
    if (d !== 46 && d !== 41) return false;
    const f = s.charCodeAt(e + 1);
    return e + 1 === s.length || f === SP || f === TAB;
  }
  return false;
}

// the paragraph interrupt set used inside a block quote's lazy continuation
function bqInterrupt(line) {
  if (interruptsParagraph(line)) return true;
  const lead = leadSpaces(line);
  if (lead >= 4) return false;
  const c = line.charCodeAt(lead);
  if (c >= 48 && c <= 57) return /^ {0,3}\d{1,9}[.)](?:[ \t]|$)/.test(line);
  return false;
}

const PARSER = new Parser();
let bailCount = 0;

export function parse(markdown) {
  if (typeof markdown !== 'string') return marked.parse(markdown);
  try {
    const lexer = new Lexer();
    const scan = new Scanner(lexer);
    const tokens = scan.run(markdown);
    for (const key in scan.links) lexer.tokens.links[key] = scan.links[key];
    const queue = lexer.inlineQueue;
    for (let i = 0; i < queue.length; i++) {
      lexer.state.inRawBlock = false;
      lexer.inlineTokens(queue[i].src, queue[i].tokens);
    }
    lexer.inlineQueue = [];
    return PARSER.parse(tokens);
  } catch (e) {
    bailCount++;
    if (bailLog !== null) bailLog.push(e && e.message ? e.message : String(e));
    return marked.parse(markdown);
  }
}

let bailLog = null;
export function __bailLog() {
  return bailLog;
}
export function __bailLogStart() {
  bailLog = [];
}

export function __bailCount() {
  return bailCount;
}

export function __resetBail() {
  bailCount = 0;
}

export const __Bail = Bail;
