// Mutation analysis of the LLVM that Phil's backend emits for its upload client and server.
//
// Each mutant is the module with one small change: a branch swapped, a check inverted, a call
// dropped or redirected, an argument or constant changed. A mutant is "killed" by a test suite
// if that suite fails on it. Mutants that no suite kills mark behaviour nothing checks.
//
// Two independent suites are run against every mutant:
//   Phil's own integrated native upload test (runtime/phase0/integrated_upload_v1_main.c with
//   Phil's reference runtime), and this repository's native tests of the same module on our
//   Solana runtime (test/giveaway.ts and test/burn.ts), which only exercise UploadServer.
//
// Usage: node out/mutate.js <phil repo> [--limit N]
import { execFileSync, execSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const PHIL = process.argv[2];
const LIMIT = Number(process.argv[process.argv.indexOf("--limit") + 1]) || Infinity;
const MODULE = "giveaway/phil-llvm/phil-llvm-phase0-control-codec.ll";
const CLANG = execSync("command -v clang-18 || command -v clang").toString().trim();
const AS = execSync("command -v llvm-as-18 || command -v llvm-as").toString().trim();
const lines = fs.readFileSync(MODULE, "utf8").split("\n");

interface Mutant { id: number; op: string; fn: string; block: string; line: number; before: string; after: string | null; text: string }
const declared = new Map<string, string>();          // function name -> "ret(args)" signature
for (const l of lines) { const m = /^declare (.+?) @(\w+)\((.*)\)/.exec(l); if (m) declared.set(m[2], `${m[1]}(${m[3]})`); }
const bySignature = new Map<string, string[]>();
for (const [name, sig] of declared) bySignature.set(sig, [...(bySignature.get(sig) ?? []), name]);

const mutants: Mutant[] = [];
let fn = "", block = "";
const slots = new Map<string, Map<string, string[]>>();   // fn -> type -> alloca names
lines.forEach((l) => { const d = /^define .* @(\w+)\(/.exec(l); if (d) fn = d[1]; const a = /^\s+(%\S+) = alloca (\S+)/.exec(l); if (a && fn) { const t = slots.get(fn) ?? new Map(); t.set(a[2], [...(t.get(a[2]) ?? []), a[1]]); slots.set(fn, t); } if (/^}/.test(l)) fn = ""; });
const add = (op: string, at: number, after: string | null) => {
  const copy = lines.slice();
  if (after === null) copy.splice(at, 1); else copy[at] = after;
  mutants.push({ id: mutants.length + 1, op, fn, block, line: at + 1, before: lines[at].trim(), after: after?.trim() ?? null, text: copy.join("\n") });
};
fn = "";
lines.forEach((l, at) => {
  const d = /^define .* @(\w+)\(/.exec(l);
  if (d) { fn = d[1]; block = ""; return; }
  if (/^}/.test(l)) { fn = ""; return; }
  if (!fn) return;
  const b = /^([A-Za-z0-9_.]+):/.exec(l);
  if (b) { block = b[1]; return; }
  let m: RegExpExecArray | null;
  if ((m = /^(\s+br i1 \S+, label )(%\S+)(, label )(%\S+)$/.exec(l))) {
    add("branch: swap the two outcomes", at, `${m[1]}${m[4]}${m[3]}${m[2]}`);
    add("branch: always take the first", at, `  br label ${m[2]}`);
    add("branch: always take the second", at, `  br label ${m[4]}`);
  }
  if ((m = /^(\s+%\S+ = icmp )eq( i8 \S+, )1$/.exec(l))) {
    add("check: == 1 becomes != 1", at, `${m[1]}ne${m[2]}1`);
    add("check: == 1 becomes == 0", at, `${m[1]}eq${m[2]}0`);
    add("check: == 1 becomes == 2", at, `${m[1]}eq${m[2]}2`);
    add("check: == 1 becomes != 0", at, `${m[1]}ne${m[2]}0`);
  }
  if (/^\s+call void @/.test(l)) add("call: drop a call that returns nothing", at, null);
  if (/^\s+store /.test(l)) add("store: drop an initialisation", at, null);
  if ((m = /^(\s+ret i32 )0(.*)$/.exec(l))) add("return: 0 becomes 1", at, `${m[1]}1${m[2]}`);
  if ((m = /^(.*call .*\(.*\bi8 )([01])(\).*)$/.exec(l))) { add("constant: flip a 0/1 argument", at, `${m[1]}${m[2] === "1" ? "0" : "1"}${m[3]}`); add("constant: argument becomes 2", at, `${m[1]}2${m[3]}`); }
  if ((m = /^(.*call \S+ @\w+\()ptr (%\S+), ptr (%\S+)(.*)$/.exec(l)) && m[2] !== m[3]) add("arguments: swap the first two pointers", at, `${m[1]}ptr ${m[3]}, ptr ${m[2]}${m[4]}`);
  if ((m = /^(.*call (.+?) @)(\w+)(\(.*\).*)$/.exec(l)) && declared.has(m[3])) {
    for (const other of bySignature.get(declared.get(m[3])!) ?? []) if (other !== m[3]) add("call: a different runtime function of the same type", at, `${m[1]}${other}${m[4]}`);
  }
  if ((m = /^(\s+%\S+ = load (\S+), ptr )(%\S+)$/.exec(l))) {
    for (const other of slots.get(fn)?.get(m[2]) ?? []) if (other !== m[3]) add("load: read a different slot of the same type", at, `${m[1]}${other}`);
  }
});

// ---- the two suites ----
const W = fs.mkdtempSync(path.join(os.tmpdir(), "phil-mut-"));
const rt = `${PHIL}/runtime/phase0`;
for (const f of ["control_codec_v1", "integrated_upload_v1", "integrated_upload_v1_main"]) execFileSync(CLANG, ["-std=c11", "-O1", `-I${rt}`, "-pthread", "-c", `${rt}/${f}.c`, "-o", `${W}/${f}.o`]);
execSync("npx esbuild test/giveaway.ts --bundle --platform=node --outfile=out/giveaway-test.js --log-level=error && npx esbuild test/burn.ts --bundle --platform=node --outfile=out/burn-test.js --log-level=error");

type Outcome = "killed" | "survived";
function philsTest(ll: string): { outcome: Outcome; how: string } {
  const o = spawnSync(CLANG, ["-O1", "-Wno-override-module", "-c", ll, "-o", `${W}/m.o`]);
  if (o.status !== 0) return { outcome: "killed", how: "does not compile" };
  execFileSync(CLANG, [`${W}/m.o`, `${W}/control_codec_v1.o`, `${W}/integrated_upload_v1.o`, `${W}/integrated_upload_v1_main.o`, "-lcrypto", "-pthread", "-o", `${W}/integrated`]);
  const r = spawnSync("timeout", ["5", `${W}/integrated`], { encoding: "utf8" });
  if (r.status === 0) return { outcome: "survived", how: "" };
  return { outcome: "killed", how: r.status === 124 ? "hangs" : r.signal || (r.status ?? 0) > 128 ? "crashes" : (/FAIL: ([^\n]*)/.exec(r.stderr + r.stdout)?.[1] ?? "fails") };
}
function ourTests(ll: string): { outcome: Outcome; how: string } {
  for (const [name, js] of [["giveaway", "out/giveaway-test.js"], ["burn vault", "out/burn-test.js"]]) {
    const r = spawnSync("timeout", ["60", "node", js], { encoding: "utf8", env: { ...process.env, PHIL_LL: ll, PHIL_REPO: "/nonexistent" } });
    if (r.status !== 0) return { outcome: "killed", how: `${name}: ${/FAIL ([^\n]*)/.exec(r.stdout)?.[1]?.slice(0, 90) ?? (r.status === 124 ? "hangs" : "crashes")}` };
  }
  return { outcome: "survived", how: "" };
}

// The unmutated module must pass both, or nothing below means anything.
fs.writeFileSync(`${W}/base.ll`, lines.join("\n"));
if (philsTest(`${W}/base.ll`).outcome !== "survived" || ourTests(`${W}/base.ll`).outcome !== "survived") { console.error("the unmutated module does not pass both suites"); process.exit(1); }

const results: any[] = [];
let invalid = 0;
for (const m of mutants.slice(0, LIMIT)) {
  const ll = `${W}/mutant.ll`;
  fs.writeFileSync(ll, m.text);
  if (spawnSync(AS, [ll, "-o", "/dev/null"]).status !== 0) { invalid++; continue; }      // not a well-formed module: not a mutant
  const theirs = philsTest(ll);
  const ours = m.fn === "UploadServer" ? ourTests(ll) : { outcome: "survived" as Outcome, how: "not run: our suites do not run the client" };
  results.push({ id: m.id, op: m.op, fn: m.fn, block: m.block, line: m.line, before: m.before, after: m.after, phil: theirs, ours });
  if (results.length % 25 === 0) console.error(`${results.length} mutants run`);
}

const count = (rows: any[]) => ({ mutants: rows.length, philKills: rows.filter((r) => r.phil.outcome === "killed").length, oursKills: rows.filter((r) => r.ours.outcome === "killed").length,
  eitherKills: rows.filter((r) => r.phil.outcome === "killed" || r.ours.outcome === "killed").length, survivors: rows.filter((r) => r.phil.outcome !== "killed" && r.ours.outcome !== "killed").length });
const group = (key: (r: any) => string, rows = results) => [...new Set(rows.map(key))].map((k) => ({ name: k, ...count(rows.filter((r) => key(r) === k)) }));
const server = results.filter((r) => r.fn === "UploadServer"), client = results.filter((r) => r.fn === "UploadClient");
const emitted = JSON.parse(fs.readFileSync("giveaway/emitted.json", "utf8"));
const summary = {
  day: new Date().toISOString().slice(0, 10), philCommit: emitted.commit, philRuntimeCommit: execSync(`git -C ${PHIL} rev-parse HEAD`).toString().trim(), module: path.basename(MODULE),
  generated: mutants.length, malformed: invalid, total: count(results), server: count(server), client: count(client),
  byOperator: group((r) => r.op.split(":")[0]), serverByBlock: group((r) => r.block, server), clientByBlock: group((r) => r.block, client),
};
fs.writeFileSync("mutation/data.json", JSON.stringify(summary, null, 1) + "\n");
fs.writeFileSync("mutation/detail.private.json", JSON.stringify(results, null, 1) + "\n");
console.log(JSON.stringify({ generated: summary.generated, malformed: invalid, total: summary.total, server: summary.server, client: summary.client }, null, 1));
