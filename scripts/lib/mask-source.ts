/**
 * Blank the comments, strings and (TS) regex literals of a source text with
 * spaces, so a scan for code patterns cannot match prose or data. Length and
 * line breaks are kept: an offset in the result is an offset in the source.
 */

/** A region to blank, and where scanning resumes. */
type Skip = { from: number; to: number; next: number; last?: string };
type Skipper = (source: string, at: number) => Skip | null;

function skipLine(source: string, at: number): Skip | null {
  if (!source.startsWith("//", at)) return null;
  const end = source.indexOf("\n", at);
  const to = end === -1 ? source.length : end;
  return { from: at, to, next: to };
}

/** The index just past the block comment that opens at `at`. */
function blockEnd(source: string, at: number, nested: boolean): number {
  let depth = 1;
  let j = at + 2;
  while (j < source.length && depth > 0) {
    const delta =
      (nested && source.startsWith("/*", j) ? 1 : 0) - (source.startsWith("*/", j) ? 1 : 0);
    depth += delta;
    j += delta === 0 ? 1 : 2;
  }
  return j;
}

/** Rust block comments nest; TS ones end at the first close marker. */
function skipBlock(nested: boolean): Skipper {
  return (source, at) => {
    if (!source.startsWith("/*", at)) return null;
    const to = blockEnd(source, at, nested);
    return { from: at, to, next: to };
  };
}

/** A string in one of `quotes`; only a Rust string may span lines. */
function skipQuoted(quotes: string, multiline: boolean): Skipper {
  return (source, at) => {
    const quote = source[at] as string;
    if (!quotes.includes(quote)) return null;
    let j = at + 1;
    while (j < source.length && source[j] !== quote && (multiline || source[j] !== "\n")) {
      j += source[j] === "\\" ? 2 : 1;
    }
    return { from: at + 1, to: j, next: j + 1, last: quote };
  };
}

const RAW_OPEN = /r(#*)"/y;

function skipRawString(source: string, at: number): Skip | null {
  if (source[at] !== "r" || /\w/.test(source[at - 1] ?? " ")) return null;
  RAW_OPEN.lastIndex = at;
  const open = RAW_OPEN.exec(source);
  if (!open) return null;
  const close = `"${open[1]}`;
  const from = at + open[0].length;
  const end = source.indexOf(close, from);
  const to = end === -1 ? source.length : end;
  return { from, to, next: to + close.length };
}

/** A Rust char literal; a lifetime (`'a`) is not one and is left alone. */
function skipChar(source: string, at: number): Skip | null {
  if (source[at] !== "'") return null;
  const close =
    source[at + 1] === "\\" ? source.indexOf("'", at + 3) : source[at + 2] === "'" ? at + 2 : -1;
  return close === -1 ? null : { from: at + 1, to: close, next: close + 1 };
}

/** Characters after which a `/` starts a regex literal rather than dividing. */
const REGEX_AFTER = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";"]);

/** The index of the `/` closing the regex literal whose body starts at `from`. */
function regexEnd(source: string, from: number): number {
  let j = from;
  let inClass = false;
  while (j < source.length && source[j] !== "\n" && (inClass || source[j] !== "/")) {
    inClass = source[j] === "[" || (inClass && source[j] !== "]");
    j += source[j] === "\\" ? 2 : 1;
  }
  return j;
}

function skipRegex(source: string, at: number, last: string): Skip | null {
  if (source[at] !== "/" || !REGEX_AFTER.has(last)) return null;
  const to = regexEnd(source, at + 1);
  return { from: at + 1, to, next: to + 1, last: "/" };
}

function blank(out: string[], from: number, to: number): void {
  for (let i = from; i < to; i++) if (out[i] !== "\n") out[i] = " ";
}

const RUST_SKIPPERS: Skipper[] = [
  skipLine,
  skipBlock(true),
  skipQuoted('"', true),
  skipRawString,
  skipChar,
];

export function maskRust(source: string): string {
  const out = source.split("");
  let at = 0;
  while (at < source.length) {
    const skip = RUST_SKIPPERS.map((skipper) => skipper(source, at)).find(Boolean);
    if (skip) blank(out, skip.from, skip.to);
    at = skip ? skip.next : at + 1;
  }
  return out.join("");
}

const TS_SKIPPERS: Skipper[] = [skipLine, skipBlock(false), skipQuoted("'\"", false)];

type CodeState = { at: number; depth: number; last: string };

const BRACE_DEPTH: Record<string, number> = { "{": 1, "}": -1 };

/** Code is scanned with the context a regex literal needs: the last significant character. */
class TsMasker {
  readonly out: string[];

  constructor(private readonly source: string) {
    this.out = source.split("");
  }

  /** The code from `from`; with `untilBrace`, up to the `}` closing a template placeholder. */
  code(from: number, untilBrace: boolean): number {
    const state: CodeState = { at: from, depth: 0, last: "" };
    while (state.at < this.source.length && !this.step(state, untilBrace)) {
      // each step moves `state.at` on
    }
    return state.at;
  }

  /** Advance one token; true once the placeholder's closing brace has been consumed. */
  private step(state: CodeState, untilBrace: boolean): boolean {
    const c = this.source[state.at] as string;
    const skip = this.skip(state.at, state.last);
    if (skip) {
      blank(this.out, skip.from, skip.to);
      state.last = skip.last ?? state.last;
      state.at = skip.next;
      return false;
    }
    state.at++;
    if (c === "}" && untilBrace && state.depth === 0) return true;
    state.depth += BRACE_DEPTH[c] ?? 0;
    if (!/\s/.test(c)) state.last = c;
    return false;
  }

  private skip(at: number, last: string): Skip | null {
    const found = TS_SKIPPERS.map((skipper) => skipper(this.source, at)).find(Boolean);
    if (found) return found;
    if (this.source[at] === "`") {
      const next = this.template(at + 1);
      return { from: at, to: at, next, last: "`" };
    }
    return skipRegex(this.source, at, last);
  }

  /** After the opening backtick: blank to the closing one, scanning placeholders as code. */
  private template(from: number): number {
    let at = from;
    while (at < this.source.length && this.source[at] !== "`") {
      if (this.source.startsWith("${", at)) {
        at = this.code(at + 2, true);
      } else {
        const width = this.source[at] === "\\" ? 2 : 1;
        blank(this.out, at, at + width);
        at += width;
      }
    }
    return at + 1;
  }
}

export function maskTs(source: string): string {
  const masker = new TsMasker(source);
  masker.code(0, false);
  return masker.out.join("");
}

/** Blank everything outside the given `[from, to]` ranges, keeping offsets. */
export function keepOnly(text: string, ranges: [number, number][]): string {
  const out = text.split("");
  let at = 0;
  for (const [from, to] of ranges) {
    blank(out, at, from);
    at = to + 1;
  }
  blank(out, at, text.length);
  return out.join("");
}
