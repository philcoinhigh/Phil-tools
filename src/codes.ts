// Error code catalog. These codes belong to this extension; the upstream Phil
// toolchain does not (yet) publish stable diagnostic codes.

export interface CodeInfo {
  code: string;
  title: string;
  explanation: string;
  bad?: string;
  good?: string;
}

export const CODES: CodeInfo[] = [
  // Lexical
  {
    code: "PHIL-L001", title: "Unterminated string literal",
    explanation: "A string literal must close with `\"` on the same line. Raw newlines and carriage returns are not allowed inside strings; write `\\n` instead.",
    bad: 'let s = "hello\nworld";', good: 'let s = "hello\\nworld";',
  },
  {
    code: "PHIL-L002", title: "Invalid escape sequence",
    explanation: "Inside string and character literals Phil accepts only `\\\"` (or `\\'` in chars), `\\\\`, `\\n`, `\\r`, `\\t` and `\\u{hex}`.",
    bad: 'let s = "tab\\q";', good: 'let s = "tab\\t";',
  },
  {
    code: "PHIL-L003", title: "Invalid Unicode escape",
    explanation: "`\\u{...}` must contain one to six hex digits naming a Unicode scalar value: at most 10FFFF and not a surrogate (D800–DFFF).",
    bad: "let c = '\\u{D800}';", good: "let c = '\\u{1F600}';",
  },
  {
    code: "PHIL-L004", title: "Invalid character literal",
    explanation: "A `Char` literal must contain exactly one Unicode scalar between single quotes. Use double quotes for a `String`.",
    bad: "let c = 'ab';", good: 'let s = "ab";',
  },
  {
    code: "PHIL-L005", title: "Unexpected character",
    explanation: "The character cannot start any Phil token. Common causes: `!` (use `not`), `&&`/`||` (use `and`/`or`), `#` comments (use `//`), `?`.",
    bad: "requires !done && ready;", good: "requires not done and ready;",
  },
  {
    code: "PHIL-L006", title: "Malformed number",
    explanation: "Numeric literals are plain decimal (`42`, `1.5`) and may not run into letters. Phil has no hex/binary literals or type suffixes; use `convert e to T` for width changes.",
    bad: "let x = 0xFF;", good: "let x = 255;",
  },
  // Syntax
  {
    code: "PHIL-P001", title: "Syntax error",
    explanation: "The parser expected one of the listed tokens or constructs. The location is the furthest point any grammar alternative reached, which is usually where the mistake is. Where a near-miss keyword is found, a 'Did you mean' quick fix is offered.",
  },
  {
    code: "PHIL-P002", title: "Unclosed delimiter",
    explanation: "A `(`, `[` or `{` has no matching closer. The related location shows where the parser found a different closer.",
  },
  {
    code: "PHIL-P003", title: "Unmatched closing delimiter",
    explanation: "A `)`, `]` or `}` appears with no corresponding opener.",
  },
  {
    code: "PHIL-P005", title: "Reserved word used as a name",
    explanation: "Phil reserves 138 words (see the keyword hovers). They cannot be used as identifiers. Note that modes such as `linear` are properties of types, never of bindings.",
    bad: "let linear x = payload;", good: "let x = payload;",
  },
  {
    code: "PHIL-P006", title: "Construct from another language",
    explanation: "The word is common in other languages but has no meaning in Phil. The message explains the Phil way to express the same intent.",
    bad: "unsafe { 0 }", good: "// state the assumption explicitly instead",
  },
  {
    code: "PHIL-P007", title: "Missing semicolon",
    explanation: "Grammar v1 terminates every statement and static declaration item with `;`, including expression statements that end in a block such as `match`, `offer` or `loop`. A quick fix inserts it.",
    bad: "return unit\n}", good: "return unit;\n}",
  },
  {
    code: "PHIL-P008", title: "Assignment is not supported",
    explanation: "Phil bindings are immutable. Introduce a new binding with `let`, or carry changing state through `loop state (...)` and `continue (...)`.",
    bad: "x = 1;", good: "let x = 1;",
  },
  {
    code: "PHIL-P009", title: "Unexpected end of file",
    explanation: "The file ended in the middle of a construct, usually because of a missing `}` or `;`.",
  },
  // Structure
  {
    code: "PHIL-S001", title: "Duplicate top-level name (warning)",
    explanation: "Two top-level declarations in the same file share a name. This is reported as a warning because the extension does not model Phil's name resolution; the checker has the final word.",
  },
  {
    code: "PHIL-S002", title: "Duplicate field, variant, parameter, arm or branch",
    explanation: "A record field, sum variant, term parameter, match/offer/decide arm, or protocol select/offer branch label appears twice in the same list. The upstream checker rejects duplicate offer arms (see test/fixtures/fsem02-source-offer-v1/duplicate-arm.phil).",
    bad: "offer endpoint {\n  Go => { return unit; }\n  Go => { return unit; }\n};",
  },
  // Information
  {
    code: "PHIL-I001", title: "Legacy Phase 0 syntax",
    explanation: "The file is not valid Grammar v1 and contains no `;` terminators, so it is treated as the frozen Phase 0 surface syntax that `philc` and the repository's `examples/` still use. Only lexical and bracket checks run on it.",
  },
  // Compiler
  {
    code: "PHIL-C001", title: "philc rejected the file",
    explanation: "Reported by the 'Phil: Emit LLVM IR with philc' command. The current public compiler only lowers a tiny runnable fragment: a single `component main` with no parameters that provides `Unit` (body exactly `return unit`) or `U32` (only `let` bindings and a final `return` of integer literals).",
  },
];

export const CODE_MAP: ReadonlyMap<string, CodeInfo> = new Map(CODES.map((c) => [c.code, c]));

export function codesMarkdown(): string {
  const lines = [
    "# Phil extension error codes",
    "",
    "These codes are defined by the Phil VS Code extension. The upstream Phil toolchain does not yet publish stable diagnostic codes; the extension's syntax checker follows `grammar/phase1-surface.ebnf` (Grammar v1). Passing these checks means the file is syntactically valid, not that the Phil checker accepts its ownership, typing, authority or proof obligations.",
    "",
    "| Code | Meaning |",
    "| --- | --- |",
    ...CODES.map((c) => `| [${c.code}](#${c.code.toLowerCase()}) | ${c.title} |`),
    "",
  ];
  for (const c of CODES) {
    lines.push(`## ${c.code}`, "", `**${c.title}**`, "", c.explanation, "");
    if (c.bad) lines.push("Rejected:", "", "```phil", c.bad, "```", "");
    if (c.good) lines.push("Accepted:", "", "```phil", c.good, "```", "");
  }
  return lines.join("\n");
}
