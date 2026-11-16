// Fast markdown renderer: a line-classifying block scanner driven over the
// vendored marked 18.1.3 primitives (block tokenizers for the constructs where
// exactness is hard, inline lexing and rendering delegated wholesale).
//
// The public surface is a single function: parse(markdown) -> html string,
// byte-identical to marked with its default options (gfm on).

import { Lexer, Parser } from './vendor/marked/marked.esm.js';

const CR_RE = /\r\n|\r/g;
const SP = 32;
const TAB = 9;

// ---------------------------------------------------------------------------
// One lexer/parser pair is reused for every call. marked itself mutates the
// shared default options object on construction, so this mirrors a fresh
// Lexer per call while paying the construction cost only once.
// ---------------------------------------------------------------------------
const lexer = new Lexer();
const parser = new Parser(lexer.options);
const BLOCK = lexer.tokenizer.rules.block;
const INLINE_RULES = lexer.tokenizer.rules.inline;

// ---------------------------------------------------------------------------
// Nested block lists. marked's own block lexer is replaced by the scanner for
// list items and blockquote bodies (`state.top === false`), which is where the
// recursive cost of its thirteen-rule cascade shows up. The one call that must
// stay with marked is the blockquote continuation re-run, which merges a fresh
// paragraph into an already emitted token.
// ---------------------------------------------------------------------------
const vendorBlockTokens = Lexer.prototype.blockTokens;

lexer.blockTokens = function (src, tokens, merge) {
  if (merge === true || this.state.top !== false) {
    return vendorBlockTokens.call(this, src, tokens === undefined ? [] : tokens, merge === true);
  }
  return scanBlocks(src, tokens === undefined ? [] : tokens);
};

// ---------------------------------------------------------------------------
// Two cheap leading rejects for the most expensive rule calls marked makes on
// every nested block. A setext underline needs a newline and one of `=`/`-`;
// a table needs a delimiter row on the second line, which always holds a `-`.
// Both rejections are exact (nothing is accepted that marked would accept), so
// results are unchanged and only the pointless regex work disappears.
// ---------------------------------------------------------------------------
const vendorLheading = lexer.tokenizer.lheading;
const vendorTable = lexer.tokenizer.table;

lexer.tokenizer.lheading = function (src) {
  if (src.indexOf('\n') < 0) return undefined;
  if (src.indexOf('=') < 0 && src.indexOf('-') < 0) return undefined;
  return vendorLheading.call(this, src);
};

lexer.tokenizer.table = function (src) {
  const nl = src.indexOf('\n');
  if (nl < 0) return undefined;
  let end = src.indexOf('\n', nl + 1);
  if (end < 0) end = src.length;
  let dash = false;
  for (let k = nl + 1; k < end; k++) {
    const c = src.charCodeAt(k);
    if (c === 45) { dash = true; break; }
    if (c !== 32 && c !== 9 && c !== 124 && c !== 58) return undefined;
  }
  if (!dash) return undefined;
  return vendorTable.call(this, src);
};

