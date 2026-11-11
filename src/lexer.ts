// Phil Grammar-v1 lexer.
//
// Mirrors src/Phil/Surface/GrammarV1/Lexer.hs in the upstream repository:
// token priority is char, string, U<digits>, I<digits>, float, integer,
// identifier/keyword, symbol. Unlike the upstream lexer (which stops at the
// first error) this one recovers so that an editor can report every lexical
// problem in a file.

import reservedWords from "./reserved.json";

export type TokenKind =
  | "kw"
  | "ident"
  | "uint"
  | "sint"
  | "int"
  | "float"
  | "string"
  | "char"
  | "sym"
  | "eof";

export interface Token {
  kind: TokenKind;
  text: string; // exact source spelling
  start: number; // UTF-16 offset
  end: number;
  line: number; // 0-based
  col: number; // 0-based, UTF-16 units
  endLine: number;
  endCol: number;
}

export interface Comment {
  start: number;
  end: number;
  line: number;
}

export interface Fix {
  title: string;
  start: number;
  end: number;
  newText: string;
}

export interface LexDiagnostic {
  code: string;
  message: string;
  start: number;
  end: number;
  fix?: Fix;
}

export interface LexResult {
  tokens: Token[]; // always terminated by an eof token
  comments: Comment[];
  diagnostics: LexDiagnostic[];
  lineStarts: number[];
}

export const RESERVED: ReadonlySet<string> = new Set(reservedWords as string[]);

// Longest first, exactly as the upstream pSymbol ordering.
const SYMBOLS = [
  "->", "=>", "==", "!=", "<=", ">=", "<<", ">>",
  "@", "(", ")", "{", "}", ".", ",", ":", ";",
  "[", "]", "|", "+", "-", "*", "/", "%", "=", "<", ">",
];

const LETTER = /\p{L}/u;
const ALNUM = /[\p{L}\p{N}]/u;
const WHITESPACE = /\s/u;

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= "0" && c <= "9";
}
function isHex(c: string | undefined): boolean {
  return c !== undefined && /[0-9a-fA-F]/.test(c);
}
function isIdentStart(c: string | undefined): boolean {
  return c !== undefined && (c === "_" || LETTER.test(c));
}
function isIdentContinue(c: string | undefined): boolean {
  return c !== undefined && (c === "_" || c === "'" || ALNUM.test(c));
}

export function computeLineStarts(src: string): number[] {
  const starts = [0];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

export function positionAt(lineStarts: number[], offset: number): { line: number; col: number } {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, col: offset - lineStarts[lo] };
}

/** Reads one code point (handles surrogate pairs). */
function codePointAt(src: string, i: number): { ch: string; len: number } {
  const cp = src.codePointAt(i);
  if (cp === undefined) return { ch: "", len: 0 };
  const ch = String.fromCodePoint(cp);
  return { ch, len: ch.length };
}

