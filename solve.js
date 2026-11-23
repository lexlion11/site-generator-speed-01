// Fast, dependency-free reimplementation of makefun-site 1.0.0 (MIT).
// run(input) returns exactly what makefun-site's build(input) returns: the same output tree, byte for byte.
// The reference (metalsmith-shaped plugins over one build, marked-shaped markdown, tree-walking templates) is
// correct but slow; this is a monolithic pass over the same pipeline that keeps every rule identical while
// avoiding the per-character escape regex, the per-plugin object churn and the interpretive template walk.

// ---------------------------------------------------------------- text

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const RE_HTML_TEST = /[&<>"']/;

/** `text` with & < > " and ' escaped (the reference's rule, table-scanned; the identity fast path keeps plain
 *  runs untouched). */
function escapeHtml(text) {
  const n = text.length;
  if (n === 0 || !RE_HTML_TEST.test(text)) return text;
  let out = '';
  let start = 0;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    let e = null;
    if (c === 38) e = '&amp;';
    else if (c === 60) e = '&lt;';
    else if (c === 62) e = '&gt;';
    else if (c === 34) e = '&quot;';
    else if (c === 39) e = '&#39;';
    if (e !== null) {
      if (start < i) out += text.slice(start, i);
      out += e;
      start = i + 1;
    }
  }
  if (start === 0) return text;
  if (start < n) out += text.slice(start);
  return out;
}

const SLUG_MAX = 64;

const slugCache = new Map();
const SLUG_CACHE_MAX = 16384;

/** The slug of `text` (the reference's rule: NFKD, combining marks dropped, A-Z lowered, runs of others one "-",
 *  none at either end, at most SLUG_MAX characters, "untitled" when empty). Pure, so memoised. */
function slugify(text) {
  const hit = slugCache.get(text);
  if (hit !== undefined) return hit;
  const plain = text.normalize('NFKD').replace(/\p{M}/gu, '');
  let out = '';
  let gap = false;
  for (let i = 0; i < plain.length; i++) {
    const ch = plain.charCodeAt(i);
    let keep = 0;
    if (ch >= 65 && ch <= 90) keep = ch + 32;
    else if ((ch >= 97 && ch <= 122) || (ch >= 48 && ch <= 57)) keep = ch;
    if (keep === 0) {
      gap = out.length > 0;
      continue;
    }
    if (gap) out += '-';
    gap = false;
    out += String.fromCharCode(keep);
  }
  out = out.slice(0, SLUG_MAX).replace(/-+$/, '');
  if (out === '') out = 'untitled';
  if (slugCache.size < SLUG_CACHE_MAX) slugCache.set(text, out);
  return out;
}

/** `slug` made unique against `taken` (and added to it): the first of slug, slug-2, slug-3 ... not taken. */
function uniqueSlug(slug, taken) {
  let out = slug;
  for (let n = 2; taken.has(out); n++) out = `${slug}-${n}`;
  taken.add(out);
  return out;
}