const ATX = /^( {0,3})(#{1,6})(?=\s|$)(.*)$/;
const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const LEADING_WS = /^\s+/;
const FENCE_INDENT = /^(\s+)(?:```)/;
const ENDS_HASH = /#$/;
const TRAILING_SPACE = /[ \t]$/;
const CODE_STRIP = /^(?: {0,3}\t| {1,4})/gm;

// Tag names used by marked's html-block / html-interrupt patterns.
const TAGS =
  'address|article|aside|base|basefont|blockquote|body|caption|center|col|' +
  'colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|' +
  'footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|' +
  'link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|' +
  'search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';

// "a line that starts an html block" as far as paragraph interruption goes.
// The `\n` alternative of the tag pattern is folded into `$` because these
// tests run against a single line.
const HTML_INTERRUPT = new RegExp(
  '^ {0,3}(?:</?(?:' + TAGS + ')(?: +|$|/?>)|<(?:script|pre|style|textarea)(?:[\\s>]|$)|<!--|<![A-Za-z]|<!\\[CDATA\\[)'
);

// ---------------------------------------------------------------------------
// small string helpers
// ---------------------------------------------------------------------------

/** true when the line holds only spaces / tabs */
function isBlank(line) {
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== SP && c !== TAB) return false;
  }
  return true;
}

/** strip every trailing occurrence of `code` from `s` */
function stripEnd(s, code) {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === code) end--;
  return end === s.length ? s : s.slice(0, end);
}

/**
 * marked's trailing-blank-line trimmer: at most one trailing blank line is
 * kept, anything more is cut away.
 */
function trimTrailingBlanks(s) {
  const parts = s.split('\n');
  let last = parts.length - 1;
  while (last >= 0 && isBlank(parts[last])) last--;
  if (parts.length - last <= 2) return s;
  let out = '';
  for (let i = 0; i <= last; i++) out += (i ? '\n' : '') + parts[i];
  return out;
}

function countLeadingSpaces(line) {
  let i = 0;
  while (i < line.length && line.charCodeAt(i) === SP) i++;
  return i;
}

/** indented-code prefix width (4 spaces, or up to 3 spaces plus a tab) */
function codeIndent(line) {
  const sp = countLeadingSpaces(line);
  if (sp >= 4) return 4;
  return line.charCodeAt(sp) === TAB ? sp + 1 : 0;
}

/** a line consisting only of dashes/underscores/asterisks (>= 3 of them) */
function isThematicBreak(line) {
  const sp = countLeadingSpaces(line);
  if (sp > 3) return false;
  const mark = line.charCodeAt(sp);
  if (mark !== 45 && mark !== 95 && mark !== 42) return false;
  let count = 0;
  for (let i = sp; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === mark) count++;
    else if (c !== SP && c !== TAB) return false;
  }
  return count >= 3;
}

/** `---` / `===` underline of a setext heading */
function isSetextUnderline(line) {
  const sp = countLeadingSpaces(line);
  if (sp > 3) return false;
  const mark = line.charCodeAt(sp);
  if (mark !== 61 && mark !== 45) return false;
  let i = sp;
  while (i < line.length && line.charCodeAt(i) === mark) i++;
  for (; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c !== SP && c !== TAB) return false;
  }
  return true;
}

/** bullet / ordered marker followed by a space, a tab or the end of line */
function isListMarker(line) {
  const sp = countLeadingSpaces(line);
  if (sp > 3) return false;
  const c = line.charCodeAt(sp);
  let next;
  if (c === 42 || c === 43 || c === 45) {
    next = sp + 1;
  } else if (c >= 48 && c <= 57) {
    let i = sp;
    while (i < line.length && i - sp < 9) {
      const d = line.charCodeAt(i);
      if (d < 48 || d > 57) break;
      i++;
    }
    const delim = line.charCodeAt(i);
    if (delim !== 46 && delim !== 41) return false;
    next = i + 1;
  } else {
    return false;
  }
  if (next === line.length) return true;
  const after = line.charCodeAt(next);
  return after === SP || after === TAB;
}

/**
 * Does this line start a block that ends a paragraph? Mirrors the negative
 * lookahead of marked's paragraph rule line by line.
 */
function breaksParagraph(line, start) {
  const sp = countLeadingSpaces(line);
  if (sp > 3) return false;
  const c = line.charCodeAt(sp);

  // blockquote
  if (c === 62) return true;
  // html block
  if (c === 60) return HTML_INTERRUPT.test(line);
  // atx heading
  if (c === 35) {
    let i = sp;
    while (i < line.length && line.charCodeAt(i) === 35 && i - sp < 7) i++;
    const len = i - sp;
    if (len < 1 || len > 6) return false;
    if (i === line.length) return true;
    const after = line.charCodeAt(i);
    return after === SP || after === TAB;
  }
  // fenced code
  if (c === 96 || c === 126) {
    let i = sp;
    while (i < line.length && line.charCodeAt(i) === c) i++;
    if (i - sp < 3) return false;
    if (c === 126) return true;
    return line.indexOf('`', i) < 0;
  }
  // thematic break
  if (c === 42 || c === 45 || c === 95) {
    if (isThematicBreak(line)) return true;
  }
  // list item: `*+-` or `1.` / `1)` then blanks then a non-blank
  if (c === 42 || c === 43 || c === 45 || c === 49) {
    let i = sp + 1;
    if (c === 49) {
      const d = line.charCodeAt(i);
      if (d !== 46 && d !== 41) return false;
      i++;
    }
    let blanks = 0;
    while (i < line.length) {
      const d = line.charCodeAt(i);
      if (d !== SP && d !== TAB) break;
      i++;
      blanks++;
    }
    if (blanks > 0 && i < line.length) return true;
  }
  // pipe table: handled by the caller, which knows the following line
  return false;
}

