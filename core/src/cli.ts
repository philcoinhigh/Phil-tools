#!/usr/bin/env node
// phil-check: command-line Grammar-v1 syntax checker (same engine as the extension).
//
//   node out/cli.js [--format] [--json] FILE...
//
// Exit status: 0 = no errors, 1 = syntax errors, 2 = usage/IO error.

import * as fs from "fs";
import { parse } from "./parser";
import { positionAt } from "./lexer";
import { formatText } from "./format";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const files = args.filter((a) => !a.startsWith("--"));
if (files.length === 0 || flags.has("--help")) {
  console.error("usage: phil-check [--format] [--json] FILE...");
  process.exit(2);
}

let errors = 0;
const json: unknown[] = [];
for (const file of files) {
  let src: string;
  try {
    src = fs.readFileSync(file, "utf8");
  } catch (e) {
    console.error(`${file}: ${(e as Error).message}`);
    process.exit(2);
  }
  if (flags.has("--format")) {
    process.stdout.write(formatText(src, { tabSize: 2, insertSpaces: true }));
    continue;
  }
  const result = parse(src);
  for (const d of result.diagnostics) {
    const p = positionAt(result.lex.lineStarts, d.start);
    if (d.severity === "error") errors++;
    if (flags.has("--json")) json.push({ file, line: p.line + 1, column: p.col + 1, ...d });
    else console.log(`${file}:${p.line + 1}:${p.col + 1}: ${d.severity} ${d.code}: ${d.message}`);
  }
}
if (flags.has("--json")) console.log(JSON.stringify(json, null, 2));
process.exit(errors > 0 ? 1 : 0);
