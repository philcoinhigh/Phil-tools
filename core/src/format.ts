// Indentation formatter. Only leading whitespace is rewritten and trailing
// whitespace trimmed; token order is never changed, so formatting cannot alter
// the meaning of a file. Bracket depth comes from the lexer, so brackets inside
// strings and comments are ignored.

import { lex, Token } from "./lexer";

export interface LineEdit {
  line: number;
  newText: string; // full replacement for the line
}

const OPENERS = new Set(["(", "[", "{"]);
const CLOSERS = new Set([")", "]", "}"]);
const LEADING_CONTINUATION = new Set(["or", "and", "using", "then", "satisfies", "provides", "requires", "captures", "invariant", "join", "on", "to", "as", "from", "at", "when", ".", "|", "+", "-", "*", "/", "%", "<<", ">>", "==", "!=", "<=", ">=", "->", "=>", "="]);
const NO_CONTINUE_AFTER = new Set([";", "{", "}", ",", "|", "(", "[", ")", "]"]);

export function formatLines(src: string, opts: { tabSize: number; insertSpaces: boolean }): LineEdit[] {
  const { tokens, comments } = lex(src);
  const lines = src.split("\n");
  const unit = opts.insertSpaces ? " ".repeat(opts.tabSize) : "\t";

  // Group tokens by starting line.
  const byLine = new Map<number, Token[]>();
  for (const t of tokens) {
    if (t.kind === "eof") continue;
    if (!byLine.has(t.line)) byLine.set(t.line, []);
    byLine.get(t.line)!.push(t);
  }
  const commentLines = new Set(comments.map((c) => c.line));
  // Legacy Phase 0 files have no `;` terminators, so line continuation cannot be inferred.
  const terminated = tokens.some((t) => t.kind === "sym" && t.text === ";");

  const edits: LineEdit[] = [];
  let depth = 0;
  let prevLast: Token | undefined;
  let itemLevel = 0; // level of the line that started the current item

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, "");
    const cr = lines[i].endsWith("\r") ? "\r" : "";
    const content = raw.trim();
    const toks = byLine.get(i) ?? [];

    let level = depth;
    if (toks.length > 0) {
      const first = toks[0];
      const startsWithCloser = first.kind === "sym" && CLOSERS.has(first.text);
      if (startsWithCloser) level = Math.max(0, depth - 1);
      const leadsAsContinuation =
        prevLast !== undefined && !startsWithCloser && (first.kind === "sym" || first.kind === "kw") &&
        LEADING_CONTINUATION.has(first.text) &&
        !(prevLast.kind === "sym" && (prevLast.text === ";" || prevLast.text === "{" || prevLast.text === "}"));
      const continues = leadsAsContinuation || (
        terminated &&
        prevLast !== undefined &&
        !startsWithCloser &&
        !(prevLast.kind === "sym" && NO_CONTINUE_AFTER.has(prevLast.text)) &&
        !(first.kind === "sym" && first.text === "@"));
      if (continues) level = Math.max(level, itemLevel + 1);
      else itemLevel = level;
    } else if (commentLines.has(i)) {
      level = depth;
    }

    const newText = content.length === 0 ? "" : unit.repeat(level) + content;
    if (newText + cr !== lines[i]) edits.push({ line: i, newText: newText + cr });

    for (const t of toks) {
      if (t.kind !== "sym") continue;
      if (OPENERS.has(t.text)) depth++;
      else if (CLOSERS.has(t.text)) depth = Math.max(0, depth - 1);
    }
    if (toks.length > 0) prevLast = toks[toks.length - 1];
  }
  return edits;
}

export function formatText(src: string, opts: { tabSize: number; insertSpaces: boolean }): string {
  const lines = src.split("\n");
  for (const e of formatLines(src, opts)) lines[e.line] = e.newText;
  return lines.join("\n");
}