export function lex(src: string): LexResult {
  const tokens: Token[] = [];
  const comments: Comment[] = [];
  const diagnostics: LexDiagnostic[] = [];
  const lineStarts = computeLineStarts(src);
  let i = 0;

  const push = (kind: TokenKind, start: number, end: number) => {
    const a = positionAt(lineStarts, start);
    const b = positionAt(lineStarts, end);
    tokens.push({
      kind,
      text: src.slice(start, end),
      start,
      end,
      line: a.line,
      col: a.col,
      endLine: b.line,
      endCol: b.col,
    });
  };
  const report = (code: string, message: string, start: number, end: number, fix?: Fix) => {
    diagnostics.push({ code, message, start, end: Math.max(end, start + 1), fix });
  };

  // Scans the body of a quoted literal. Returns end offset (after closing
  // delimiter, or where scanning stopped), the number of scalars, and whether
  // the literal was properly terminated.
  const scanQuoted = (delim: string, open: number): { end: number; scalars: number; closed: boolean } => {
    let j = open + 1;
    let scalars = 0;
    while (j < src.length) {
      const c = src[j];
      if (c === delim) return { end: j + 1, scalars, closed: true };
      if (c === "\n" || c === "\r") return { end: j, scalars, closed: false };
      if (c === "\\") {
        const e = src[j + 1];
        if (e === delim || e === "\\" || e === "n" || e === "r" || e === "t") {
          j += 2;
          scalars++;
          continue;
        }
        if (e === "u") {
          if (src[j + 2] !== "{") {
            report("PHIL-L003", "Invalid Unicode escape: expected `\\u{hex}`.", j, j + 2);
            j += 2;
            scalars++;
            continue;
          }
          let k = j + 3;
          while (isHex(src[k])) k++;
          const digits = src.slice(j + 3, k);
          if (src[k] !== "}" || digits.length === 0) {
            report("PHIL-L003", "Invalid Unicode escape: expected one to six hex digits followed by `}`.", j, k);
            j = src[k] === "}" ? k + 1 : k;
            scalars++;
            continue;
          }
          const value = parseInt(digits, 16);
          if (digits.length > 6 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) {
            report(
              "PHIL-L003",
              `Invalid Unicode escape \`\\u{${digits}}\`: not a Unicode scalar value (surrogates and values above 10FFFF are rejected).`,
              j,
              k + 1,
            );
          }
          j = k + 1;
          scalars++;
          continue;
        }
        if (e === undefined || e === "\n" || e === "\r") {
          return { end: j + 1, scalars, closed: false };
        }
        const bad = codePointAt(src, j + 1);
        report(
          "PHIL-L002",
          `Invalid escape sequence \`\\${bad.ch}\`. Phil supports \\${delim}, \\\\, \\n, \\r, \\t and \\u{hex}.`,
          j,
          j + 1 + bad.len,
        );
        j += 1 + bad.len;
        scalars++;
        continue;
      }
      const cp = codePointAt(src, j);
      const code = cp.ch.codePointAt(0)!;
      if (code >= 0xd800 && code <= 0xdfff) {
        report("PHIL-L005", "Lone surrogate code unit is not a Unicode scalar.", j, j + 1);
      }
      j += cp.len;
      scalars++;
    }
    return { end: j, scalars, closed: false };
  };

  while (i < src.length) {
    const c = src[i];

    // Trivia: Unicode whitespace and // line comments. There are no block comments.
    if (WHITESPACE.test(c)) {
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      const start = i;
      while (i < src.length && src[i] !== "\n") i++;
      comments.push({ start, end: i, line: positionAt(lineStarts, start).line });
      continue;
    }

    const start = i;

    // Char literal.
    if (c === "'") {
      const r = scanQuoted("'", i);
      if (!r.closed) {
        report("PHIL-L004", "Unterminated character literal.", start, r.end);
      } else if (r.scalars !== 1) {
        report(
          "PHIL-L004",
          r.scalars === 0
            ? "Empty character literal: a Char must contain exactly one Unicode scalar."
            : "Character literal contains more than one Unicode scalar. Use double quotes for a String.",
          start,
          r.end,
        );
      }
      push("char", start, r.end);
      i = r.end;
      continue;
    }

    // String literal.
    if (c === '"') {
      const r = scanQuoted('"', i);
      if (!r.closed) {
        report(
          "PHIL-L001",
          "Unterminated string literal. Strings cannot span lines; use `\\n` for a newline.",
          start,
          r.end,
        );
      }
      push("string", start, r.end);
      i = r.end;
      continue;
    }

    // U<digits> / I<digits> primitive integer types.
    if ((c === "U" || c === "I") && isDigit(src[i + 1])) {
      let j = i + 1;
      while (isDigit(src[j])) j++;
      if (!isIdentContinue(src[j])) {
        push(c === "U" ? "uint" : "sint", start, j);
        i = j;
        continue;
      }
      // Otherwise fall through: it is an ordinary identifier such as U8x.
    }

    // Numbers.
    if (isDigit(c)) {
      let j = i;
      while (isDigit(src[j])) j++;
      let kind: TokenKind = "int";
      if (src[j] === "." && isDigit(src[j + 1])) {
        j++;
        while (isDigit(src[j])) j++;
        kind = "float";
      }
      if (isIdentContinue(src[j])) {
        let k = j;
        while (isIdentContinue(src[k])) k++;
        const hint = /^0[xXbBoO]/.test(src.slice(start, k))
          ? " Phil only has decimal integer literals."
          : " Insert a space or operator between the number and the name.";
        const text = src.slice(start, k);
        const radix = /^0[xX][0-9a-fA-F]+$/.test(text) ? 16 : /^0[bB][01]+$/.test(text) ? 2 : /^0[oO][0-7]+$/.test(text) ? 8 : 0;
        const fix = radix
          ? { title: `Replace with decimal ${BigInt((radix === 16 ? "0x" : radix === 2 ? "0b" : "0o") + text.slice(2)).toString()}`, start, end: k, newText: BigInt((radix === 16 ? "0x" : radix === 2 ? "0b" : "0o") + text.slice(2)).toString() }
          : undefined;
        report(
          "PHIL-L006",
          `Malformed number \`${text}\`: a numeric literal cannot be directly followed by letters, digits, \`_\` or \`'\`.${hint}`,
          start,
          k,
          fix,
        );
        push(kind, start, k);
        i = k;
        continue;
      }
      push(kind, start, j);
      i = j;
      continue;
    }

    // Identifiers and keywords.
    const cp = codePointAt(src, i);
    if (isIdentStart(cp.ch)) {
      let j = i + cp.len;
      for (;;) {
        const n = codePointAt(src, j);
        if (n.len === 0 || !isIdentContinue(n.ch)) break;
        j += n.len;
      }
      const text = src.slice(start, j);
      push(RESERVED.has(text) ? "kw" : "ident", start, j);
      i = j;
      continue;
    }

    // Symbols.
    const sym = SYMBOLS.find((s) => src.startsWith(s, i));
    if (sym) {
      push("sym", start, i + sym.length);
      i += sym.length;
      continue;
    }

    // Unexpected character: report and skip a maximal run of junk so one
    // stray paste does not produce a hundred diagnostics.
    let j = i + cp.len;
    while (j < src.length) {
      const n = codePointAt(src, j);
      if (
        WHITESPACE.test(n.ch) || isIdentStart(n.ch) || isDigit(n.ch) || n.ch === '"' || n.ch === "'" ||
        SYMBOLS.some((s) => src.startsWith(s, j))
      ) break;
      j += n.len;
    }
    const junk = src.slice(start, j);
    const replacements: Record<string, string> = { "&&": "and", "!": "not ", "#": "//" };
    const rep = replacements[junk];
    report("PHIL-L005", unexpectedCharMessage(junk), start, j,
      rep !== undefined ? { title: `Replace \`${junk}\` with \`${rep.trim()}\``, start, end: j, newText: junk === "&&" ? "and" : rep } : undefined);
    i = j;
  }

  push("eof", src.length, src.length);
  return { tokens, comments, diagnostics, lineStarts };
}

function unexpectedCharMessage(junk: string): string {
  const hints: Record<string, string> = {
    "!": "Use `not` for negation (`!=` is the only operator containing `!`).",
    "&&": "Use `and` in propositions.",
    "&": "Phil has no `&` operator; use `and` in propositions or `borrow ... as` for references.",
    "||": "Use `or` in propositions.",
    "#": "Comments start with `//`.",
    "?": "Phil has no `?` operator; handle failure with `or fail ...` or `or reject ...`.",
    "`": "Backticks are not Phil syntax.",
    "$": "`$` is not valid in Phil identifiers.",
    "~": "Phil has no `~` operator.",
    "^": "Phil has no `^` operator.",
    "\\": "Backslashes are only valid inside string and character literals.",
  };
  const first = junk.startsWith("&&") ? "&&" : junk.startsWith("||") ? "||" : junk[0];
  const hint = hints[first] ?? "";
  const shown = junk.length > 12 ? junk.slice(0, 12) + "…" : junk;
  return `Unexpected character${junk.length > 1 ? "s" : ""} \`${shown}\`.${hint ? " " + hint : ""}`;
}