/** table delimiter row (deliberately loose: superset of marked's pattern) */
function isDelimiterRow(line) {
  const sp = countLeadingSpaces(line);
  if (sp > 3 || sp >= line.length) return false;
  let dash = false;
  for (let i = sp; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === 45) dash = true;
    else if (c !== 124 && c !== 58 && c !== SP && c !== TAB) return false;
  }
  return dash;
}

/** first line of a setext heading may not start a different block */
function blocksSetextStart(line, hasNewline) {
  const sp = countLeadingSpaces(line);
  if (sp > 3) return false;
  const c = line.charCodeAt(sp);
  if (sp >= 4 || c === TAB) return true;
  if (c === 62) return true;
  if (c === 96 || c === 126) {
    let i = sp;
    while (i < line.length && line.charCodeAt(i) === c) i++;
    if (i - sp >= 3) return true;
  }
  if (c === 42 || c === 43 || c === 45) {
    const after = line.charCodeAt(sp + 1);
    if (after === SP) return true;
  }
  if (c >= 48 && c <= 57) {
    let i = sp;
    while (i < line.length && i - sp < 9 && line.charCodeAt(i) >= 48 && line.charCodeAt(i) <= 57) i++;
    const delim = line.charCodeAt(i);
    if ((delim === 46 || delim === 41) && line.charCodeAt(i + 1) === SP) return true;
  }
  if (c === 35) {
    let i = sp;
    while (i < line.length && line.charCodeAt(i) === 35 && i - sp < 7) i++;
    const len = i - sp;
    if (len >= 1 && len <= 6) {
      if (i === line.length) return true;
      const after = line.charCodeAt(i);
      if (after === SP || after === TAB) return true;
    }
  }
  if (c === 60 && hasNewline) {
    // generic `<tag>` line
    const close = line.indexOf('>', sp + 1);
    if (close > sp + 1 && close === line.length - 1 && line.indexOf('>', sp + 1) === close && line.slice(sp + 1, close).indexOf('>') < 0) return true;
  }
  if (hasNewline && line.indexOf('|') > sp) {
    let only = true;
    for (let i = sp; i < line.length; i++) {
      const d = line.charCodeAt(i);
      if (d !== 124 && d !== 58 && d !== 45 && d !== SP) {
        only = false;
        break;
      }
    }
    if (only) return true;
  }
  return false;
}

