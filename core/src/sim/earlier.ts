// Phil's earlier (Phase 0) surface syntax has no `;` after statements. Phil's own compiler still
// reads that form, so the simulator accepts the simple cases of it too.
//
// The conversion keeps every character at the same offset: comments become spaces and the newline
// that ends a statement becomes `;`. Spans from the converted text therefore point at the right
// place in the original, and the program keeps the original text for line numbers.
import { lex } from "../lexer";
import { parse } from "../parser";
import { buildAst, Program } from "./ast";

const OPENERS = new Set(["{", "}", "(", ",", "|", "=", ">"]);

/** The Grammar-v1 reading of an earlier-syntax program, or undefined if it is not one we can read. */
export function readEarlierSyntax(src: string): string | undefined {
  const first = parse(src, { syntax: "auto" });
  if (!first.legacy) return undefined;
  const chars = [...src];
  if (chars.length !== src.length) return undefined;            // astral characters would shift offsets
  for (const c of lex(src).comments) for (let i = c.start; i < c.end; i++) if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
  let lineStart = 0;
  for (let i = 0; i <= chars.length; i++) {
    if (i < chars.length && chars[i] !== "\n") continue;
    const line = chars.slice(lineStart, i).join("").trim();
    if (i < chars.length && line && !OPENERS.has(line[line.length - 1]) && !line.endsWith(";")) chars[i] = ";";
    lineStart = i + 1;
  }
  const out = chars.join("");
  return parse(out, { syntax: "grammar-v1" }).diagnostics.some((d) => d.severity === "error") ? undefined : out;
}

/** buildAst that also accepts simple earlier-syntax programs. `earlier` says which reading was used. */
export function buildProgram(src: string): Program & { earlier?: boolean } {
  const converted = readEarlierSyntax(src);
  if (converted === undefined) return buildAst(src);
  const program: Program & { earlier?: boolean } = buildAst(converted);
  program.source = src;
  program.earlier = true;
  return program;
}
