import * as fs from "fs"; import * as path from "path";
import { parse } from "../src/parser"; import { buildAst } from "../src/sim/ast";
import { explore } from "../src/sim/explore"; import { EXAMPLES } from "../src/sim/examples";
const root = process.argv[2];
console.log("== examples");
for (const ex of EXAMPLES) {
  const r = explore(buildAst(ex.code), ex.inputs ?? {});
  console.log(`${ex.id.padEnd(12)} expect=${ex.expect.padEnd(10)} runs=${r.runs} skip=${r.skipped} inc=${r.inconclusive} ${r.ms}ms findings=${r.findings.map(f => `${f.kind}[${f.inputs.map(i => i.name + "=" + i.text).join(",")}]x${f.count}`).join(" | ") || "none"}${r.unsupported.length ? " UNSUP " + r.unsupported : ""}`);
}
console.log("== fixtures");
const dirs = fs.readdirSync(root + "/test/fixtures").filter(d => d.startsWith("fsem"));
let tally: Record<string, number> = {};
for (const d of dirs) for (const f of fs.readdirSync(path.join(root, "test/fixtures", d)).filter(f => f.endsWith(".phil"))) {
  const src = fs.readFileSync(path.join(root, "test/fixtures", d, f), "utf8");
  const syn = parse(src, { syntax: "grammar-v1" }).diagnostics.filter(x => x.severity === "error");
  let verdict = "", detail = "";
  if (syn.length) { verdict = "REJECT"; detail = syn[0].code; }
  else { try { const r = explore(buildAst(src), {}, { budgetMs: 300, stepLimit: 3000 }); verdict = r.findings.length ? "REJECT" : r.mode === "none" || (!r.runs) ? "n/a" : "accept"; detail = r.findings[0] ? r.findings[0].kind + ": " + r.findings[0].message.slice(0, 90) : r.unsupported.join(";"); } catch (e) { verdict = "CRASH"; detail = String(e); } }
  const exp = /^(accepted|positive)/.test(f) ? "accept" : "?";
  const key = `${exp}->${verdict}`; tally[key] = (tally[key] ?? 0) + 1;
  if (process.env.V || (exp === "accept" && verdict !== "accept") || verdict === "CRASH") console.log(`${verdict.padEnd(7)} ${d}/${f}  ${detail}`);
}
console.log(tally);
