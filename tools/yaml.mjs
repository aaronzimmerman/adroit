// adroit — the YAML subset the ledger is written in, and the parser that reads it back.
// Zero dependencies, ESM, Node built-ins only.
//
// Deliberately a SUBSET: exactly the shapes `emit` produces, and nothing else. A ledger file is
// law, so an unfamiliar construct must be a loud error with a line number rather than a value
// somebody's parser guessed at — no anchors, no tags, no flow mappings, no multi-document
// streams, no single quotes, no implicit typing beyond true/false/null and plain numbers.
//
// The rule that makes the pretty styles safe: `emit` PARSES ITS OWN block scalars back before it
// commits to one, and falls through to a double-quoted string the moment the round trip is not
// exact. Folding is a preference; exactness is not — a decision that loses a double space on the
// way to disk has been edited by the tooling, which is the one thing a ledger may never do.
//
// Supported values: plain objects (insertion order preserved), arrays, strings, finite numbers,
// booleans, null. Anything else throws on emit.

/** Where a line wants to end. Not a hard limit — a single long word still overruns it. */
export const WIDTH = 100;
const INDENT = 2;

/** A PLAIN object — not a Date, a Map or a class instance. Those have a shape YAML cannot carry
 *  back, so emitting one would be a silent loss dressed up as a `{}`. */
const isPlainObject = (v) => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

// A plain scalar's shape is what makes it unambiguous; every one of these tests corresponds to a
// way the parser below would read the text back as something else.
const NUMBERISH = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const KEYWORDISH = /^(y|Y|yes|Yes|YES|n|N|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF|null|Null|NULL|~)$/;
const INDICATOR = new Set([...'-?:,[]{}#&*!|>\'"%@`']);

/** May this string be written bare? The parser's plain-scalar rules, stated once from the other
 *  side — anything that fails here is quoted, folded or written as a literal block instead. */
export const plainSafe = (s) =>
  typeof s === 'string' && s !== ''
  && !/[\n\r\t]/.test(s) && !/^\s|\s$/.test(s)
  && !INDICATOR.has(s[0]) && !s.includes(': ') && !s.endsWith(':') && !s.includes(' #')
  && !NUMBERISH.test(s) && !KEYWORDISH.test(s);

const emitKey = (k) => (plainSafe(k) && !k.includes(':') && !k.includes('#') ? k : JSON.stringify(k));

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

/** value → YAML text (always newline-terminated). */
export function emit(value) {
  const out = [];
  if (isPlainObject(value) && Object.keys(value).length) {
    for (const k of Object.keys(value)) writeValue(out, 0, `${emitKey(k)}:`, value[k]);
  } else if (Array.isArray(value) && value.length) {
    for (const item of value) writeValue(out, 0, '-', item);
  } else {
    writeValue(out, 0, '', value);
  }
  return out.join('\n') + '\n';
}

function writeValue(out, ind, prefix, value) {
  const head = ' '.repeat(ind) + prefix + (prefix ? ' ' : '');
  const line = (text) => out.push(head + text);
  if (value === null) return line('null');
  if (typeof value === 'boolean') return line(String(value));
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`cannot emit the non-finite number ${value}`);
    return line(String(value));
  }
  if (typeof value === 'string') return writeString(out, ind, head, value);
  if (Array.isArray(value)) {
    if (!value.length) return line('[]');
    const flow = flowSeq(value, head.length);
    if (flow !== null) return line(flow);
    if (prefix) out.push(' '.repeat(ind) + prefix);
    const at = ind + (prefix ? INDENT : 0);
    for (const item of value) {
      if (isPlainObject(item) && Object.keys(item).length) writeSeqMap(out, at, item);
      else writeValue(out, at, '-', item);
    }
    return;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (!keys.length) return line('{}');
    if (prefix) out.push(' '.repeat(ind) + prefix);
    for (const k of keys) writeValue(out, ind + (prefix ? INDENT : 0), `${emitKey(k)}:`, value[k]);
    return;
  }
  throw new Error(`cannot emit ${value === undefined ? 'undefined' : Object.prototype.toString.call(value)}`);
}

/** A mapping as a sequence item, in the COMPACT form: `- key: value` with the remaining keys
 *  aligned under the first. Written as an ordinary mapping indented to the key column, then the
 *  dash swapped into the first line's indentation — so every nested value (a block scalar, a
 *  list) is indented against the key it belongs to, exactly as the parser will measure it. */
function writeSeqMap(out, ind, obj) {
  const start = out.length;
  for (const k of Object.keys(obj)) writeValue(out, ind + INDENT, `${emitKey(k)}:`, obj[k]);
  out[start] = `${' '.repeat(ind)}- ${out[start].slice(ind + INDENT)}`;
}

