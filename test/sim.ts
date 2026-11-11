import { parse } from "../src/parser";
import { buildAst } from "../src/sim/ast";
import { run } from "../src/sim/interp";
import { EXAMPLES } from "../src/sim/examples";
let fails = 0;
for (const ex of EXAMPLES) {
  const syn = parse(ex.code, { syntax: "grammar-v1" }).diagnostics.filter(d => d.severity === "error");
  if (syn.length) { fails++; console.log(`FAIL ${ex.id}: syntax ${syn[0].message}`); continue; }
  const r = run(buildAst(ex.code), ex.inputs ?? {});
  const got = r.ok ? "ok" : r.error!.kind;
  const line = r.error?.span ? ex.code.slice(0, r.error.span[0]).split("\n").length : 0;
  const ok = got === ex.expect;
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${ex.id.padEnd(12)} expect=${ex.expect.padEnd(10)} got=${got}${r.error ? ` L${line} [${r.error.process ?? ""}] ${r.error.message}${r.error.hint ? " ⟶ " + r.error.hint : ""}` : ""}`);
  if (process.env.V) for (const t of r.trace) if (t.kind !== "check") console.log("     ", JSON.stringify(t));
  if (r.ok) console.log("      processes:", r.processes.map(p => `${p.name}: ${p.status}`).join(" | "), `checks=${r.checks} steps=${r.steps}`);
}
process.exit(fails ? 1 : 0);