/** A YYYY-MM-DD date in words, from the string alone: "2026-11-09" is "9 November 2026". */
function longDate(date) {
  const [y, m, d] = date.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

// ---------------------------------------------------------------- front matter (the reference's grammar, verbatim rules)

const FM_KEYS = ['title', 'date', 'tags', 'draft', 'layout', 'slug', 'summary'];

const FM_LINE = /^([a-z_]+):(?: (.*))?$/;
const FM_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const FM_NAME = /^[a-z0-9-]+$/;
const FM_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FM_TAG = /^[^"[\]]+$/;

function daysIn(y, m) {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return (m === 4 || m === 6 || m === 9 || m === 11) ? 30 : 31;
}

function stringOf(raw) {
  if (raw.startsWith('"')) {
    if (raw.length < 2 || !raw.endsWith('"')) return { error: 'a quoted string is not closed' };
    let out = '';
    for (let i = 1; i < raw.length - 1; i++) {
      const c = raw[i];
      if (c === '\\') {
        const n = raw[i + 1];
        if ((n !== '"' && n !== '\\') || i + 1 === raw.length - 1) return { error: 'a quoted string holds an escape other than \\" or \\\\' };
        out += n;
        i++;
      } else if (c === '"') return { error: 'a quoted string holds a stray quote' };
      else out += c;
    }
    return { value: out };
  }
  if (raw.startsWith('[')) return { error: 'a bare string opens on [' };
  return { value: raw };
}

function valueOf(key, raw) {
  switch (key) {
    case 'title':
    case 'summary': {
      const s = stringOf(raw);
      return 'error' in s ? { error: `key "${key}": ${s.error}` } : s;
    }
    case 'date': {
      const m = FM_DATE.exec(raw);
      const y = m ? Number(m[1]) : 0;
      const mo = m ? Number(m[2]) : 0;
      const d = m ? Number(m[3]) : 0;
      if (!m || y < 1970 || y > 2099 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return { error: 'key "date": not a date from 1970-01-01 to 2099-12-31 (YYYY-MM-DD)' };
      return { value: raw };
    }
    case 'tags': {
      if (!raw.startsWith('[') || !raw.endsWith(']')) return { error: 'key "tags": not a list [a, b]' };
      const inner = raw.slice(1, -1);
      if (inner.trim() === '') return { value: [] };
      const tags = inner.split(',').map((t) => t.trim());
      if (tags.some((t) => t === '' || !FM_TAG.test(t))) return { error: 'key "tags": an empty tag, or one holding " [ or ]' };
      return { value: tags };
    }
    case 'draft':
      return raw === 'true' ? { value: true } : raw === 'false' ? { value: false } : { error: 'key "draft": true or false' };
    case 'layout':
      return FM_NAME.test(raw) ? { value: raw } : { error: 'key "layout": not a template name' };
    case 'slug':
      return FM_SLUG.test(raw) && raw.length <= 64 ? { value: raw } : { error: 'key "slug": not a slug' };
    default:
      return { error: `unknown key "${key}"` };
  }
}

/** A source's front matter and body: { data, body }, or { error } with the first reason it is refused. */
function parseFrontMatter(text) {
  const lines = text.split('\n');
  if (lines[0] !== '---') return { error: 'no front matter' };
  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      close = i;
      break;
    }
  }
  if (close === -1) return { error: 'the front matter is not closed' };
  const data = {};
  for (let i = 1; i < close; i++) {
    const line = lines[i];
    if (line === '' || line === ' ' || line === '\t' || /^[ \t]+$/.test(line) || line.startsWith('#')) continue;
    const m = FM_LINE.exec(line);
    if (!m) return { error: `line ${i + 1} is not "key: value"` };
    const key = m[1];
    const raw = (m[2] ?? '').replace(/[ \t]+$/, '');
    if (!FM_KEYS.includes(key)) return { error: `unknown key "${key}"` };
    if (Object.hasOwn(data, key)) return { error: `key "${key}" is given twice` };
    if (raw === '') return { error: `key "${key}" has no value` };
    const v = valueOf(key, raw);
    if ('error' in v) return v;
    data[key] = v.value;
  }
  if (!Object.hasOwn(data, 'title')) return { error: 'no title' };
  return { data, bodyLines: lines.slice(close + 1) };
}

// ---------------------------------------------------------------- markdown (the reference's subset, same shapes)

const BLANK = /^[ \t]*$/;
const FENCE_OPEN = /^```([A-Za-z0-9_+-]*)[ \t]*$/;
const FENCE_CLOSE = /^```[ \t]*$/;
const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const HR = /^(?:---|\*\*\*)[ \t]*$/;
const QUOTE = /^>/;
const BULLET = /^[-*] (.*)$/;
const ORDERED = /^(\d{1,9})\. (.*)$/;
const CONTINUED = /^ {2,}\S/;

function headingOf(line) {
  const m = HEADING.exec(line);
  return m === null || m[2] === '' ? null : { depth: m[1].length, text: m[2] };
}

function endsParagraph(line) {
  // blank, fence, heading or thematic break — each opens on a character of its own, so dispatch on the first
  const c0 = line.charCodeAt(0);
  if (line.length === 0 || c0 === 32 || c0 === 9) return BLANK.test(line);
  if (c0 === 96) return FENCE_OPEN.test(line);
  if (c0 === 35) return headingOf(line) !== null;
  if (c0 === 45 || c0 === 42) return HR.test(line);
  return false;
}

const trimLine = (line) => {
  const n = line.length;
  if (n === 0) return line;
  const first = line.charCodeAt(0);
  const last = line.charCodeAt(n - 1);
  if ((first !== 32 && first !== 9) && (last !== 32 && last !== 9)) return line;
  return line.replace(/^[ \t]+|[ \t]+$/g, '');
};

/** `lines`'s block tokens, in order (the reference's lex over the source's body lines, already split). */
function lex(lines) {
  const tokens = [];
  let i = 0;
  const len = lines.length;
  while (i < len) {
    const line = lines[i];
    // every block opener opens on a character of its own, so the first character decides which tests a line needs
    const c0 = line.charCodeAt(0);
    if (line.length === 0 || c0 === 32 || c0 === 9) {
      if (BLANK.test(line)) {
        i++;
        continue;
      }
      // a non-blank line of spaces or tabs can only be a paragraph line
    } else if (c0 === 96) {
      const fence = FENCE_OPEN.exec(line);
      if (fence !== null) {
        const body = [];
        i++;
        while (i < len && !FENCE_CLOSE.test(lines[i])) body.push(lines[i++]);
        i++;
        tokens.push({ type: 'code', lang: fence[1], lines: body });
        continue;
      }
    } else if (c0 === 35) {
      const heading = headingOf(line);
      if (heading !== null) {
        tokens.push({ type: 'heading', depth: heading.depth, text: heading.text });
        i++;
        continue;
      }
    } else if (c0 === 45 || c0 === 42) {
      if (HR.test(line)) {
        tokens.push({ type: 'hr' });
        i++;
        continue;
      }
      const bullet = BULLET.exec(line);
      if (bullet !== null) {
        const items = [];
        while (i < len) {
          const m = BULLET.exec(lines[i]);
          if (m !== null) {
            items.push([trimLine(m[1])]);
            i++;
          } else if (CONTINUED.test(lines[i])) {
            items[items.length - 1].push(trimLine(lines[i]));
            i++;
          } else break;
        }
        tokens.push({ type: 'list', ordered: false, start: 1, items: items.map((parts) => parts.join('\n')) });
        continue;
      }
    } else if (c0 === 62) {
      const body = [];
      while (i < len && QUOTE.test(lines[i])) body.push(lines[i++].replace(/^> ?/, ''));
      tokens.push({ type: 'blockquote', lines: body.map(trimLine).filter((l) => l !== '') });
      continue;
    } else if (c0 >= 48 && c0 <= 57) {
      const ordered = ORDERED.exec(line);
      if (ordered !== null) {
        const items = [];
        while (i < len) {
          const m = ORDERED.exec(lines[i]);
          if (m !== null) {
            items.push([trimLine(m[2])]);
            i++;
          } else if (CONTINUED.test(lines[i])) {
            items[items.length - 1].push(trimLine(lines[i]));
            i++;
          } else break;
        }
        tokens.push({ type: 'list', ordered: true, start: Number(ordered[1]), items: items.map((parts) => parts.join('\n')) });
        continue;
      }
    }
    const body = [trimLine(line)];
    i++;
    while (i < len && !endsParagraph(lines[i])) body.push(trimLine(lines[i++]));
    tokens.push({ type: 'paragraph', text: body.join('\n') });
  }
  return tokens;
}

const ESCAPABLE = new Set(['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']);
/** Escapable code units (the reference's set), for charCodeAt scanning. */
const ESCAPABLE_CODE = new Uint8Array(128);
for (const ch of ['\\', '`', '*', '_', '[', ']', '(', ')', '#', '+', '-', '.', '!', '>']) ESCAPABLE_CODE[ch.charCodeAt(0)] = 1;

/** The code units JavaScript's \s matches (whitespace and line terminators), as a lookup table for
 *  allocation-free word counting. */
const WS_TABLE = new Uint8Array(0x10000);
for (const c of [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0xfeff, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000]) WS_TABLE[c] = 1;

/** The words of a body: its runs of characters other than whitespace (the reference's /\S+/g count, without the
 *  match array). A run cannot cross a line end, so per-line counts sum to the whole. */
function wordsOfLines(lines) {
  let n = 0;
  for (let li = 0; li < lines.length; li++) {
    const text = lines[li];
    let inWord = false;
    for (let i = 0; i < text.length; i++) {
      if (WS_TABLE[text.charCodeAt(i)]) {
        inWord = false;
      } else if (!inWord) {
        inWord = true;
        n++;
      }
    }
  }
  return n;
}

/** The first index from `from` where `s` holds `what` outside a backslash escape, or -1. A backslash run of odd
 *  length immediately before a candidate (within the scan region) means the candidate's first character is that
 *  run's last backslash's escaped partner, exactly as the reference's sequential scan sees it. */
function findUnescaped(s, what, from) {
  let k = s.indexOf(what, from);
  while (k !== -1) {
    let m = 0;
    for (let j = k - 1; j >= from && s.charCodeAt(j) === 92; j--) m++;
    if ((m & 1) === 0) return k;
    k = s.indexOf(what, k + 1);
  }
  return -1;
}

/** The first single * from `from` (one whose run is not **), outside an escape, or -1. */
function findSingleStar(s, from) {
  let k = s.indexOf('*', from);
  while (k !== -1) {
    let m = 0;
    for (let j = k - 1; j >= from && s.charCodeAt(j) === 92; j--) m++;
    if ((m & 1) === 1) {
      k = s.indexOf('*', k + 1);
      continue;
    }
    if (s.charCodeAt(k + 1) === 42) {
      // a ** run: the reference's scan consumes the pair, so the next candidate is past the second star
      k = s.indexOf('*', k + 2);
      continue;
    }
    return k;
  }
  return -1;
}

/** The next character that needs handling in a plain run: a branch opener (\ ` * [) or an escapable HTML
 *  character (& < > " '), found with one native scan. */
const RE_SPECIAL = /[\\`*\[&<>"']/g;

/** `s` rendered inline; `env.link(target)` is a link's href. Each plain run is scanned once, natively, up to the
 *  next character that needs handling, and needs no escaping before it: the reference's per-character rule with
 *  none of its per-character work. */
function inline(s, env) {
  let out = '';
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === 92) {
      // backslash: an escapable next character is emitted escaped (of the escapable characters only > is one
      // of the five escaped), a lone backslash raw
      if (i + 1 < n) {
        const c2 = s.charCodeAt(i + 1);
        if (c2 < 128 && ESCAPABLE_CODE[c2]) {
          out += c2 === 62 ? '&gt;' : s[i + 1];
          i += 2;
          continue;
        }
      }
      out += '\\';
      i++;
      continue;
    }
    if (c === 96) {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) {
        out += `<code>${escapeHtml(s.slice(i + 1, j))}</code>`;
        i = j + 1;
      } else {
        out += '`';
        i++;
      }
      continue;
    }
    if (c === 42) {
      if (s.charCodeAt(i + 1) === 42) {
        const j = findUnescaped(s, '**', i + 2);
        if (j > i + 2) {
          out += `<strong>${inline(s.slice(i + 2, j), env)}</strong>`;
          i = j + 2;
        } else {
          out += '**';
          i += 2;
        }
        continue;
      }
      const j = findSingleStar(s, i + 1);
      if (j > i + 1) {
        out += `<em>${inline(s.slice(i + 1, j), env)}</em>`;
        i = j + 1;
      } else {
        out += '*';
        i++;
      }
      continue;
    }
    if (c === 91) {
      const k = findUnescaped(s, ']', i + 1);
      const m = k !== -1 && s.charCodeAt(k + 1) === 40 ? s.indexOf(')', k + 2) : -1;
      const target = m === -1 ? '' : s.slice(k + 2, m);
      if (target !== '' && !/\s/.test(target)) {
        out += `<a href="${escapeHtml(env.link(target))}">${inline(s.slice(i + 1, k), env)}</a>`;
        i = m + 1;
        continue;
      }
      out += '[';
      i++;
      continue;
    }
    // a plain run: nothing but the branch openers and the escaped characters can appear before its end
    RE_SPECIAL.lastIndex = i;
    let j;
    if (RE_SPECIAL.test(s)) {
      // a one-character match: its index is lastIndex - 1
      j = RE_SPECIAL.lastIndex - 1;
      const sc = s.charCodeAt(j);
      if (j > i) out += s.slice(i, j);
      if (sc === 38) { out += '&amp;'; i = j + 1; continue; }
      if (sc === 60) { out += '&lt;'; i = j + 1; continue; }
      if (sc === 62) { out += '&gt;'; i = j + 1; continue; }
      if (sc === 34) { out += '&quot;'; i = j + 1; continue; }
      if (sc === 39) { out += '&#39;'; i = j + 1; continue; }
      // a branch opener: the loop dispatches on it
      i = j;
      continue;
    }
    out += s.slice(i, n);
    break;
  }
  return out;
}