/** The four string strategies, in order of preference — and the round-trip gate in front of the
 *  two block styles, which is the only reason folding is allowed anywhere near this data. */
function writeString(out, ind, head, s) {
  // Measured against the form actually about to be written: a string that only just fits bare
  // does not fit once quoting adds its two characters, and that is when a block earns its keep.
  const overflows = head.length + (plainSafe(s) ? s.length : JSON.stringify(s).length) > WIDTH;
  if (plainSafe(s) && !overflows) return out.push(head + s);
  const block = s.includes('\n') ? literalBlock(s) : foldedBlock(s, ind, overflows ? 1 : 2);
  if (block && roundTrips(block, s)) {
    out.push(head + block.header);
    for (const l of block.lines) out.push(l === '' ? '' : ' '.repeat(ind + INDENT) + l);
    return;
  }
  out.push(head + JSON.stringify(s));
}

/** A string with newlines wants `|`. Chomping carries the trailing newlines exactly: none → `|-`,
 *  one → `|`, more → `|+` with the surplus written as blank lines. */
function literalBlock(s) {
  const trail = /\n*$/.exec(s)[0].length;
  const lines = (trail ? s.slice(0, -trail) : s).split('\n');
  const first = lines.find((l) => l !== '');
  // The first non-empty line fixes the block's indentation, so leading space there would be eaten;
  // trailing space on any line survives but is invisible and editors strip it. Both go quoted.
  if (first === undefined || /^\s/.test(first) || lines.some((l) => /\s$/.test(l))) return null;
  const header = trail === 0 ? '|-' : trail === 1 ? '|' : '|+';
  return { header, lines: [...lines, ...Array(Math.max(0, trail - 1)).fill('')] };
}

/** A long single-line string wants `>-`, wrapped on single spaces. A run of two spaces cannot
 *  survive folding (the fold rejoins lines with exactly one), so such a string never folds.
 *  `minLines` is what keeps a SHORT awkward string (`403`, `a: b`) out of a block: only a line
 *  that actually overruns the width is worth two lines of ceremony. */
