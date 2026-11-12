// A fuzzer for Phil's own compiler (philc, built to WebAssembly by the philc-wasm workflow).
//
//   npm run fuzz -- --seconds 60 --seed 1
//
// It generates programs, runs the real compiler on each, and looks for:
//   crash         the compiler dies with an uncaught error instead of giving a diagnostic
//   hang          no answer within the time limit
//   disagreement  a small program whose result we can work out by hand, where the compiler's
//                 answer (accept or refuse, and the value returned) differs from ours
//   inconsistent  the same input giving different answers for two targets, or on a second run
//   slow          time that grows much faster than the input
//
// Findings are shrunk to a small input and written to fuzz/findings/, which is not committed:
// Phil's SECURITY.md asks for possible acceptance problems to be reported privately. Only counts
// go into fuzz/data.json. Runs are reproducible from the seed.
import * as fs from "fs";
import * as crypto from "crypto";
import { Compiler, Outcome } from "./pool";
import { irResult } from "./ir";
import { buildProgram, readEarlierSyntax } from "../core/src/sim/earlier";
import { run as simulate } from "../core/src/sim/interp";

const arg = (name: string, dflt: string) => { const i = process.argv.indexOf("--" + name); return i > 0 ? process.argv[i + 1] : dflt; };
const SECONDS = +arg("seconds", "60"), SEED = +arg("seed", "1") >>> 0, WASM = arg("wasm", "docs/playground/philc.wasm"), LIMIT = +arg("limit-ms", "10000");
const X86 = "x86_64-unknown-linux-gnu", ARM = "aarch64-apple-darwin";
if (!fs.existsSync(WASM)) { console.error(`No compiler build at ${WASM}. The philc-wasm workflow produces it.`); process.exit(2); }