/**
 * `lines` rendered (the reference's renderMarkdown over the body's lines): its HTML (each block on its own lines,
 * a "\n" after the last), its table of contents (every level 2 and 3 heading: level, id and its inline HTML) and
 * its excerpt (the first paragraph's inline HTML, or "").
 */
function renderMarkdownLines(lines, env) {
  const ids = new Set();
  const blocks = [];
  const toc = [];
  let excerpt = null;
  for (const t of lex(lines)) {
    switch (t.type) {
      case 'heading': {
        const id = uniqueSlug(slugify(t.text), ids);
        const html = inline(t.text, env);
        blocks.push(`<h${t.depth} id="${id}">${html}</h${t.depth}>`);
        if (t.depth === 2 || t.depth === 3) toc.push({ level: t.depth, id, html });
        break;
      }
      case 'code': {
        const cls = t.lang === '' ? '' : ` class="language-${escapeHtml(t.lang)}"`;
        blocks.push(`<pre><code${cls}>${t.lines.map((l) => `${escapeHtml(l)}\n`).join('')}</code></pre>`);
        break;
      }
      case 'hr':
        blocks.push('<hr>');
        break;
      case 'blockquote':
        blocks.push(t.lines.length === 0 ? '<blockquote>\n</blockquote>' : `<blockquote>\n<p>${inline(t.lines.join('\n'), env)}</p>\n</blockquote>`);
        break;
      case 'list': {
        const tag = t.ordered ? 'ol' : 'ul';
        const open = t.ordered && t.start !== 1 ? `<ol start="${t.start}">` : `<${tag}>`;
        blocks.push(`${open}\n${t.items.map((item) => `<li>${inline(item, env)}</li>\n`).join('')}</${tag}>`);
        break;
      }
      case 'paragraph': {
        const html = inline(t.text, env);
        if (excerpt === null) excerpt = html;
        blocks.push(`<p>${html}</p>`);
        break;
      }
    }
  }
  return { html: blocks.length === 0 ? '' : `${blocks.join('\n')}\n`, toc, excerpt: excerpt ?? '' };
}

