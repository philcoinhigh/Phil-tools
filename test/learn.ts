// Every lesson's starter must behave as described and every solution must pass its check.
import * as fs from "fs";
import { LESSONS } from "../site/src/lessons";
import { runPhil } from "../site/src/shared";
import { checkLesson } from "../site/src/check";
import { OTC_SOURCE, BOOK_SOURCE } from "../core/src/sim/otc-source";
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
const BASE = { selling: "1000", unit_price: "2", want: "400", wallet: "5000", fee_bps: "100", expires_after: "10", cancel_after: "0" };
for (const [name, change, want, says] of [
  ["sold out in three fills", {}, ["taker:1000", "maker:1980", "desk:20"], "sold out"],
  ["wallet runs dry, then expires", { wallet: "1000", expires_after: "5" }, ["taker:400", "maker:792", "desk:8"], "tokens back: 600"],
  ["maker cancels after one fill", { cancel_after: "1" }, ["taker:400", "maker:792", "desk:8"], "cancelled and got tokens back: 600"],
  ["expires part-filled", { expires_after: "2" }, ["taker:800", "maker:1584", "desk:16"], "tokens back: 200"],
  ["expires unfilled", { wallet: "0", expires_after: "3" }, ["taker:0", "maker:0", "desk:0"], "tokens back: 1000"],
] as const) {
  const o = runPhil(OTC_SOURCE, { ...BASE, ...change });
  const got = o.returns.map((r) => `${r.proc}:${r.text}`);
  check(`otc: ${name}`, o.ok && want.every((w) => got.includes(w)) && o.console.some((l) => l.includes(says)), got.join(" ") + " | " + o.console.join(" / ") + " " + o.message);
}
check("otc: a fee above 10% is refused", runPhil(OTC_SOURCE, { ...BASE, fee_bps: "1001" }).ok === false);
const hunt = explore(buildAst(OTC_SOURCE), BASE, { budgetMs: 3000 });
check(`otc: hunt finds nothing in ${hunt.runs} runs`, hunt.findings.length === 0 && hunt.runs > 50, JSON.stringify(hunt.findings[0] ?? {}).slice(0, 300));

// Order book
check("book source is in sync with otc/book.phil", fs.readFileSync("otc/book.phil", "utf8") === BOOK_SOURCE);
const shared = (src: string) => src.slice(src.indexOf("record Token"), src.indexOf("architecture "));
check("book reuses the desk's records, contracts, protocols and components unchanged", shared(BOOK_SOURCE).startsWith(shared(OTC_SOURCE)));
const BOOK = { a_selling: "600", a_price: "3", b_selling: "500", b_price: "2", x_want: "300", x_wallet: "2000", y_want: "400", y_wallet: "900", fee_bps: "100", expires_after: "10", cancel_after: "0" };
for (const [name, change, want] of [
  ["cheaper listing fills first, dearer one expires part-filled", {}, ["maker_b:990", "desk_b:10", "maker_a:891", "desk_a:9", "taker_x:600", "taker_y:200"]],
  ["both sell out with deep wallets", { x_wallet: "100000", y_wallet: "100000" }, ["maker_b:990", "maker_a:1782", "desk_a:18", "taker_x:600", "taker_y:500"]],
  ["both makers cancel after one fill", { cancel_after: "1" }, ["maker_b:594", "maker_a:891", "taker_x:600", "taker_y:0"]],
  ["nobody can pay, both expire", { x_wallet: "0", y_wallet: "0", expires_after: "100" }, ["maker_a:0", "maker_b:0", "taker_x:0", "taker_y:0"]],
  ["equal prices: listing A goes first", { a_price: "2" }, ["maker_a:1188", "maker_b:990", "taker_x:800", "taker_y:300"]],
] as const) {
  const o = runPhil(BOOK_SOURCE, { ...BOOK, ...change });
  const got = o.returns.map((r) => `${r.proc}:${r.text}`);
  check(`book: ${name}`, o.ok && want.every((w) => got.includes(w)), got.join(" ") + " " + o.message);
}
const bookHunt = explore(buildAst(BOOK_SOURCE), BOOK, { budgetMs: 4000 });
check(`book: hunt finds nothing in ${bookHunt.runs} runs`, bookHunt.findings.length === 0 && bookHunt.runs > 50, JSON.stringify(bookHunt.findings[0] ?? {}).slice(0, 300));
process.exit(fails ? 1 : 0);
