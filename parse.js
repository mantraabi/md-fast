// parse(markdown) -> the HTML marked 18.1.3 renders for that markdown with its
// default options (gfm true, breaks false, pedantic false, async false).
//
// The renderer itself is vendored unmodified at ./vendor/marked/marked.esm.js
// (MIT; see vendor/marked/LICENSE, vendor/marked/NOTICE and the root NOTICE).
// Every call hands the input straight to marked: no options are passed and
// nothing is kept between calls, so parse(x) always answers exactly what
// marked.parse(x) answers for that string alone.

import { marked } from './vendor/marked/marked.esm.js';

export function parse(markdown) {
  return marked.parse(markdown);
}
