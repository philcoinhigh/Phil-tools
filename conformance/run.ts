// Runs every .phil file in a checkout of the Phil repository through this project's checker and
// simulator, and records where they agree with the verdict Phil's own tests expect.
//
//   npm run conformance -- ../phil
//
// Writes conformance/data.json (published) and conformance/private-review.md (never published:
// see the note at the bottom of this file).
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { parse } from "../core/src/parser";
import { buildAst } from "../core/src/sim/ast";
import { explore } from "../core/src/sim/explore";

const root = process.argv[2];
if (!root || !fs.existsSync(path.join(root, "grammar"))) { console.error("usage: npm run conformance -- <path to a checkout of abiggerhammer/phil>"); process.exit(2); }
const git = (...args: string[]) => { try { return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim(); } catch { return ""; } };

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules" || e.name === "dist-newstyle") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith(".phil")) out.push(p);
  }
  return out;
}

type Expect = "accept" | "reject" | "none";
function expectation(rel: string): { suite: string; expect: Expect } {
  const parts = rel.split("/"), file = parts[parts.length - 1];
  if (rel.startsWith("test/fixtures/phase1-surface/")) return { suite: "Grammar: " + parts[3], expect: parts[3] === "accepted" ? "accept" : parts[3] === "rejected" ? "reject" : "none" };
  if (rel.startsWith("test/fixtures/")) return { suite: parts[2], expect: /^(accepted|positive)/.test(file) ? "accept" : "reject" };
  if (rel.startsWith("examples/rejected/")) return { suite: "examples/rejected", expect: "reject" };
  if (rel.startsWith("examples/") || rel.startsWith("handoff/")) return { suite: parts.slice(0, -1).join("/"), expect: "accept" };
  return { suite: parts.slice(0, -1).join("/") || ".", expect: "none" };
}

type Ours = "syntax-error" | "run-error" | "clean-run" | "parsed-only";
function check(src: string, syntaxOnly: boolean): { ours: Ours; detail: string } {
  const syn = parse(src, { syntax: "auto" }).diagnostics.filter((d) => d.severity === "error");
  if (syn.length) return { ours: "syntax-error", detail: `${syn[0].code} ${syn[0].message}` };
  // Grammar fixtures only claim that a file parses, so that is all we compare.
  if (syntaxOnly) return { ours: "clean-run", detail: "parses" };
  try {
    const r = explore(buildAst(src), {}, { budgetMs: 300, stepLimit: 3000 });
    if (r.findings.length) return { ours: "run-error", detail: `${r.findings[0].kind}: ${r.findings[0].message}` };
    if (r.mode === "none" || !r.runs) return { ours: "parsed-only", detail: r.unsupported?.[0] ?? "nothing the simulator can run" };
    return { ours: "clean-run", detail: `${r.runs} runs` };
  } catch (e) { return { ours: "parsed-only", detail: "simulator could not load it: " + String((e as Error).message ?? e).slice(0, 120) }; }
}

interface Suite { name: string; expect: Expect; grammar: boolean; files: number; agree: number; parsedOnly: number; missed: number; review: number }
const suites = new Map<string, Suite>();
const missed: { file: string; suite: string }[] = [];
const review: { file: string; ours: Ours; detail: string }[] = [];
const files = walk(root).map((f) => path.relative(root, f).split(path.sep).join("/")).sort();
for (const rel of files) {
  const { suite, expect } = expectation(rel);
  const key = suite + "|" + expect;
  const grammar = suite.startsWith("Grammar: ");
  const s = suites.get(key) ?? { name: suite, expect, grammar, files: 0, agree: 0, parsedOnly: 0, missed: 0, review: 0 };
  suites.set(key, s);
  s.files++;
  const { ours, detail } = check(fs.readFileSync(path.join(root, rel), "utf8"), grammar);
  const rejects = ours === "syntax-error" || ours === "run-error";
  if (expect === "accept") {
    if (rejects) { s.review++; review.push({ file: rel, ours, detail }); }
    else if (ours === "clean-run") s.agree++; else s.parsedOnly++;
  } else if (expect === "reject") {
    if (rejects) s.agree++; else { s.missed++; missed.push({ file: rel, suite }); }
  } else if (ours === "syntax-error") { s.review++; review.push({ file: rel, ours, detail }); } else s.parsedOnly++;
}

const list = [...suites.values()].sort((a, b) => a.name.localeCompare(b.name));
const sum = (pick: (s: Suite) => number, expect: Expect, grammar: boolean) => list.filter((s) => s.expect === expect && s.grammar === grammar).reduce((n, s) => n + pick(s), 0);
const data = {
  phil: { commit: git("rev-parse", "--short=10", "HEAD"), date: git("log", "-1", "--format=%cs"), subject: git("log", "-1", "--format=%s").slice(0, 140) },
  files: files.length,
  grammar: {
    accept: { files: sum((s) => s.files, "accept", true), agree: sum((s) => s.agree, "accept", true) },
    reject: { files: sum((s) => s.files, "reject", true), agree: sum((s) => s.agree, "reject", true) },
  },
  behaviour: {
    accept: { files: sum((s) => s.files, "accept", false), ran: sum((s) => s.agree, "accept", false), parsedOnly: sum((s) => s.parsedOnly, "accept", false), review: sum((s) => s.review, "accept", false) },
    reject: { files: sum((s) => s.files, "reject", false), caught: sum((s) => s.agree, "reject", false), missed: sum((s) => s.missed, "reject", false) },
  },
  // Files under review are left out of the per-suite rows, so the table cannot be used to work out which they are.
  suites: list.map(({ review, ...s }) => ({ ...s, files: s.files - review })).filter((s) => s.files > 0),
  missed,
};
fs.writeFileSync("conformance/data.json", JSON.stringify(data, null, 1) + "\n");
fs.writeFileSync("conformance/private-review.md",
  `# Programs Phil accepts that these tools reject\n\nPhil commit ${data.phil.commit} (${data.phil.date}). Not for publication: see conformance/README.md.\n\n`
  + (review.length ? review.map((r) => `- \`${r.file}\`: ${r.ours}. ${r.detail}`).join("\n") : "None.") + "\n");
console.log(`Phil ${data.phil.commit} (${data.phil.date}): ${files.length} files`);
console.log(`  grammar: ${data.grammar.accept.agree}/${data.grammar.accept.files} accepted files parse, ${data.grammar.reject.agree}/${data.grammar.reject.files} rejected files are flagged`);
console.log(`  behaviour, expected accept: ${data.behaviour.accept.files}  ran clean ${data.behaviour.accept.ran}, parsed only ${data.behaviour.accept.parsedOnly}, we reject ${data.behaviour.accept.review}`);
console.log(`  behaviour, expected reject: ${data.behaviour.reject.files}  caught ${data.behaviour.reject.caught}, not caught ${data.behaviour.reject.missed}`);

// Why the split: a program Phil accepts and we reject is usually our bug, but it can also mean
// Phil accepted something it should not have. Phil's SECURITY.md asks for that kind of report to be
// made privately, so the published data carries only the count and the details stay local.