// ---------------------------------------------------------------- random
let state = SEED || 1;
const rnd = () => { state |= 0; state = (state + 0x6d2b79f5) | 0; let t = Math.imul(state ^ (state >>> 15), 1 | state); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (n: number) => Math.floor(rnd() * n);
const pick = <T,>(xs: readonly T[]): T => xs[int(xs.length)];
const chance = (p: number) => rnd() < p;
const enc = (s: string) => new TextEncoder().encode(s);

// ---------------------------------------------------------------- reading the compiler's answer
const CRASH = /^philc: |HasCallStack|CallStack \(from|Non-exhaustive|stack overflow|heap overflow|internal error|<<loop>>|RuntimeError|unreachable|out of memory/im;
// ---------------------------------------------------------------- generators
const NAMES = ["a", "b", "x", "y", "n", "total", "answer", "value", "left", "right", "k", "acc", "tmp", "v1", "v2", "é", "_u", "a_b", "x9", "longer_name_here"];
const WS = [" ", "  ", "\t", "    "];
const U32_MAX = 4294967295n;
const LITERALS = () => pick([0n, 1n, 2n, 7n, 42n, 255n, 256n, 65535n, 65536n, 2147483647n, 2147483648n, U32_MAX, BigInt(int(1000)), BigInt(int(2 ** 31)) * 2n + BigInt(int(2))]);

interface Case { src: Uint8Array; text?: string; gen: string; expect?: { accept: true; value: bigint | "unit" } | { accept: false; why: string } }

/** Small programs inside the part of Phil the compiler handles, with the answer worked out as we build them. */
function genScalar(): Case {
  const nl = chance(0.1) ? "\r\n" : "\n", ind = pick(WS);
  const oneLine = chance(0.06);                          // Phase 0 statements need no line break
  if (chance(0.08)) {
    const good = chance(0.7);
    const text = `component main provides Unit {${nl}${ind}${good ? "return unit" : pick(["return 0", "let a = 1" + nl + ind + "return unit", "return a"])}${nl}}${nl}`;
    return { src: enc(text), text, gen: "scalar", expect: good ? { accept: true, value: "unit" } : { accept: false, why: "Unit main must be exactly `return unit`" } };
  }
  const env = new Map<string, bigint>(), lines: string[] = [];
  let bad: string | undefined;
  const lets = chance(0.15) ? 0 : 1 + int(chance(0.1) ? 60 : 8);
  for (let i = 0; i < lets; i++) {
    let name = chance(0.85) ? pick(NAMES) + (chance(0.5) ? String(int(50)) : "") : "q" + i;
    if (env.has(name)) { if (chance(0.92)) name = name + "_" + i; else bad ??= "a name is bound twice"; }
    let rhs: string, v: bigint | undefined;
    if (env.size && chance(0.5)) { const from = pick([...env.keys()]); rhs = from; v = env.get(from); }
    else if (chance(0.04)) { rhs = chance(0.5) ? name : "undefined_" + i; bad ??= "a name is used before it is bound"; }
    else { const lit = chance(0.04) ? U32_MAX + 1n + BigInt(int(5)) : LITERALS(); if (lit > U32_MAX) bad ??= "a literal does not fit in U32"; rhs = (chance(0.05) ? "0".repeat(1 + int(4)) : "") + lit.toString(); v = lit; }
    lines.push(`let ${name}${pick(["", " "])}=${pick(["", " "])}${rhs}`);
    if (v !== undefined && !env.has(name)) env.set(name, v);
    if (!oneLine && chance(0.06)) lines.push("// " + pick(["note", "let z = 1", "return 0", "}", ""]));
  }
  let ret: string, value: bigint | undefined;
  if (env.size && chance(0.75)) { ret = pick([...env.keys()]); value = env.get(ret); }
  else if (chance(0.04)) { ret = "nowhere"; bad ??= "the returned name is not bound"; }
  else { const lit = chance(0.04) ? U32_MAX + 1n : LITERALS(); if (lit > U32_MAX) bad ??= "a literal does not fit in U32"; ret = lit.toString(); value = lit; }
  lines.push("return " + ret);
  const sep = oneLine ? " " : nl + ind;
  const text = `${chance(0.1) ? "// generated" + nl : ""}component main provides U32 {${nl}${ind}${lines.join(sep)}${nl}}${chance(0.9) ? nl : ""}`;
  return { src: enc(text), text, gen: "scalar", expect: bad || value === undefined ? { accept: false, why: bad ?? "unknown" } : { accept: true, value } };
}

const TOKENS = ["component", "main", "provides", "U32", "Unit", "U8", "U64", "Bool", "let", "return", "unit", "=", "{", "}", "(", ")", ",", ":", ";", "->", "=>", "|", "+", "-", "*", "/", "<", ">", "==", "true", "false", "0", "1", "42", "4294967295", "4294967296", "protocol", "role", "send", "receive", "end", "select", "offer", "fn", "callable", "record", "mode", "linear", "affine", "borrow", "as", "match", "if", "else", "loop", "break", "continue", "\"s\"", "'c'", "//", "/*", "*/", "\n", "\t", " ", "é", "\u0000", "﻿", "‮", "💥"];
let seeds: string[] = [];
function loadSeeds(): void {
  seeds = ["component main provides U32 {\n    return 42\n}\n", "component main provides Unit {\n    return unit\n}\n", "component main provides U32 {\n    let answer = 42\n    let same = answer\n    return same\n}\n"];
  if (fs.existsSync("philc/expected/index.txt")) {
    // Phil's own files are not kept in this repository; use them when a checkout sits alongside.
    for (const line of fs.readFileSync("philc/expected/index.txt", "utf8").trim().split("\n")) { const f = "../phil/" + line.split(" ")[1]; if (fs.existsSync(f)) seeds.push(fs.readFileSync(f, "utf8")); }
  }
  for (const f of ["otc/otc.phil", "contracts/auction.phil"]) if (fs.existsSync(f)) seeds.push(fs.readFileSync(f, "utf8").slice(0, 4000));
}
/** Damaged versions of real programs. There is no right answer to compare, only "must not crash or hang". */
function genMutated(): Case {
  const base = pick(seeds);
  if (chance(0.15)) {                                        // byte level, including invalid UTF-8
    const b = Array.from(enc(base));
    for (let i = 0, n = 1 + int(6); i < n; i++) { const at = int(b.length + 1); const op = int(4); if (op === 0) b.splice(at, 1 + int(4)); else if (op === 1) b.splice(at, 0, int(256)); else if (op === 2 && b.length) b[at % b.length] = int(256); else b.splice(at, 0, ...b.slice(at, at + int(40))); }
    return { src: Uint8Array.from(b), gen: "mutated" };
  }
  const toks = base.split(/(\s+|[{}()=,:;])/).filter((t) => t !== "");
  for (let i = 0, n = 1 + int(5); i < n; i++) {
    const at = int(toks.length + 1), op = int(6);
    if (op === 0) toks.splice(at, 1 + int(3));
    else if (op === 1) toks.splice(at, 0, pick(TOKENS));
    else if (op === 2) toks.splice(at, 0, ...toks.slice(at, at + 1 + int(8)));
    else if (op === 3 && toks.length > 1) { const j = int(toks.length), k = int(toks.length); [toks[j], toks[k]] = [toks[k], toks[j]]; }
    else if (op === 4) toks.splice(at, 0, pick(TOKENS).repeat(1 + int(2000)));
    else toks.splice(at, 0, String(BigInt(int(2 ** 30)) ** BigInt(1 + int(6))));
  }
  const text = toks.join("");
  return { src: enc(text), text, gen: "mutated" };
}

/** Inputs of a chosen size, to see how the compiler's time grows. */
const SHAPES: Record<string, (n: number) => string> = {
  "nested parentheses": (n) => `component main provides U32 {\n    return ${"(".repeat(n)}1${")".repeat(n)}\n}\n`,
  "chain of bindings": (n) => `component main provides U32 {\n${Array.from({ length: n }, (_, i) => `    let v${i} = ${i ? "v" + (i - 1) : 1}`).join("\n")}\n    return v${n - 1}\n}\n`,
  "independent bindings": (n) => `component main provides U32 {\n${Array.from({ length: n }, (_, i) => `    let v${i} = ${i}`).join("\n")}\n    return v0\n}\n`,
  "one long name": (n) => `component main provides U32 {\n    let ${"a".repeat(n)} = 1\n    return ${"a".repeat(n)}\n}\n`,
  "one long literal": (n) => `component main provides U32 {\n    return ${"0".repeat(n)}7\n}\n`,
  "open braces": (n) => `component main provides U32 ${"{".repeat(n)}`,
  "long comment": (n) => `// ${"x".repeat(n)}\ncomponent main provides U32 {\n    return 1\n}\n`,
  "blank lines": (n) => `component main provides U32 {\n${"\n".repeat(n)}    return 1\n}\n`,
};

// ---------------------------------------------------------------- findings
type Kind = "crash" | "hang" | "disagreement" | "inconsistent" | "slow";
interface Finding { kind: Kind; signature: string; detail: string; input: Uint8Array; gen: string }
const findings = new Map<string, Finding>();
const norm = (s: string) => s.replace(/\d+/g, "N").replace(/"[^"]{0,200}"/g, '"…"').replace(/\s+/g, " ").slice(0, 90);
function report(kind: Kind, what: string, detail: string, input: Uint8Array, gen: string): boolean {
  const signature = `${kind}: ${norm(what)}`;
  const had = findings.get(signature);
  if (had && had.input.length <= input.length) return false;
  findings.set(signature, { kind, signature, detail, input, gen });
  return !had;
}
const crashOf = (o: Outcome): string | undefined =>
  o.hung ? undefined
  : o.exit !== 0 && o.exit !== 1 ? `exit status ${o.exit}: ${o.stderr.split("\n")[0]}`
  : CRASH.test(o.stderr) ? o.stderr.split("\n").find((l) => CRASH.test(l)) ?? o.stderr.split("\n")[0]
  : o.exit === 1 && !o.stderr.trim() ? "refused with no message"
  : o.exit === 0 && !o.stdout.trim() ? "accepted with no output"
  : undefined;

async function main(): Promise<void> {
  loadSeeds();
  const cc = new Compiler(WASM, LIMIT);
  const t0 = Date.now(), until = t0 + SECONDS * 1000;
  const tried = { scalar: 0, mutated: 0, stress: 0 };
  let accepted = 0, refused = 0, compared = 0, simCompared = 0;
  const refusals = new Set<string>();

  // Returns the name of the problem this input shows, if any. Used for both searching and shrinking.
  async function check(c: Case, deep: boolean, counting = true): Promise<{ kind: Kind; what: string; detail: string } | undefined> {
    const o = await cc.run(c.src, X86);
    if (o.hung) return { kind: "hang", what: `no answer in ${LIMIT} ms (${c.gen})`, detail: `No answer within ${LIMIT} ms.` };
    const crash = crashOf(o);
    if (crash) return { kind: "crash", what: crash, detail: o.stderr.slice(0, 2000) };
    const got = o.exit === 0 ? irResult(o.stdout) : undefined;
    if (c.expect) {
      if (counting) compared++;
      if (c.expect.accept && o.exit !== 0) return { kind: "disagreement", what: "refused a program we expected to compile: " + o.stderr.split("\n")[0], detail: `We expected ${c.expect.value}. philc said:\n${o.stderr.slice(0, 1500)}` };
      if (!c.expect.accept && o.exit === 0) return { kind: "disagreement", what: "accepted a program we expected to be refused: " + c.expect.why, detail: `We expected a refusal because ${c.expect.why}. philc compiled it.` };
      if (c.expect.accept && o.exit === 0) {
        if (!got) return { kind: "disagreement", what: "emitted LLVM we could not evaluate", detail: o.stdout.slice(0, 1500) };
        const same = c.expect.value === "unit" ? "unit" in got : "value" in got && got.value === c.expect.value;
        if (!same) return { kind: "disagreement", what: "compiled to a different value than the program computes", detail: `We expected ${c.expect.value}; the LLVM returns ${"unit" in got ? "unit" : got.value}.` };
        // Third opinion: our own simulator.
        if (c.text && readEarlierSyntax(c.text) !== undefined) {
          try {
            const r = simulate(buildProgram(c.text), {});
            const ret = r.trace.find((t) => t.kind === "return");
            if (r.ok && ret && ret.kind === "return") { if (counting) simCompared++; if (ret.text !== String(c.expect.value)) return { kind: "disagreement", what: "our simulator returns a different value from philc", detail: `philc and the generator say ${c.expect.value}; our simulator says ${ret.text}. This one is probably our bug.` }; }
          } catch { /* the simulator does not read this one */ }
        }
      }
    }
    if (deep) {
      const again = await cc.run(c.src, X86);
      if (again.exit !== o.exit || again.stdout !== o.stdout) return { kind: "inconsistent", what: "two runs on the same input differ", detail: `First exit ${o.exit}, second exit ${again.exit}.` };
      const arm = await cc.run(c.src, ARM);
      if (!arm.hung && arm.exit !== o.exit) return { kind: "inconsistent", what: "accepted for one target and refused for another", detail: `${X86}: exit ${o.exit}. ${ARM}: exit ${arm.exit}.\n${(arm.stderr || o.stderr).slice(0, 800)}` };
      const a = arm.exit === 0 ? irResult(arm.stdout) : undefined;
      if (got && a && JSON.stringify(got, (_, v) => (typeof v === "bigint" ? v.toString() : v)) !== JSON.stringify(a, (_, v) => (typeof v === "bigint" ? v.toString() : v))) return { kind: "inconsistent", what: "the two targets return different values", detail: "" };
    }
    if (counting) { if (o.exit === 0) accepted++; else { refused++; refusals.add(norm(o.stderr.split("\n")[0])); } }
    return undefined;
  }

  // Remove lines, then smaller and smaller chunks, for as long as the same problem remains.
  async function shrink(c: Case, want: string, budget: number): Promise<Uint8Array> {
    let best = c.src;
    const still = async (b: Uint8Array) => { if (budget-- <= 0) return false; const text = c.text !== undefined ? new TextDecoder().decode(b) : undefined; const r = await check({ src: b, text, gen: c.gen }, false, false); return !!r && `${r.kind}: ${norm(r.what)}` === want; };
    for (let size = Math.ceil(best.length / 2); size >= 1 && budget > 0; size = Math.floor(size / 2)) {
      for (let at = 0; at < best.length && budget > 0;) {
        const cand = new Uint8Array(best.length - Math.min(size, best.length - at));
        cand.set(best.subarray(0, at)); cand.set(best.subarray(at + size), at);
        if (cand.length < best.length && await still(cand)) best = cand; else at += size;
      }
    }
    return best;
  }

  // 1. How time grows with input size, for a fixed set of shapes.
  const scaling: { shape: string; n: number; ms: number; factor: number }[] = [];
  for (const [shape, make] of Object.entries(SHAPES)) {
    let prev = 0, worst = { n: 0, ms: 0, factor: 0 };
    for (const n of [1000, 2000, 4000, 8000, 16000, 32000]) {
      const src = enc(make(n));
      const o = await cc.run(src, X86); tried.stress++;
      if (o.hung) { report("hang", `no answer for ${shape}`, `${shape}, size ${n}: no answer within ${LIMIT} ms.`, enc(make(Math.min(n, 2000))), "stress"); break; }
      const crash = crashOf(o);
      if (crash) { report("crash", crash, `${shape}, size ${n}.\n${o.stderr.slice(0, 1500)}`, enc(make(Math.min(n, 64))), "stress"); break; }
      const factor = prev > 20 ? o.ms / prev : 0;
      if (factor > worst.factor) worst = { n, ms: o.ms, factor };
      prev = o.ms;
      if (o.ms > LIMIT / 2) break;
    }
    scaling.push({ shape, ...worst });
    // Doubling the input and getting about four times the work means quadratic growth.
    if (worst.factor >= 2.8 && worst.ms >= 400) report("slow", `time grows much faster than input for ${shape}`, `${shape}: doubling the size to ${worst.n} multiplied the time by ${worst.factor.toFixed(1)} (${worst.ms} ms).`, enc(make(64)), "stress");
  }

  // 2. Random search until the time is up.
  let n = 0;
  while (Date.now() < until) {
    const c = n % 5 < 3 ? genScalar() : genMutated();
    tried[c.gen as "scalar" | "mutated"]++; n++;
    const r = await check(c, n % 25 === 0);
    if (!r) continue;
    const sig = `${r.kind}: ${norm(r.what)}`;
    const known = findings.get(sig);
    if (known && known.input.length <= 80) continue;                      // already have a small example
    const small = await shrink(c, sig, 250);
    if (report(r.kind, r.what, r.detail, small, c.gen)) console.log(`  found ${sig}`);
  }
  await cc.close();

  // ---------------------------------------------------------------- output
  const build = fs.existsSync("philc/build.json") ? JSON.parse(fs.readFileSync("philc/build.json", "utf8")) : { commit: "unknown", date: "" };
  fs.rmSync("fuzz/findings", { recursive: true, force: true });
  fs.mkdirSync("fuzz/findings", { recursive: true });
  const list = [...findings.values()].sort((a, b) => a.signature.localeCompare(b.signature));
  for (const f of list) {
    const id = crypto.createHash("sha256").update(f.signature).digest("hex").slice(0, 10);
    fs.writeFileSync(`fuzz/findings/${f.kind}-${id}.phil`, f.input);
    fs.writeFileSync(`fuzz/findings/${f.kind}-${id}.txt`, `${f.signature}\n\nFound by: ${f.gen} generator, seed ${SEED}\nPhil commit: ${build.commit}\nInput: ${f.kind}-${id}.phil (${f.input.length} bytes)\nReproduce: philc emit-llvm --target ${X86} ${f.kind}-${id}.phil\n\n${f.detail}\n`);
  }
  const count = (k: Kind) => list.filter((f) => f.kind === k).length;
  const total = tried.scalar + tried.mutated + tried.stress;
  const show = (b: Uint8Array) => { const t = new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(0, 600)); return /^[\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]*$/.test(t) && !t.includes("\ufffd") ? t : "bytes (hex): " + Buffer.from(b.subarray(0, 200)).toString("hex"); };
  // A private write-up, ready to send. Not committed.
  fs.writeFileSync("fuzz/findings/REPORT.md",
    `# Fuzzing philc: findings\n\nPhil commit ${build.commit}. ${total} inputs in ${Math.round((Date.now() - t0) / 1000)} s, seed ${SEED}. philc was built unmodified to WebAssembly (GHC ${build.ghc ?? "?"}) and run with \`emit-llvm --target ${X86}\`.\n\nEverything here was observed in the WebAssembly build. Timings are slower than a native build would be, and behaviour that depends on the platform (text decoding, for one) should be confirmed natively before treating it as a bug.\n\n`
    + `${compared} generated programs had an answer we could work out by hand; philc agreed on every one except where listed below. ${simCompared} of those were also run in our simulator.\n\n`
    + (list.length ? list.map((f, i) => `## ${i + 1}. ${f.signature}\n\n${f.detail.trim()}\n\nSmallest input found (${f.input.length} bytes):\n\n\`\`\`\n${show(f.input)}\n\`\`\`\n`).join("\n") : "No findings.\n")
    + `\n## How time grew with input size\n\n| Shape | Size | Time | Time multiplied when size doubled |\n| --- | --- | --- | --- |\n${scaling.map((x) => `| ${x.shape} | ${x.n || "n/a"} | ${x.ms ? x.ms + " ms" : "under 20 ms"} | ${x.factor ? x.factor.toFixed(1) : "n/a"} |`).join("\n")}\n`);
  const data = {
    phil: { commit: String(build.commit).slice(0, 10), date: build.date }, seed: SEED, seconds: Math.round((Date.now() - t0) / 1000),
    tried: { ...tried, total }, accepted, refused, refusalKinds: refusals.size, compared, simCompared,
    findings: { crash: count("crash"), hang: count("hang"), disagreement: count("disagreement"), inconsistent: count("inconsistent"), slow: count("slow") },
  };
  fs.writeFileSync("fuzz/data.json", JSON.stringify(data, null, 1) + "\n");
  // One row per run, so the page can show the running total.
  const histFile = "fuzz/history.json";
  const history: { day: string; commit: string; seed: number; total: number; compared: number; findings: number }[] = fs.existsSync(histFile) ? JSON.parse(fs.readFileSync(histFile, "utf8")) : [];
  if (process.argv.includes("--record")) {
    history.push({ day: new Date().toISOString().slice(0, 10), commit: data.phil.commit, seed: SEED, total, compared, findings: list.length });
    fs.writeFileSync(histFile, JSON.stringify(history.slice(-400), null, 1) + "\n");
  }
  console.log(`Phil ${data.phil.commit}, seed ${SEED}: ${total} inputs in ${data.seconds}s (${Math.round(total / Math.max(1, data.seconds))}/s)`);
  console.log(`  ${accepted} accepted, ${refused} refused in ${refusals.size} distinct ways; ${compared} checked against a known answer, ${simCompared} also against our simulator`);
  console.log(`  findings: ${Object.entries(data.findings).map(([k, v]) => `${k} ${v}`).join(", ")}  (details in fuzz/findings/, not committed)`);
}
void main();