// ---------------------------------------------------------------- templates (the reference's dialect, parsed once, compiled to closures)

const INCLUDE_DEPTH = 8;

const PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const FOR = /^for ([A-Za-z_][A-Za-z0-9_]*) in (\S+)$/;
const IF = /^if (not )?(\S+)$/;
const INCLUDE = /^include "([a-z0-9-]+)"$/;

class TemplateError extends Error {}

function pathOf(name, text) {
  if (!PATH.test(text)) throw new TemplateError(`template "${name}": ${JSON.stringify(text)} is not a path`);
  return text.split('.');
}

/** `src`'s tokens: text, {{ }}, {{{ }}} and {% %}, a standalone tag's line taken with it. */
function tokenize(name, src) {
  const tokens = [];
  let text = '';
  let i = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open === -1 || open === src.length - 1) {
      text += src.slice(i);
      break;
    }
    const next = src[open + 1];
    if (next !== '{' && next !== '%') {
      text += src.slice(i, open + 1);
      i = open + 1;
      continue;
    }
    text += src.slice(i, open);
    if (next === '{') {
      const raw = src[open + 2] === '{';
      const close = src.indexOf(raw ? '}}}' : '}}', open + (raw ? 3 : 2));
      if (close === -1) throw new TemplateError(`template "${name}": a ${raw ? '{{{' : '{{'} is not closed`);
      if (text !== '') tokens.push({ t: 'text', text });
      text = '';
      tokens.push({ t: raw ? 'raw' : 'var', path: pathOf(name, src.slice(open + (raw ? 3 : 2), close).trim()) });
      i = close + (raw ? 3 : 2);
      continue;
    }
    const close = src.indexOf('%}', open + 2);
    if (close === -1) throw new TemplateError(`template "${name}": a {% is not closed`);
    const end = close + 2;
    const lineStart = src.lastIndexOf('\n', open - 1) + 1;
    const nl = src.indexOf('\n', end);
    const lineEnd = nl === -1 ? src.length : nl;
    const standalone = /^[ \t]*$/.test(src.slice(lineStart, open)) && /^[ \t]*$/.test(src.slice(end, lineEnd));
    if (standalone) text = text.slice(0, text.length - (open - lineStart));
    if (text !== '') tokens.push({ t: 'text', text });
    text = '';
    tokens.push({ t: 'tag', tag: src.slice(open + 2, close).trim() });
    i = standalone ? (nl === -1 ? src.length : nl + 1) : end;
  }
  if (text !== '') tokens.push({ t: 'text', text });
  return tokens;
}

