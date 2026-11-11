#!/usr/bin/env node
// phil-mcp: a Model Context Protocol server (stdio) that lets AI assistants check,
// format, run and bug-hunt Phil code instead of guessing. Unofficial community tool.
import * as readline from "readline";
import { parse } from "./parser";
import { positionAt, RESERVED } from "./lexer";
import { formatText } from "./format";
import { buildAst } from "./sim/ast";
import { run, Simulator } from "./sim/interp";
import { explore } from "./sim/explore";
import { generateProtocol } from "./sim/designer";
import { CODE_MAP } from "./codes";
import keywordDocs from "./keywords.json";

const KW = keywordDocs as Record<string, { category: string; meaning: string }>;
const src = { type: "string", description: "Phil source code (Grammar v1)" };
const NOTE = "Results come from an unofficial community checker and simulator, not the Phil project's own toolchain.";

function check(source: string) {
  const r = parse(source, { syntax: "grammar-v1" });
  return r.diagnostics.filter((d) => d.severity !== "information").map((d) => {
    const p = positionAt(r.lex.lineStarts, d.start);
    return { line: p.line + 1, column: p.col + 1, severity: d.severity, code: d.code, message: d.message, explanation: CODE_MAP.get(d.code)?.explanation, fix: d.fix?.title };
  });
}
const lineOf = (source: string, span?: [number, number]) => (span ? source.slice(0, span[0]).split("\n").length : undefined);

const TOOLS: { name: string; description: string; inputSchema: object; call: (a: Record<string, unknown>) => unknown }[] = [
  {
    name: "phil_check", description: "Check Phil source against Grammar v1. Returns syntax diagnostics with error codes, explanations and suggested fixes. Syntax only.",
    inputSchema: { type: "object", properties: { source: src }, required: ["source"] },
    call: (a) => { const d = check(String(a.source)); return { valid: !d.some((x) => x.severity === "error"), diagnostics: d }; },
  },
  {
    name: "phil_format", description: "Re-indent Phil source (tokens are never changed).",
    inputSchema: { type: "object", properties: { source: src }, required: ["source"] },
    call: (a) => ({ formatted: formatText(String(a.source), { tabSize: 2, insertSpaces: true }) }),
  },
  {
    name: "phil_run", description: "Run a Phil program in the experimental simulator. Checks ownership (linear/affine), protocol steps, contracts and non-wrapping arithmetic at runtime. `inputs` maps entry names to values.",
    inputSchema: { type: "object", properties: { source: src, inputs: { type: "object", additionalProperties: { type: "string" } } }, required: ["source"] },
    call: (a) => {
      const source = String(a.source);
      const d = check(source).filter((x) => x.severity === "error");
      if (d.length) return { ran: false, reason: "syntax errors", diagnostics: d };
      const ast = buildAst(source);
      const r = run(ast, (a.inputs ?? {}) as Record<string, string>);
      return {
        ran: true, ok: r.ok, entries: new Simulator(ast).entries().map((e) => `${e.name} : ${e.typeText}`), processes: r.processes,
        error: r.error && { kind: r.error.kind, message: r.error.message, hint: r.error.hint, process: r.error.process, line: lineOf(source, r.error.span) },
        events: r.trace.filter((t) => t.kind !== "check" && t.kind !== "own").slice(0, 200), contractChecks: r.checks, steps: r.steps,
      };
    },
  },
  {
    name: "phil_hunt", description: "Bounded bug hunt: runs the program (or each function, if there is no program) on boundary inputs, several schedules and external-peer strategies. Returns each distinct failure with a smallest failing input. Not a proof.",
    inputSchema: { type: "object", properties: { source: src }, required: ["source"] },
    call: (a) => {
      const source = String(a.source);
      const d = check(source).filter((x) => x.severity === "error");
      if (d.length) return { ran: false, reason: "syntax errors", diagnostics: d };
      const r = explore(buildAst(source), {}, { budgetMs: 3000, maxRuns: 5000 });
      return { ...r, findings: r.findings.map((f) => ({ kind: f.kind, where: f.where, line: lineOf(source, f.span), message: f.message, hint: f.hint, inputs: f.inputs, occurrences: f.count })) };
    },
  },
  {
    name: "phil_keyword", description: "Explain a Phil keyword, or list all keywords when `word` is omitted.",
    inputSchema: { type: "object", properties: { word: { type: "string" } } },
    call: (a) => (a.word ? (KW[String(a.word)] ?? { error: `\`${a.word}\` is not a Phil keyword` }) : { keywords: Object.keys(KW) }),
  },
  {
    name: "phil_generate_protocol", description: "Generate a complete runnable Phil program (dual protocol roles, components, architecture) from a list of message steps.",
    inputSchema: {
      type: "object", required: ["name", "steps"],
      properties: {
        name: { type: "string" }, roleA: { type: "string" }, roleB: { type: "string" }, repeat: { type: "boolean" },
        steps: { type: "array", items: { type: "object", required: ["from", "name", "type"], properties: { from: { enum: ["a", "b"] }, name: { type: "string" }, type: { enum: ["U8", "U32", "U64", "Bool", "String"] } } } },
      },
    },
    call: (a) => ({ source: generateProtocol({ name: String(a.name), roleA: String(a.roleA ?? "Client"), roleB: String(a.roleB ?? "Server"), repeat: !!a.repeat, steps: (a.steps as never[]) ?? [] }, RESERVED) }),
  },
];

const send = (msg: object) => process.stdout.write(JSON.stringify(msg) + "\n");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  let req: { id?: number | string; method?: string; params?: Record<string, unknown> };
  try { req = JSON.parse(line); } catch { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); return; }
  if (req.id === undefined) return; // notifications need no reply
  const reply = (result: unknown) => send({ jsonrpc: "2.0", id: req.id, result });
  switch (req.method) {
    case "initialize":
      return reply({ protocolVersion: (req.params?.protocolVersion as string) ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "phil-mcp", version: "0.2.0" }, instructions: NOTE });
    case "ping": return reply({});
    case "tools/list": return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === req.params?.name);
      if (!tool) return send({ jsonrpc: "2.0", id: req.id, error: { code: -32602, message: `Unknown tool ${req.params?.name}` } });
      try {
        const out = tool.call((req.params?.arguments ?? {}) as Record<string, unknown>);
        return reply({ content: [{ type: "text", text: JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v instanceof Map ? Object.fromEntries(v) : v), 1) }] });
      } catch (e) {
        return reply({ isError: true, content: [{ type: "text", text: `phil-mcp failed: ${(e as Error).message}` }] });
      }
    }
    default: return send({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: `Method not found: ${req.method}` } });
  }
});