/** does this line end the body of a setext heading? */
function breaksSetextBody(line, hasNewline) {
  const sp = countLeadingSpaces(line);
  if (sp > 4) return false;
  const c = line.charCodeAt(sp);
  if (sp === 4 || (sp <= 3 && c === TAB)) return false;
  if (c === 62) return true;
  if (c === 96 || c === 126) {
    let i = sp;
    while (i < line.length && line.charCodeAt(i) === c) i++;
    if (i - sp >= 3) return true;
  }
  if (c === 42 || c === 43 || c === 45) {
    if (line.charCodeAt(sp + 1) === SP) return true;
    if (isThematicBreak(line)) return true;
  }
  if (c === 95) {
    if (isThematicBreak(line)) return true;
  }
  if (c >= 48 && c <= 57) {
    let i = sp;
    while (i < line.length && i - sp < 9 && line.charCodeAt(i) >= 48 && line.charCodeAt(i) <= 57) i++;
    const delim = line.charCodeAt(i);
    if ((delim === 46 || delim === 41) && line.charCodeAt(i + 1) === SP) return true;
  }
  if (c === 35) {
    let i = sp;
    while (i < line.length && line.charCodeAt(i) === 35 && i - sp < 7) i++;
    const len = i - sp;
    if (len >= 1 && len <= 6) {
      if (i === line.length) return true;
      const after = line.charCodeAt(i);
      if (after === SP || after === TAB) return true;
    }
  }
  if (c === 60 && hasNewline) {
    const close = line.indexOf('>', sp + 1);
    if (close > sp + 1 && close === line.length - 1 && line.slice(sp + 1, close).indexOf('>') < 0) return true;
  }
  if (hasNewline && line.indexOf('|') > sp) {
    let only = true;
    for (let i = sp; i < line.length; i++) {
      const d = line.charCodeAt(i);
      if (d !== 124 && d !== 58 && d !== 45 && d !== SP) {
        only = false;
        break;
      }
    }
    if (only) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// block scanner
// ---------------------------------------------------------------------------

function scanBlocks(src, tokens) {
  // Inside a list item or a blockquote body marked clears `state.top`; the
  // fallback block there is a one-line `text` token instead of a paragraph.
  const nested = lexer.state.top === false;
  const lines = src.split('\n');
  const total = lines.length;
  const len = src.length;
  const starts = new Array(total);
  let offset = 0;
  for (let i = 0; i < total; i++) {
    starts[i] = offset;
    offset += lines[i].length + 1;
  }

  let pos = 0;
  let i = 0;
  while (pos < len) {
    // the line whose start offset is >= pos (a pending newline left over by
    // the previous block lands just before the next line)
    while (i < total && starts[i] < pos) i++;
    const start = pos;
    const line = lines[i];

    // ---- blank line / leftover newline ------------------------------------
    let sp = 0;
    while (sp < line.length && line.charCodeAt(sp) === SP) sp++;
    const head = sp < line.length ? line.charCodeAt(sp) : -1;

    if (pos < starts[i] || head === -1 || (head === TAB && isBlank(line))) {
      let j = i;
      while (j < total && isBlank(lines[j])) j++;
      const end = j < total ? starts[j] : len;
      const raw = src.slice(start, end);
      if (raw.length === 1 && tokens.length > 0) tokens[tokens.length - 1].raw += '\n';
      else tokens.push({ type: 'space', raw });
      pos = end;
      continue;
    }

    // ---- indented code ---------------------------------------------------
    if (sp >= 4 || head === TAB) {
      let j = i;
      let end = len;
      for (;;) {
        if (j + 1 >= total) {
          end = len;
          j = total;
          break;
        }
        let k = j + 1;
        while (k < total && isBlank(lines[k])) k++;
        end = k < total ? starts[k] : len;
        if (k < total && codeIndent(lines[k]) > 0) {
          j = k;
          continue;
        }
        j = k;
        break;
      }
      const raw = trimTrailingBlanks(src.slice(start, end));
      const codeText = raw.replace(CODE_STRIP, '');
      const above = tokens.length > 0 ? tokens[tokens.length - 1] : undefined;
      if (above !== undefined && (above.type === 'paragraph' || above.type === 'text')) {
        above.raw += (above.raw.endsWith('\n') ? '' : '\n') + raw;
        above.text += '\n' + codeText;
        const q = lexer.inlineQueue;
        q[q.length - 1].src = above.text;
      } else {
        tokens.push({
          type: 'code',
          raw,
          codeBlockStyle: 'indented',
          text: codeText,
        });
      }
      pos = end;
      continue;
    }

    // ---- fenced code -----------------------------------------------------
    if (head === 96 || head === 126) {
      const m = FENCE_OPEN.exec(line);
      if (m !== null && (head === 126 || m[3].indexOf('`') < 0)) {
        const mark = m[2];
        const markChar = mark.charCodeAt(0);
        const markLen = mark.length;
        let close = -1;
        for (let j = i + 1; j < total; j++) {
          const ln = lines[j];
          let p = 0;
          while (p < 3 && ln.charCodeAt(p) === SP) p++;
          let q = p;
          while (q < ln.length && ln.charCodeAt(q) === markChar) q++;
          if (q - p < markLen) continue;
          let tail = true;
          for (let r = q; r < ln.length; r++) {
            if (ln.charCodeAt(r) !== SP) {
              tail = false;
              break;
            }
          }
          if (tail) {
            close = j;
            break;
          }
        }
        let info;
        let content;
        let raw;
        if (close >= 0) {
          const parts = [];
          for (let j = i + 1; j < close; j++) parts.push(lines[j]);
          content = parts.length ? parts.join('\n') : '';
          raw = src.slice(start, starts[close] + lines[close].length);
        } else {
          const rest = src.slice(starts[i + 1] !== undefined ? starts[i + 1] : len);
          content = rest.length > 0 && rest.charCodeAt(rest.length - 1) === 10 ? rest.slice(0, -1) : rest;
          raw = src.slice(start, len);
        }
        info = m[3];
        const indentMatch = FENCE_INDENT.exec(raw);
        let text = content;
        if (indentMatch !== null) {
          const width = indentMatch[1].length;
          const rows = content.split('\n');
          for (let r = 0; r < rows.length; r++) {
            const lead = LEADING_WS.exec(rows[r]);
            if (lead !== null) rows[r] = rows[r].slice(Math.min(lead[0].length, width));
          }
          text = rows.join('\n');
        }
        tokens.push({
          type: 'code',
          raw,
          lang: info ? info.trim().replace(INLINE_RULES.anyPunctuation, '$1') : info,
          text,
        });
        pos = start + raw.length;
        continue;
      }
    }

    // ---- atx heading -----------------------------------------------------
    if (head === 35) {
      const m = ATX.exec(line);
      if (m !== null) {
        let text = m[3].trim();
        if (ENDS_HASH.test(text)) {
          const cut = stripEnd(text, 35);
          if (cut.length === 0 || TRAILING_SPACE.test(cut)) text = cut.trim();
        }
        tokens.push({
          type: 'heading',
          raw: line,
          depth: m[2].length,
          text,
          tokens: lexer.inline(text),
        });
        pos = start + line.length;
        continue;
      }
    }

    // ---- thematic break --------------------------------------------------
    if (head === 42 || head === 45 || head === 95) {
      if (isThematicBreak(line)) {
        tokens.push({ type: 'hr', raw: line });
        pos = start + line.length;
        continue;
      }
    }

    // ---- blockquote (delegated) -----------------------------------------
    if (head === 62) {
      const tok = lexer.tokenizer.blockquote(src.slice(start));
      if (tok !== undefined) {
        tokens.push(tok);
        pos = start + tok.raw.length;
        continue;
      }
    }

    // ---- list (delegated) ------------------------------------------------
    if (isListMarker(line)) {
      const tok = lexer.tokenizer.list(src.slice(start));
      if (tok !== undefined) {
        tokens.push(tok);
        pos = start + tok.raw.length;
        continue;
      }
    }

    // ---- html block (delegated) ------------------------------------------
    if (head === 60) {
      const tok = lexer.tokenizer.html(src.slice(start));
      if (tok !== undefined) {
        tokens.push(tok);
        pos = start + tok.raw.length;
        continue;
      }
    }

    // ---- link reference definition (delegated) ---------------------------
    if (head === 91) {
      const def = lexer.tokenizer.def(src.slice(start));
      if (def !== undefined) {
        const above = tokens.length > 0 ? tokens[tokens.length - 1] : undefined;
        if (above !== undefined && (above.type === 'paragraph' || above.type === 'text')) {
          // nested content: a definition folds into the text run above it
          above.raw += (above.raw.charCodeAt(above.raw.length - 1) === 10 ? '' : '\n') + def.raw;
          above.text += '\n' + def.raw;
          const queue = lexer.inlineQueue;
          queue[queue.length - 1].src = above.text;
        } else {
          const links = lexer.tokens.links;
          if (links[def.tag] === undefined) {
            links[def.tag] = { href: def.href, title: def.title };
          }
          tokens.push(def);
        }
        pos = start + def.raw.length;
        continue;
      }
    }

    // ---- table (delegated) ------------------------------------------------
    if (i + 1 < total && isDelimiterRow(lines[i + 1])) {
      const tok = lexer.tokenizer.table(src.slice(start));
      if (tok !== undefined) {
        tokens.push(tok);
        pos = start + tok.raw.length;
        continue;
      }
    }

    // ---- setext heading ---------------------------------------------------
    if (!blocksSetextStart(line, i < total - 1)) {
      let j = i + 1;
      let underline = -1;
      while (j < total) {
        const ln = lines[j];
        if (isBlank(ln)) break;
        if (isSetextUnderline(ln)) {
          underline = j;
          break;
        }
        if (breaksSetextBody(ln, j < total - 1)) break;
        j++;
      }
      if (underline >= 0) {
        let text = '';
        for (let k = i; k < underline; k++) text += (k > i ? '\n' : '') + lines[k];
        text = text.trim();
        const underlineRaw = lines[underline];
        const markChar = underlineRaw.charCodeAt(countLeadingSpaces(underlineRaw));
        const raw = src.slice(start, starts[underline] + underlineRaw.length);
        tokens.push({
          type: 'heading',
          raw,
          depth: markChar === 61 ? 1 : 2,
          text,
          tokens: lexer.inline(text),
        });
        pos = start + raw.length;
        continue;
      }
    }

    // ---- fallback: paragraph (document level) or single-line text (nested)
    if (nested) {
      // In a nested block list (list item / blockquote body) marked emits one
      // `text` token per line and folds each following line into the previous
      // text token, keeping a single entry in the inline queue.
      const above = tokens.length > 0 ? tokens[tokens.length - 1] : undefined;
      if (above !== undefined && above.type === 'text') {
        above.raw += above.raw.charCodeAt(above.raw.length - 1) === 10 ? '' : '\n';
        above.raw += line;
        above.text += '\n' + line;
        const queue = lexer.inlineQueue;
        queue[queue.length - 1].src = above.text;
      } else {
        tokens.push({ type: 'text', raw: line, text: line, tokens: lexer.inline(line) });
      }
      pos = start + line.length;
      continue;
    }

    let j = i + 1;
    while (j < total) {
      const ln = lines[j];
      if (isBlank(ln)) break;
      if (breaksParagraph(ln, starts[j])) break;
      if (
        j + 1 < total &&
        isDelimiterRow(lines[j + 1]) &&
        BLOCK.table.test(src.slice(starts[j]))
      ) {
        break;
      }
      j++;
    }
    const stop = j > i ? starts[j - 1] + lines[j - 1].length : starts[i] + line.length;
    const text = src.slice(start, stop);
    tokens.push({
      type: 'paragraph',
      raw: text,
      text,
      tokens: lexer.inline(text),
    });
    i = j;
    pos = start + text.length;
  }

  lexer.state.top = true;
  return tokens;
}

// ---------------------------------------------------------------------------
// public entry points
// ---------------------------------------------------------------------------

function tokenize(markdown) {
  const src = markdown.replace(CR_RE, '\n');
  const tokens = [];
  tokens.links = Object.create(null);

  lexer.tokens = tokens;
  lexer.inlineQueue = [];
  lexer.state = {
    inLink: false,
    inRawBlock: false,
    linkEmitted: false,
    linkParenPossible: true,
    top: true,
  };
  lexer.tokenizer.lexer = lexer;

  scanBlocks(src, tokens);

  // flush one level of inline work, in the order the blocks were created
  const queue = lexer.inlineQueue;
  const state = lexer.state;
  for (let i = 0; i < queue.length; i++) {
    state.inRawBlock = false;
    lexer.inlineTokens(queue[i].src, queue[i].tokens);
  }
  lexer.inlineQueue = [];

  return tokens;
}

export function parse(markdown) {
  return parser.parse(tokenize(markdown));
}

// debug helper for the local differential harness
export function __tokens(markdown) {
  return tokenize(markdown);
}
