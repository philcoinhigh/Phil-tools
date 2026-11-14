// Every program on the Tour page does what the page says, and the page still follows Phil's tour.
import * as fs from "fs";
import { STOPS, anchor } from "../site/src/tour-data";
import { runPhil } from "../site/src/shared";
import { parse } from "../core/src/parser";

let fails = 0;
const check = (name: string, ok: boolean, info = "") => { if (!ok) { fails++; console.log("FAIL", name, info); } else console.log("ok  ", name); };
for (const s of STOPS) s.parts.forEach((p, i) => {
  const o: any = runPhil(p.code, p.inputs ?? {});
  const name = `${s.n}${s.parts.length > 1 ? "." + (i + 1) : ""} ${p.label ?? s.title}`;
  const out = [...o.console, ...o.returns.map((r: any) => r.text)].join("\n");
  if (p.expect === "runs") check(`${name}: runs`, o.ok && (!p.shows || out.includes(p.shows)) && (!p.returns || o.returns.some((r: any) => r.text === p.returns)), o.ok ? out : `${o.kind}: ${o.message}`);
  else if (p.expect === "declares") check(`${name}: valid Grammar v1 with nothing to run`, !o.ok && o.kind === "wiring" && /Nothing to run/.test(o.message) && parse(p.code, { syntax: "grammar-v1" }).diagnostics.every((d) => d.severity !== "error"), `${o.kind}: ${o.message}`);
  else check(`${name}: stopped with the expected kind of error`, !o.ok && o.kind === p.kind, `${o.kind}: ${o.message}`);
});
check("twenty stops, numbered 1 to 20", STOPS.length === 20 && STOPS.every((s, i) => s.n === i + 1));
const tour = [process.env.PHIL_REPO, "../phil", "/home/claude/src/phil"].filter(Boolean).map((p) => `${p}/docs/tutorials/tour-phase1.md`).find((p) => fs.existsSync(p));
if (tour) {
  const md = fs.readFileSync(tour, "utf8");
  const headings = [...md.matchAll(/^## (\d+)\. (.+)$/gm)].map((m) => `${m[1]}. ${m[2]}`);
  check("the stops are the tour's own sections, in order", headings.length === STOPS.length && STOPS.every((s, i) => headings[i] === `${s.n}. ${s.title}`), headings.filter((h, i) => h !== `${STOPS[i]?.n}. ${STOPS[i]?.title}`).join(" | "));
  check("the tour still prints the loop with `if i > 1`, which is what our note is about", /if i > 1 \{/.test(md));
  check("our checker still cannot read that line as Grammar v1", parse("component C(n : U32) {\n  loop state (i : U32 = n) invariant i > 0 {\n    if i > 1 {\n      continue(i - 1);\n    } else {\n      break;\n    };\n  };\n  return unit;\n}\n", { syntax: "grammar-v1" }).diagnostics.some((d) => d.severity === "error"));
  check("anchors look like GitHub's", anchor(STOPS[0]) === "1-a-first-phil-component" && anchor(STOPS[1]) === "2-types-say-more-than-how-many-bits-a-value-occupies");
} else console.log("skip the comparison with Phil's tour (no Phil checkout here)");
console.log(fails ? `\n${fails} FAILED` : "\nAll tour checks passed.");
process.exit(fails ? 1 : 0);