/** `src` parsed into its tree of nodes (a TemplateError when it does not parse). */
function parseTemplate(name, src) {
  const root = { kind: 'root', body: [] };
  const stack = [root];
  let body = root.body;
  for (const tok of tokenize(name, src)) {
    if (tok.t === 'text') body.push({ kind: 'text', text: tok.text });
    else if (tok.t === 'var' || tok.t === 'raw') body.push({ kind: tok.t, path: tok.path });
    else {
      const tag = tok.tag;
      const top = stack[stack.length - 1];
      let m;
      if ((m = FOR.exec(tag)) !== null) {
        const node = { kind: 'for', name: m[1], path: pathOf(name, m[2]), body: [] };
        body.push(node);
        stack.push(node);
        body = node.body;
      } else if ((m = IF.exec(tag)) !== null) {
        const node = { kind: 'if', not: m[1] !== undefined, path: pathOf(name, m[2]), then: [], else: null };
        body.push(node);
        stack.push(node);
        body = node.then;
      } else if (tag === 'else') {
        if (top.kind !== 'if' || top.else !== null) throw new TemplateError(`template "${name}": an else outside an if`);
        top.else = [];
        body = top.else;
      } else if (tag === 'endfor' || tag === 'endif') {
        if (top.kind !== (tag === 'endfor' ? 'for' : 'if')) throw new TemplateError(`template "${name}": an ${tag} with no open ${tag.slice(3)}`);
        stack.pop();
        const parent = stack[stack.length - 1];
        body = parent.kind === 'root' ? parent.body : parent.kind === 'for' ? parent.body : parent.else ?? parent.then;
      } else if ((m = INCLUDE.exec(tag)) !== null) body.push({ kind: 'include', name: m[1] });
      else throw new TemplateError(`template "${name}": {% ${tag} %} is not a tag`);
    }
  }
  if (stack.length > 1) throw new TemplateError(`template "${name}": a ${stack[stack.length - 1].kind} is not closed`);
  return root.body;
}

/** The value at `path` in the scope chain: its first name from the nearest scope holding it, then own properties. */
function lookup(scope, path) {
  let s = scope;
  while (s !== null && !Object.hasOwn(s.vars, path[0])) s = s.parent;
  if (s === null) return undefined;
  let v = s.vars[path[0]];
  for (let k = 1; k < path.length; k++) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, path[k])) return undefined;
    v = v[path[k]];
  }
  return v;
}

/** A value as text: a string itself, a number in JavaScript's digits, true or false, an array's items joined by ", ", else "". */
function textOf(v) {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return v.map(textOf).join(', ');
  return '';
}

/** Whether a value counts as true in an if: not undefined, null, false, "", 0 or an empty array. */
function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  return v !== undefined && v !== null && v !== false && v !== '' && v !== 0;
}

const EMPTY_RENDER = () => '';

/** One node compiled to a closure (scope, ctx, depth) -> text. */
function compileNode(n) {
  switch (n.kind) {
    case 'text':
      return () => n.text;
    case 'var':
      return (scope, ctx) => ctx.escape(textOf(lookup(scope, n.path)));
    case 'raw':
      return (scope) => textOf(lookup(scope, n.path));
    case 'if': {
      const thenFn = compileSeq(n.then);
      const elseFn = n.else === null ? null : compileSeq(n.else);
      const not = n.not;
      const path = n.path;
      return (scope, ctx, depth) => {
        const v = truthy(lookup(scope, path));
        const branch = v !== not ? thenFn : elseFn;
        return branch === null ? '' : branch(scope, ctx, depth);
      };
    }
    case 'for': {
      const bodyFn = compileSeq(n.body);
      const path = n.path;
      const name = n.name;
      return (scope, ctx, depth) => {
        const xs = lookup(scope, path);
        if (!Array.isArray(xs)) return '';
        const m = xs.length;
        let out = '';
        for (let k = 0; k < m; k++) {
          const vars = { [name]: xs[k], loop: { index: k + 1, first: k === 0, last: k === m - 1, length: m } };
          out += bodyFn({ vars, parent: scope }, ctx, depth);
        }
        return out;
      };
    }
    case 'include': {
      const name = n.name;
      return (scope, ctx, depth) => {
        const t = ctx.templates.get(name);
        return t !== undefined && depth < INCLUDE_DEPTH ? t(scope, ctx, depth + 1) : '';
      };
    }
  }
  return EMPTY_RENDER;
}