function foldedBlock(s, ind, minLines = 2) {
  if (s === '' || /[\n\r\t]/.test(s) || /^\s|\s$/.test(s) || /  /.test(s)) return null;
  const width = Math.max(24, WIDTH - (ind + INDENT));
  const lines = [];
  let cur = '';
  for (const word of s.split(' ')) {
    if (!cur) cur = word;
    else if (cur.length + 1 + word.length <= width) cur += ` ${word}`;
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  return lines.length >= minLines ? { header: '>-', lines } : null;
}

/** Parse the block back through the REAL parser. Two implementations of folding would drift; one
 *  implementation checked against itself cannot.
 *
 *  Exported because a gate nobody can call is a gate nobody can prove is attached: the two block
 *  builders above already refuse every shape that would corrupt today, so this backstop is never
 *  reached from real input and a test driving `emit` alone would stay green with it deleted. Its
 *  job is the NEXT change to those builders, and the only way to test that job is to hand it a
 *  block they would not have produced. */
export function roundTrips(block, s) {
  try {
    const doc = `v: ${block.header}\n${block.lines.map((l) => (l === '' ? '' : `  ${l}`)).join('\n')}\n`;
    return parse(doc).v === s;
  } catch {
    return false;
  }
}

/** `[a, b, c]` when every item is a short scalar and the whole thing fits; otherwise null and the
 *  caller writes a block sequence. */
function flowSeq(items, headLen) {
  const parts = [];
  for (const v of items) {
    if (v === null) parts.push('null');
    else if (typeof v === 'boolean') parts.push(String(v));
    else if (typeof v === 'number') {
      if (!Number.isFinite(v)) return null;
      parts.push(String(v));
    } else if (typeof v === 'string') {
      // Inside flow, `,` `:` the brackets and a quote are structure whatever they mean outside it.
      parts.push(plainSafe(v) && !/["\\,[\]{}:#]/.test(v) ? v : JSON.stringify(v));
    } else return null;
  }
  const s = `[${parts.join(', ')}]`;
  return headLen + s.length <= WIDTH ? s : null;
}

// ---------------------------------------------------------------------------
// Parse — strict. Everything the emitter writes, and nothing it does not.
// ---------------------------------------------------------------------------

/** YAML text → value. Throws with a line number on anything outside the subset. */
export function parse(text) {
  if (typeof text !== 'string') throw new TypeError('parse expects a string');
  const lines = text.split('\n');
  // One trailing newline terminates the document; it is not a blank line of content.
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  let i = 0;

  const fail = (n, msg) => { throw new Error(`line ${n + 1}: ${msg}`); };
  const indentOf = (n) => {
    const lead = /^[ \t]*/.exec(lines[n])[0];
    if (lead.includes('\t')) fail(n, 'tab in indentation — indentation is spaces');
    return lead.length;
  };
  const blank = (n) => lines[n].trim() === '';
  const skip = () => { while (i < lines.length && (blank(i) || /^\s*#/.test(lines[i]))) i++; };

  const scanQuoted = (s, n) => {
    if (s[0] !== '"') fail(n, 'expected a double-quoted scalar');
    for (let p = 1; p < s.length; p++) {
      if (s[p] === '\\') { p++; continue; }
      if (s[p] === '"') return p + 1;
    }
    return fail(n, 'unterminated double-quoted scalar');
  };

  /** `key: rest` split, or null when the line is not a mapping entry. The separating colon is the
   *  first one followed by a space or the end of line — which is what lets a value like
   *  `principle:weigh-disruption` stay unquoted. */
  const findKey = (content, n) => {
    if (content.startsWith('"')) {
      const end = scanQuoted(content, n);
      if (content[end] !== ':') return null;
      const rest = content.slice(end + 1);
      if (rest !== '' && !rest.startsWith(' ')) return null;
      return { key: JSON.parse(content.slice(0, end)), rest: rest.trim() };
    }
    for (let p = 0; p < content.length; p++) {
      if (content[p] !== ':') continue;
      if (p + 1 === content.length) return { key: content.slice(0, p), rest: '' };
      if (content[p + 1] === ' ') return { key: content.slice(0, p), rest: content.slice(p + 2).trim() };
    }
    return null;
  };

  const plainScalar = (s, n) => {
    if (s === '---' || s === '...') fail(n, 'document markers are not supported — one document per file');
    // The typed forms come first: `-0.5` opens with an indicator character and is still a number,
    // and `~` is null. A string that would read as either is quoted on the way out.
    if (s === 'null' || s === '~') return null;
    if (s === 'true') return true;
    if (s === 'false') return false;
    if (NUMBERISH.test(s)) return Number(s);
    if (INDICATOR.has(s[0])) fail(n, `a plain scalar may not start with '${s[0]}' — quote it`);
    if (s.includes(': ')) fail(n, "ambiguous ': ' inside a plain scalar — quote it");
    if (s.endsWith(':')) fail(n, "a plain scalar may not end with ':' — quote it");
    if (s.includes(' #')) fail(n, 'an inline comment inside a plain scalar — quote it');
    return s;
  };

  const flowItems = (rest, n) => {
    if (!rest.endsWith(']')) fail(n, 'unterminated flow sequence');
    const body = rest.slice(1, -1);
    const raw = [];
    let buf = '';
    for (let p = 0; p < body.length;) {
      if (body[p] === '"') { const end = p + scanQuoted(body.slice(p), n); buf += body.slice(p, end); p = end; continue; }
      if (body[p] === ',') { raw.push(buf); buf = ''; p++; continue; }
      buf += body[p++];
    }
    raw.push(buf);
    return raw.map((item) => {
      const t = item.trim();
      if (t === '') fail(n, 'empty item in a flow sequence');
      if (t[0] === '"') {
        const end = scanQuoted(t, n);
        if (t.slice(end).trim() !== '') fail(n, 'trailing content after a quoted flow item');
        return JSON.parse(t.slice(0, end));
      }
      if (/[[\]{}]/.test(t)) fail(n, 'nested flow collections are not supported');
      if (t.includes(':')) fail(n, 'flow mappings are not supported');
      return plainScalar(t, n);
    });
  };

  const blockScalar = (header, parentIndent, n) => {
    const style = header[0], chomp = header.slice(1);
    const raw = [];
    while (i < lines.length) {
      if (blank(i)) { raw.push(''); i++; continue; }
      if (indentOf(i) <= parentIndent) break;
      raw.push(lines[i]); i++;
    }
    const firstIdx = raw.findIndex((l) => l !== '');
    if (firstIdx === -1) return chomp === '+' ? '\n'.repeat(raw.length) : '';
    const ci = /^ */.exec(raw[firstIdx])[0].length;
    if (ci <= parentIndent) fail(n, 'block scalar content is not indented past its key');
    const body = raw.map((l) => {
      if (l === '') return '';
      if (!l.startsWith(' '.repeat(ci))) fail(n, 'inconsistent block scalar indentation');
      return l.slice(ci);
    });
    return decodeBlock(style, chomp, body);
  };

  const parseValue = (rest, parentIndent, n) => {
    if (rest === '') {
      skip();
      if (i >= lines.length || indentOf(i) <= parentIndent) fail(n, 'a key with no value');
      return parseNode(indentOf(i));
    }
    if (/^[|>][-+]?$/.test(rest)) return blockScalar(rest, parentIndent, n);
    if (/^[|>]/.test(rest)) fail(n, `unsupported block scalar header '${rest}'`);
    if (rest === '[]') return [];
    if (rest === '{}') return {};
    if (rest[0] === '[') return flowItems(rest, n);
    if (rest[0] === '{') fail(n, 'flow mappings are not supported');
    if (rest[0] === "'") fail(n, 'single-quoted scalars are not supported — use double quotes');
    if (rest[0] === '&' || rest[0] === '*') fail(n, 'anchors and aliases are not supported');
    if (rest[0] === '!') fail(n, 'tags are not supported');
    if (rest[0] === '"') {
      const end = scanQuoted(rest, n);
      if (rest.slice(end).trim() !== '') fail(n, 'trailing content after a quoted scalar');
      return JSON.parse(rest.slice(0, end));
    }
    return plainScalar(rest, n);
  };

  const parseMap = (indent) => {
    const obj = {};
    for (;;) {
      skip();
      if (i >= lines.length) break;
      const ind = indentOf(i);
      if (ind < indent) break;
      if (ind > indent) fail(i, `unexpected indentation (expected ${indent} space(s))`);
      const content = lines[i].slice(indent);
      if (content === '-' || content.startsWith('- ')) fail(i, 'a sequence item inside a mapping');
      const n = i;
      const split = findKey(content, n);
      if (!split) fail(n, 'expected a "key: value" entry');
      if (Object.prototype.hasOwnProperty.call(obj, split.key)) fail(n, `duplicate key '${split.key}'`);
      i++;
      obj[split.key] = parseValue(split.rest, indent, n);
    }
    return obj;
  };

  const parseSeq = (indent) => {
    const arr = [];
    for (;;) {
      skip();
      if (i >= lines.length) break;
      const ind = indentOf(i);
      if (ind < indent) break;
      if (ind > indent) fail(i, `unexpected indentation (expected ${indent} space(s))`);
      const content = lines[i].slice(indent);
      if (content !== '-' && !content.startsWith('- ')) fail(i, 'expected a "- " sequence item');
      const n = i;
      // `- key: value` opens a mapping whose keys sit at the column of that first key. The line is
      // re-read as if the dash were indentation, which is exactly what it stands for.
      const after = content === '-' ? '' : content.slice(1);
      const lead = /^ */.exec(after)[0].length;
      const body = after.slice(lead);
      if (body && !/^[|>[{-]/.test(body) && findKey(body, n)) {
        const col = indent + 1 + lead;
        lines[i] = ' '.repeat(col) + body;
        arr.push(parseMap(col));
        continue;
      }
      i++;
      arr.push(parseValue(body, indent, n));
    }
    return arr;
  };

  const parseNode = (indent) => {
    const content = lines[i].slice(indent);
    if (content === '-' || content.startsWith('- ')) return parseSeq(indent);
    if (findKey(content, i)) return parseMap(indent);
    const n = i;
    i++;
    return parseValue(content, indent, n);
  };

  skip();
  if (i >= lines.length) return null;
  const value = parseNode(indentOf(i));
  skip();
  if (i < lines.length) fail(i, 'unexpected content after the end of the document');
  return value;
}

/** Block-scalar chomping and folding, shared by the parser and (through it) the emitter's
 *  round-trip gate. `lines` are already dedented to the block's own indentation. */
function decodeBlock(style, chomp, lines) {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === '') end--;
  const body = lines.slice(0, end);
  const trailing = lines.length - end;
  if (!body.length) return chomp === '+' ? '\n'.repeat(trailing) : '';
  const s = style === '|' ? body.join('\n') : foldLines(body);
  if (chomp === '-') return s;
  if (chomp === '+') return s + '\n'.repeat(1 + trailing);
  return `${s}\n`;
}

/** YAML folding: a break between two ordinary lines becomes a space, a run of k blank lines
 *  becomes k newlines, and a more-indented line keeps its breaks. */
function foldLines(lines) {
  let out = lines[0];
  for (let k = 1; k < lines.length;) {
    if (lines[k] === '') {
      let blanks = 0;
      while (k < lines.length && lines[k] === '') { blanks++; k++; }
      if (k >= lines.length) break;
      out += '\n'.repeat(blanks) + lines[k];
      k++;
      continue;
    }
    out += (/^\s/.test(lines[k]) || /^\s/.test(lines[k - 1]) ? '\n' : ' ') + lines[k];
    k++;
  }
  return out;
}
