// Every lesson's starter must behave as described and every solution must pass its check.
import * as fs from "fs";
import { LESSONS } from "../site/src/lessons";
import { runPhil } from "../site/src/shared";
import { checkLesson } from "../site/src/check";
import { OTC_SOURCE } from "../core/src/sim/otc-source";
import { buildAst } from "../core/src/sim/ast";
import { explore } from "../core/src/sim/explore";

let fails = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) fails++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : "  " + detail}`); };
for (const l of LESSONS) {
  const inputs = l.inputs ?? {};
  const a = runPhil(l.code, inputs);
  check(`${l.id}: starter is ${l.starts}`, a.kind === l.starts, `${a.kind} L${a.line} ${a.message}`);
  if (l.task) {
    check(`${l.id}: starter does not already pass`, checkLesson(l, l.code, a, inputs) !== undefined);
    const b = runPhil(l.solution!, inputs);
    const why = checkLesson(l, l.solution!, b, inputs);
    check(`${l.id}: solution passes`, why === undefined, `${b.kind} L${b.line} ${b.message} | ${why}`);
  } else check(`${l.id}: has no task and runs`, a.ok && !l.solution);
}
check("otc source is in sync with otc/otc.phil", fs.readFileSync("otc/otc.phil", "utf8") === OTC_SOURCE);
for (const [name, inputs, want] of [
  ["filled", { selling: "1000", price: "250", wallet: "400", fee_bps: "100" }, ["taker:1000", "maker:248", "desk:2"]],
  ["refunded", { selling: "1000", price: "250", wallet: "100", fee_bps: "100" }, ["taker:0", "maker:0", "desk:0"]],
] as const) {
  const o = runPhil(OTC_SOURCE, inputs);
  const got = o.returns.map((r) => `${r.proc}:${r.text}`);
  check(`otc ${name}`, o.ok && want.every((w) => got.includes(w)), got.join(" "));
}
const hunt = explore(buildAst(OTC_SOURCE), { selling: "1000", price: "250", wallet: "400", fee_bps: "100" }, { budgetMs: 3000 });
check(`otc hunt finds nothing in ${hunt.runs} runs`, hunt.findings.length === 0 && hunt.runs > 50, JSON.stringify(hunt.findings[0] ?? {}).slice(0, 300));
process.exit(fails ? 1 : 0);