/** A node sequence compiled to one closure. */
function compileSeq(nodes) {
  const len = nodes.length;
  if (len === 0) return EMPTY_RENDER;
  if (len === 1) return compileNode(nodes[0]);
  const parts = [];
  for (let i = 0; i < len; i++) parts.push(compileNode(nodes[i]));
  return (scope, ctx, depth) => {
    let out = '';
    for (let k = 0; k < len; k++) out += parts[k](scope, ctx, depth);
    return out;
  };
}

// ---------------------------------------------------------------- templates, compiled to straight-line functions

/** Names a generated function's own locals use; a template that binds one of them as a loop variable is compiled
 *  by the closure compiler above instead. */
const GEN_RESERVED = new Set(['V', 'out', 'scope', 'ctx', 'depth', 'T', 'TR', 'D', 'xs', 'arguments', 'eval']);

/** Every loop variable a node tree binds. */
function collectLoopNames(nodes, set) {
  for (const n of nodes) {
    if (n.kind === 'for') {
      set.add(n.name);
      collectLoopNames(n.body, set);
    } else if (n.kind === 'if') {
      collectLoopNames(n.then, set);
      if (n.else !== null) collectLoopNames(n.else, set);
    }
  }
}

/** Whether a node tree holds an include anywhere beneath its fors and ifs: a loop whose body does must materialise
 *  its scope object, for the included template's own scope-chain lookups. */
function bodyHasInclude(nodes) {
  for (const n of nodes) {
    if (n.kind === 'include') return true;
    if (n.kind === 'for' && bodyHasInclude(n.body)) return true;
    if (n.kind === 'if') {
      if (bodyHasInclude(n.then)) return true;
      if (n.else !== null && bodyHasInclude(n.else)) return true;
    }
  }
  return false;
}

/** A path's value as a generated expression: its first name a bound loop variable or a scope-chain lookup, then
 *  own-property descents, exactly the reference's lookup. */
function genPath(path, st) {
  const first = path[0];
  let e;
  if (st.names.includes(first)) e = first;
  else e = `L(${JSON.stringify(first)})`;
  for (let k = 1; k < path.length; k++) e = `D(${e},${JSON.stringify(path[k])})`;
  return e;
}

function genNodes(nodes, out, st) {
  for (const n of nodes) {
    switch (n.kind) {
      case 'text':
        out.push(`out += ${JSON.stringify(n.text)};`);
        break;
      case 'var':
        out.push(`out += ctx.escape(T(${genPath(n.path, st)}));`);
        break;
      case 'raw':
        out.push(`out += T(${genPath(n.path, st)});`);
        break;
      case 'if':
        out.push(`if (TR(${genPath(n.path, st)}) !== ${n.not ? 'true' : 'false'}) {`);
        genNodes(n.then, out, st);
        if (n.else !== null) {
          out.push('} else {');
          genNodes(n.else, out, st);
        }
        out.push('}');
        break;
      case 'for': {
        const name = n.name;
        out.push(`{ const xs = ${genPath(n.path, st)}; if (Array.isArray(xs)) { const $m = xs.length; for (let $k = 0; $k < $m; $k++) {`);
        if (name !== 'loop') out.push(`const ${name} = xs[$k];`);
        out.push('const loop = { index: $k + 1, first: $k === 0, last: $k === $m - 1, length: $m };');
        let scopeExpr = st.scopeExpr;
        if (bodyHasInclude(n.body)) {
          const sn = `$s${st.level + 1}`;
          out.push(`const ${sn} = { vars: { ${name === 'loop' ? '' : `${JSON.stringify(name)}: ${name}, `}loop: loop }, parent: ${st.scopeExpr} };`);
          scopeExpr = sn;
        }
        genNodes(n.body, out, { level: st.level + 1, scopeExpr, names: st.names.concat([name, 'loop']) });
        out.push('} } }');
        break;
      }
      case 'include':
        out.push(`{ const t = ctx.templates.get(${JSON.stringify(n.name)}); if (t !== undefined && depth < ${INCLUDE_DEPTH}) out += t(${st.scopeExpr}, ctx, depth + 1); }`);
        break;
    }
  }
}

/** The helpers every generated function defines once (the scope-chain lookup, textOf, truthy and the
 *  own-property descent). */
const GEN_HELPERS = `
function L(n) { var s = scope; while (s !== null) { if (Object.hasOwn(s.vars, n)) return s.vars[n]; s = s.parent; } return undefined; }
function T(v) { if (typeof v === 'string') return v; if (typeof v === 'number') return String(v); if (typeof v === 'boolean') return v ? 'true' : 'false'; if (Array.isArray(v)) return v.map(T).join(', '); return ''; }
function TR(v) { if (Array.isArray(v)) return v.length > 0; return v !== undefined && v !== null && v !== false && v !== '' && v !== 0; }
function D(v, k) { return v === null || typeof v !== 'object' || !Object.hasOwn(v, k) ? undefined : v[k]; }
`;

