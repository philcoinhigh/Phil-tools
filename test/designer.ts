import { generateProtocol, ProtocolSpec, defaultEntry } from "../core/src/sim/designer";
import { RESERVED } from "../core/src/lexer"; import { parse } from "../core/src/parser"; import { buildAst } from "../core/src/sim/ast";
import { run, Simulator } from "../core/src/sim/interp"; import { explore } from "../core/src/sim/explore";
const specs: ProtocolSpec[] = [
  { name: "Order", roleA: "Buyer", roleB: "Seller", repeat: false, steps: [{ from: "a", name: "item", type: "U32" }, { from: "b", name: "price", type: "U64" }, { from: "a", name: "accept", type: "Bool" }] },
  { name: "Chat", roleA: "Client", roleB: "Server", repeat: true, steps: [{ from: "a", name: "question", type: "String" }, { from: "b", name: "answer", type: "String" }] },
  { name: "empty!", roleA: "A", roleB: "A", repeat: false, steps: [] },
  { name: "Loop", roleA: "send", roleB: "9x", repeat: true, steps: [{ from: "b", name: "send", type: "U8" }, { from: "b", name: "send", type: "Nope" }] },
  { name: "X", roleA: "L", roleB: "R", repeat: true, steps: [] },
];
let fails = 0;
for (const s of specs) {
  const code = generateProtocol(s, RESERVED);
  const syn = parse(code, { syntax: "grammar-v1" }).diagnostics.filter(d => d.severity === "error");
  if (syn.length) { fails++; console.log("SYNTAX", s.name, syn[0].message, "\n" + code); continue; }
  const ast = buildAst(code); const inputs: Record<string, string> = {};
  for (const e of new Simulator(ast).entries()) inputs[e.name] = e.name === "rounds" ? "2" : defaultEntry(e.typeText);
  const r = run(ast, inputs); const h = explore(ast, inputs, { budgetMs: 500 });
  const ok = r.ok && h.findings.length === 0; if (!ok) { fails++; console.log(code); }
  console.log(ok ? "ok  " : "FAIL", s.name, r.ok ? r.processes.map(p => p.status).join("/") : r.error!.message, `hunt runs=${h.runs} findings=${h.findings.map(f => f.message).join("|")}`);
}
process.exit(fails ? 1 : 0);