/** `nodes` compiled to one generated function (scope, ctx, depth) -> text, or to closures when a loop variable
 *  would shadow the generated code's own locals. */
function compileTemplate(nodes) {
  const names = new Set();
  collectLoopNames(nodes, names);
  for (const n of names) if (GEN_RESERVED.has(n)) return compileSeq(nodes);
  const out = ['var out = \'\';', GEN_HELPERS];
  genNodes(nodes, out, { level: 0, scopeExpr: 'scope', names: [] });
  out.push('return out;');
  return new Function('scope', 'ctx', 'depth', out.join('\n'));
}

// ---------------------------------------------------------------- the build (the reference's pipeline, same order, same answers)

const REPORT_FILE = 'build-report.txt';
const RESERVED = ['posts', 'tags', 'page'];

const byCodeUnits = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function resolvePath(dir, rel) {
  const parts = dir === '' ? [] : dir.split('/');
  for (const seg of rel.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join('/');
}

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

const linkOf = (s) => (s === null ? null : { title: s.data.title, url: s.url, date: s.data.date ?? '', date_long: s.data.date === undefined ? '' : longDate(s.data.date) });

/** One site's output tree: path -> text, exactly as makefun-site 1.0.0 builds it. */
export function build(input) {
  const templates = new Map();
  const report = [];
  for (const name of Object.keys(input.templates).sort(byCodeUnits)) {
    try {
      templates.set(name, compileTemplate(parseTemplate(name, input.templates[name])));
    } catch (err) {
      if (!(err instanceof TemplateError)) throw err;
      report.push(err.message);
    }
  }
  const base = input.site.base_url.replace(/\/+$/, '');

  // 1. The sources, in code-unit order of their paths, line ends made "\n"; a source that is not .md is static.
  const files = [...input.files].sort((x, y) => byCodeUnits(x.path, y.path));
  const sources = [];
  const statics = [];
  for (const f of files) {
    if (f.path.endsWith('.md')) {
      // line ends made "\n": the generated bodies hold none to convert, so skip the scan and the copy when no \r is there
      const text = f.content.indexOf('\r') === -1 ? f.content : f.content.replace(/\r\n?/g, '\n');
      sources.push({ path: f.path, text });
    }
    else statics.push({ path: f.path, content: f.content });
  }

  // 2. Each source's front matter: a refused source is reported and dropped, and so is a draft.
  const kept = [];
  for (const s of sources) {
    const fm = parseFrontMatter(s.text);
    if ('error' in fm) {
      report.push(`refused ${s.path}: ${fm.error}`);
      continue;
    }
    s.data = fm.data;
    s.bodyLines = fm.bodyLines;
    s.text = undefined;
    s.post = s.path.startsWith('posts/');
    const own = RESERVED.find((d) => d !== 'posts' && s.path.startsWith(`${d}/`));
    if (own !== undefined) {
      report.push(`refused ${s.path}: ${own}/ is the generator's own`);
      continue;
    }
    if (s.post && !Object.hasOwn(s.data, 'date')) {
      report.push(`refused ${s.path}: a post needs a date`);
      continue;
    }
    const layout = s.data.layout ?? (s.post ? 'post' : 'page');
    if (!templates.has(layout)) {
      report.push(`refused ${s.path}: layout "${layout}" is no template that parses`);
      continue;
    }
    s.layout = layout;
    if (s.data.draft === true) {
      report.push(`draft ${s.path}`);
      continue;
    }
    kept.push(s);
  }

  // 3. Each page's output directory and url: its slug made unique in its directory, in source order.
  const taken = new Map();
  const bySource = new Map();
  for (const s of kept) {
    const dir = s.post ? 'posts' : dirOf(s.path);
    if (!taken.has(dir)) taken.set(dir, new Set(dir === '' ? RESERVED : []));
    const slug = uniqueSlug(s.data.slug ?? slugify(s.data.title), taken.get(dir));
    s.slug = slug;
    s.outDir = dir === '' ? slug : `${dir}/${slug}`;
    s.url = `${base}/${s.outDir}/`;
    bySource.set(s.path, s);
  }

  // 4. Each body's Markdown, its links resolved to the pages and static files they name.
  const staticPaths = new Set(statics.map((f) => f.path));
  const broken = new Set();
  const linkState = { dir: '', path: '' };
  const env = {
    link: (target) => {
      if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target.startsWith('/') || target.startsWith('#')) return target;
      const hash = target.indexOf('#');
      const rel = hash === -1 ? target : target.slice(0, hash);
      const frag = hash === -1 ? '' : target.slice(hash);
      const path = rel === '' ? null : resolvePath(linkState.dir, rel);
      if (path !== null && bySource.has(path)) return `${bySource.get(path).url}${frag}`;
      if (path !== null && staticPaths.has(path)) return `${base}/${path}${frag}`;
      broken.add(`broken-link ${linkState.path} -> ${target}`);
      return target;
    },
  };
  for (const s of kept) {
    linkState.dir = dirOf(s.path);
    linkState.path = s.path;
    const md = renderMarkdownLines(s.bodyLines, env);
    s.html = md.html;
    s.toc = md.toc;
    s.excerpt = md.excerpt;
  }

  // 5. The posts, newest first and then by slug; each post's newer and older neighbours.
  const posts = kept.filter((s) => s.post);
  posts.sort((x, y) => byCodeUnits(y.data.date, x.data.date) || byCodeUnits(x.slug, y.slug));
  for (let k = 0; k < posts.length; k++) {
    posts[k].newer = k === 0 ? null : posts[k - 1];
    posts[k].older = k === posts.length - 1 ? null : posts[k + 1];
  }

  // 6. The tags: grouped by their slug, each named as first met in the posts' order, ordered by count and then slug.
  const bySlug = new Map();
  const ownTags = (s) => {
    const seen = new Set();
    return (s.data.tags ?? []).filter((name) => !seen.has(slugify(name)) && seen.add(slugify(name)));
  };
  for (const p of posts) {
    p.tagRefs = [];
    for (const name of ownTags(p)) {
      const slug = slugify(name);
      if (!bySlug.has(slug)) bySlug.set(slug, { name, slug, url: `${base}/tags/${slug}/`, posts: [] });
      const tag = bySlug.get(slug);
      tag.posts.push(p);
      p.tagRefs.push(tag);
    }
  }
  for (const s of kept) {
    if (!s.post) s.tagRefs = ownTags(s).map((name) => bySlug.get(slugify(name)) ?? { name, slug: slugify(name), url: '', posts: [] });
  }
  const tags = [...bySlug.values()].sort((x, y) => y.posts.length - x.posts.length || byCodeUnits(x.slug, y.slug));

  // 7. Every page through its layout, the index pages and the tag pages through theirs.
  const cardOf = (s) => {
    const card = s.card;
    if (card !== undefined) return card;
    return (s.card = {
      title: s.data.title,
      url: s.url,
      date: s.data.date ?? '',
      date_long: s.data.date === undefined ? '' : longDate(s.data.date),
      summary: s.data.summary ?? '',
      excerpt: s.excerpt,
      reading_minutes: Math.max(1, Math.ceil(wordsOfLines(s.bodyLines) / 200)),
      tags: s.tagRefs.map((t) => ({ name: t.name, slug: t.slug, url: t.url })),
    });
  };
  const cards = new Map(posts.map((p) => [p, cardOf(p)]));
  const site = { title: input.site.title, base_url: base };
  const allTags = tags.map((t) => ({ name: t.name, slug: t.slug, url: t.url, count: t.posts.length }));
  const recent = posts.slice(0, input.site.recent).map((p) => cards.get(p));
  const ctx = { templates, escape: escapeHtml };
  const render = (name, vars) => {
    const fn = templates.get(name);
    return fn === undefined ? null : fn({ vars: { site, tags: allTags, recent, ...vars }, parent: null }, ctx, 0);
  };

  const output = {};
  for (const s of kept) {
    const page = {
      ...cardOf(s),
      slug: s.slug,
      content: s.html,
      toc: s.toc.map((h) => ({ level: h.level, id: h.id, html: h.html })),
      newer: linkOf(s.newer ?? null),
      older: linkOf(s.older ?? null),
      is_post: s.post,
    };
    output[`${s.outDir}/index.html`] = render(s.layout, { page });
  }
  const per = input.site.per_page;
  const pages = Math.max(1, Math.ceil(posts.length / per));
  const indexUrl = (k) => (k === 1 ? `${base}/` : `${base}/page/${k}/`);
  for (let k = 1; k <= pages; k++) {
    const html = render('index', {
      posts: posts.slice((k - 1) * per, k * per).map((p) => cards.get(p)),
      pager: { number: k, total: pages, url: indexUrl(k), newer_url: k === 1 ? '' : indexUrl(k - 1), older_url: k === pages ? '' : indexUrl(k + 1) },
    });
    if (html !== null) output[k === 1 ? 'index.html' : `page/${k}/index.html`] = html;
  }
  for (const t of tags) {
    const html = render('tag', { tag: { name: t.name, slug: t.slug, url: t.url, count: t.posts.length, posts: t.posts.map((p) => cards.get(p)) } });
    if (html !== null) output[`tags/${t.slug}/index.html`] = html;
  }
  const tagsHtml = render('tags', {});
  if (tagsHtml !== null) output['tags/index.html'] = tagsHtml;
  for (const f of statics) {
    if (Object.hasOwn(output, f.path)) report.push(`shadowed ${f.path}: a built page has its path`);
    else output[f.path] = f.content;
  }

  // 8. The report: every refusal, draft, broken link and template that did not parse, sorted, then the counts.
  const lines = [...report, ...broken].sort(byCodeUnits);
  const pagesCount = kept.filter((s) => !s.post).length;
  lines.push(`built ${pagesCount} pages, ${posts.length} posts, ${tags.length} tags and ${statics.length} static files`);
  output[REPORT_FILE] = `${lines.join('\n')}\n`;
  return output;
}

/** makefun-site 1.0.0's answer for one case's input. */
export function run(input) {
  return build(input);
}
