// Test suite. Run with: npm test -- /path/to/phil/checkout
import * as fs from "fs";
import * as path from "path";
import { parse } from "../src/parser";
import { formatText } from "../src/format";
import { CODE_MAP } from "../src/codes";
import { loadGrammar, tokenize } from "./tm";

const root = process.argv[2] ?? process.env.PHIL_REPO;
if (!root) { console.error("usage: node out/test.js PHIL_REPO"); process.exit(2); }

let failures = 0, passes = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) passes++;
  else { failures++; console.log(`FAIL ${name}${detail ? ": " + detail : ""}`); }
}

const files: string[] = [];
const walk = (d: string) => {
  for (const f of fs.readdirSync(d)) {
    if (f === ".git" || f === "dist-newstyle") continue;
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.endsWith(".phil")) files.push(p);
  }
};
walk(root);
const rel = (f: string) => path.relative(root, f);
const errorsOf = (src: string) => parse(src).diagnostics.filter((d) => d.severity === "error");

(async () => {
  // ---------------------------------------------------------------- 1. corpus
  const expectedRejectCodes: Record<string, string> = {
    "06-outcome-state-missing-semicolon.phil": "PHIL-P007",
    "12-binding-local-mode.phil": "PHIL-P005",
    "21-static-argument-unclosed.phil": "PHIL-P002",
    "22-generic-requirement-missing-semicolon.phil": "PHIL-P007",
    "26-invalid-string-escape.phil": "PHIL-L002",
    "27-unsafe-block.phil": "PHIL-P006", "28-unchecked-block.phil": "PHIL-P006", "29-spawn-block.phil": "PHIL-P006",
    "30-await-block.phil": "PHIL-P006", "31-assignment.phil": "PHIL-P008", "32-try-catch.phil": "PHIL-P006",
    "33-atomic-block.phil": "PHIL-P006", "34-malloc-placement.phil": "PHIL-P006", "35-macro-declaration.phil": "PHIL-P006",
    "36-reflection.phil": "PHIL-P006",
  };
  const counts = { v1Accepted: 0, v1Rejected: 0, legacy: 0, semanticFixtures: 0 };
  const allCodes = new Set<string>();
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const r = parse(src);
    r.diagnostics.forEach((d) => allCodes.add(d.code));
    const errs = r.diagnostics.filter((d) => d.severity === "error");
    const name = path.basename(f);
    const rp = rel(f);
    if (rp.startsWith("examples/")) {
      counts.legacy++;
      check(`legacy detected ${rp}`, r.legacy);
      check(`legacy clean ${rp}`, errs.length === 0, errs[0]?.message);
    } else if (rp.includes("phase1-surface/rejected")) {
      counts.v1Rejected++;
      check(`rejects ${rp}`, errs.length > 0);
      if (expectedRejectCodes[name]) check(`code for ${name}`, errs[0]?.code === expectedRejectCodes[name], errs[0]?.code);
    } else if (rp.endsWith("fsem02-source-offer-v1/duplicate-arm.phil")) {
      check("duplicate arm flagged", errs.some((d) => d.code === "PHIL-S002"));
    } else {
      if (rp.includes("phase1-surface/accepted")) counts.v1Accepted++; else counts.semanticFixtures++;
      check(`accepts ${rp}`, errs.length === 0 && !r.legacy, errs[0] ? `${errs[0].code} ${errs[0].message}` : "legacy");
    }
  }
  check("corpus sizes", counts.v1Accepted >= 28 && counts.v1Rejected >= 36 && counts.legacy >= 1, JSON.stringify(counts));
  for (const c of allCodes) check(`code ${c} documented`, CODE_MAP.has(c));

  // ---------------------------------------------------------------- 2. targeted cases
  const cases: [string, string, string | null][] = [
    ["missing semicolon in v1 file", "component A provides Unit {\n  let x = 1;\n  return unit\n}", "PHIL-P007"],
    ["typo keyword", "compnent A { return unit; }", "PHIL-P001"],
    ["reserved word as name", "fn end() satisfies U8 { return 1; }", "PHIL-P005"],
    ["unterminated string", 'component A { let s = "abc;\n}', "PHIL-L001"],
    ["empty char", "component A { let c = ''; }", "PHIL-L004"],
    ["two-scalar char", "component A { let c = 'ab'; }", "PHIL-L004"],
    ["surrogate escape", "component A { let c = '\\u{D800}'; }", "PHIL-L003"],
    ["valid escape", "component A { let c = '\\u{1F600}'; let s = \"a\\tb\\n\"; }", null],
    ["prime identifiers", "component A(x : U8) { let x' = x; let x'' = x'; return x''; }", null],
    ["hex literal", "component A { let x = 0xFF; }", "PHIL-L006"],
    ["bang", "claim C(x : Bool) = !x;", "PHIL-L005"],
    ["unmatched closer", "component A { return unit; } }", "PHIL-P003"],
    ["unclosed brace", "component A {\n  return unit;\n", "PHIL-P002"],
    ["eof mid-decl", "record R { a : U8", "PHIL-P002"],
    ["duplicate variant", "data D = A | B | A;", "PHIL-S002"],
    ["duplicate param", "component A(x : U8, x : U8) { return unit; }", "PHIL-S002"],
    ["duplicate protocol branch", "protocol P { role C = select { A => end D | A => end D }; role S = offer { A => end D }; }", "PHIL-S002"],
    ["import after decl", "component A { return unit; }\nimport x.y;", "PHIL-P001"],
    ["float literal", "component A { let f = 1.5; return f; }", null],
    ["signed and float types", "fn f(a : I32, b : F64) -> I64 satisfies C { return convert a to I64; }", null],
    ["unary minus", "component A { let x = -1 * -(2 + 3) << 1; }", null],
    ["refinement in param", "callable K(x : {v : U32 | v > 0 and not (v == 3)}) -> U32 { ensures x > 0; }", null],
    ["claim app vs relation", "claim C(x : U32) = Good(x) or (x > 1 and Good[T](x));", null],
    ["provider impl", "provider implementation P satisfies Q { operation op satisfies R { return unit; } law l = true; }", null],
    ["opaque provider", "opaque provider implementation P[T : Type] satisfies Q[T];", null],
    ["attributes", "@doc(\"hello\")\ncomponent A { return unit; }", null],
    ["match with statement arm", "component A(x : D) { match x { Some(v) => return v; None => { return unit; } }; }", null],
    ["or fail / or reject", "component A(s : S) { let p = receive_frame(s) or fail TransportFailure; let q = recognize H from p or reject bad; }", null],
    ["record pattern", "component A(r : R) { let R { a, b = (c, d) } = r; return a; }", null],
    ["loop with break", "component A { loop state (i : U32 = 0) invariant i >= 0 { break (i); }; }", null],
    ["if join", "component A(b : Bool) { if b join state (x : Bool) invariant true { return unit; } else { return unit; }; }", null],
    ["generic requirement soup", "record R[T : Type, N : Nat, E : Effects] requires { structural T : Copy; effects E within { Read }; } { v : T }", null],
    ["validated type", "type V = Validated[Policy, ctx, value];", null],
    ["program block", "program main = instantiate A { entry n : U32; observable a.b; };", null],
    ["empty file", "", null],
    ["comment-only file", "// nothing here\n", null],
    ["module and imports", "module a.b;\nimport c.d;\nimport e.f { G, H };\ncomponent A { return unit; }", null],
  ];
  for (const [name, src, code] of cases) {
    const errs = errorsOf(src);
    if (code === null) check(`case: ${name}`, errs.length === 0, errs.map((e) => `${e.code} ${e.message}`).join(" | "));
    else check(`case: ${name}`, errs.some((e) => e.code === code), errs.map((e) => e.code).join(",") || "no errors");
  }

  const multi = errorsOf("component A(x : U8) {\n  let y = x;\n  retrun y;\n  let z = y\n}\nfn ok() satisfies U8 { return 1; }");
  check("statement recovery reports each broken statement", multi.length === 2 && multi[0].code === "PHIL-P001" && multi[1].code === "PHIL-P007", multi.map((e) => e.code + " " + e.message).join(" | "));

  // Ambiguous no-semicolon file: legacy in auto mode, error in grammar-v1 mode.
  const tiny = "component A provides Unit {\n  return unit\n}";
  const autoR = parse(tiny);
  check("auto: tiny no-semicolon file is legacy", autoR.legacy && autoR.diagnostics.some((d) => d.code === "PHIL-I001" && d.message.includes("line 2")));
  check("grammar-v1 mode: missing semicolon", parse(tiny, { syntax: "grammar-v1" }).diagnostics.some((d) => d.code === "PHIL-P007"));
  check("legacy mode forced", parse("component A { return unit; }", { syntax: "legacy" }).legacy);

  // ---------------------------------------------------------------- 3. quick fixes repair the file
  const fixCases = [
    "component A provides Unit {\n  let x = 1\n  return unit;\n}",
    "compnent A { return unit; }",
    "component A(x : U8) { x = 1; }",
    "component A { let x = 0x10; return x; }",
    "claim C(x : U32) = !(x > 1);",
    "claim C(x : U32) = x > 1 && x < 5;",
  ];
  for (const src of fixCases) {
    let text = src;
    for (let round = 0; round < 5; round++) {
      const d = parse(text).diagnostics.find((x) => x.fix);
      if (!d || !d.fix) break;
      text = text.slice(0, d.fix.start) + d.fix.newText + text.slice(d.fix.end);
    }
    const errs = errorsOf(text);
    check(`fixes repair: ${JSON.stringify(src)}`, errs.length === 0, `${JSON.stringify(text)} → ${errs.map((e) => e.message).join(" | ")}`);
  }

  // ---------------------------------------------------------------- 4. snippets expand to valid source
  const snippets = JSON.parse(fs.readFileSync(path.join(__dirname, "../snippets/phil.json"), "utf8")) as Record<string, { body: string[] }>;
  const expand = (body: string) => body
    .replace(/\$\{\d+\|([^,|}]+)[^}]*\|\}/g, "$1")
    .replace(/\$\{\d+:((?:[^{}]|\{[^{}]*\})*)\}/g, "$1")
    .replace(/\$\{\d+\}/g, "")
    .replace(/\$\d+/g, "")
    .replace(/\\\}/g, "}")
    .replace(/\t/g, "  ");
  const statementPrefixes = new Set(["let", "if", "match", "decide", "offer", "select", "send", "receive", "loop", "borrow", "construct", "closure", "prove", "convert"]);
  for (const [name, snip] of Object.entries(snippets)) {
    let code = expand(snip.body.join("\n"));
    const prefix = (snip as unknown as { prefix: string }).prefix;
    if (prefix === "refine") code = `type T = ${code};`;
    else if (prefix === "outcome") code = `callable C(x : U8) -> U8 {\n${code}\n}`;
    else if (statementPrefixes.has(prefix)) {
      const stmt = /;\s*$/.test(code) ? code : `let tmp = ${code};`;
      code = `component Host(endpoint : E, value : V, call : C) {\n${stmt.replace(/\{ \}/g, "{ return unit; }")}\n}`;
    }
    if (prefix === "provider-impl" || prefix === "fn" || prefix === "component") code = code.replace(/\{\n\s*\n/g, "{\n  return unit;\n");
    const errs = errorsOf(code);
    check(`snippet ${name}`, errs.length === 0, `${errs.map((e) => e.message).join(" | ")}\n${code}`);
  }

  // ---------------------------------------------------------------- 5. TextMate grammar
  const grammar = await loadGrammar();
  for (const f of files) {
    if (rel(f).includes("rejected")) continue;
    const bad = tokenize(grammar, fs.readFileSync(f, "utf8")).filter((t) => t.scopes.some((s) => s.startsWith("invalid")));
    check(`no invalid tokens ${rel(f)}`, bad.length === 0, bad.map((b) => `${b.line}:${b.text}`).join(" "));
  }
  const scopeOf = (src: string, text: string) => tokenize(grammar, src).find((t) => t.text === text)?.scopes.slice(-1)[0] ?? "";
  const sample = "module a.b;\ncomponent Worker(x' : U8) provides Unit {\n  let y = convert x' to U16; // note\n  match y { Some(v) => return v; }\n  return unit;\n}";
  check("tm: component name", scopeOf(sample, "Worker") === "entity.name.function.phil", scopeOf(sample, "Worker"));
  check("tm: primed identifier not a char", scopeOf(sample, "x'").startsWith("variable"), scopeOf(sample, "x'"));
  check("tm: U8 primitive", scopeOf(sample, "U8") === "support.type.primitive.phil");
  check("tm: convert keyword", scopeOf(sample, "convert") === "keyword.other.term.phil");
  check("tm: arm label", scopeOf(sample, "Some") === "entity.name.label.phil", scopeOf(sample, "Some"));
  check("tm: comment", scopeOf(sample, "// note").startsWith("comment") || scopeOf(sample, " note").startsWith("comment"));
  check("tm: unit constant", scopeOf(sample, "unit") === "constant.language.phil");
  check("tm: module name", scopeOf(sample, "a.b") === "entity.name.namespace.phil", scopeOf(sample, "a.b"));

  // ---------------------------------------------------------------- 6. formatter
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    const out = formatText(src, { tabSize: 2, insertSpaces: true });
    check(`format idempotent ${rel(f)}`, formatText(out, { tabSize: 2, insertSpaces: true }) === out);
    const a = parse(src).lex.tokens.map((t) => t.text).join("\u0000");
    const b = parse(out).lex.tokens.map((t) => t.text).join("\u0000");
    check(`format preserves tokens ${rel(f)}`, a === b);
  }
  const messy = "component A {\nlet x = 1;\n        match x {\nSome(v) =>\nreturn v;\n}; \n}\n";
  check("format messy", formatText(messy, { tabSize: 2, insertSpaces: true }) ===
    "component A {\n  let x = 1;\n  match x {\n    Some(v) =>\n      return v;\n  };\n}\n", JSON.stringify(formatText(messy, { tabSize: 2, insertSpaces: true })));

  // ---------------------------------------------------------------- 7. performance
  const deep = "(".repeat(200) + "x" + ")".repeat(200);
  let t0 = Date.now();
  parse(`claim C(x : U32) = ${deep} > 0;\ncomponent A { let a = ${deep}; return a; }`);
  check("deep nesting under 500ms", Date.now() - t0 < 500, `${Date.now() - t0}ms`);
  const accepted = files.filter((f) => !rel(f).includes("rejected") && !rel(f).startsWith("examples/")).map((f) => fs.readFileSync(f, "utf8"));
  const big = Array.from({ length: 10 }, () => accepted.join("\n")).join("\n");
  t0 = Date.now();
  parse(big);
  const ms = Date.now() - t0;
  check("large file throughput", ms < 4000, `${(big.length / 1024).toFixed(0)} KiB in ${ms}ms`);
  console.log(`  perf: ${(big.length / 1024).toFixed(0)} KiB (${big.split("\n").length} lines) parsed in ${ms} ms`);

  // ---------------------------------------------------------------- 8. mutation fuzz (robustness)
  let seed = 12345;
  const rand = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const alphabet = ["{", "}", "(", ")", "[", "]", ";", ",", "=>", "->", "=", "|", ":", ".", "'", '"', "\\", "@", "let ", "match ", "or ", "not ", "0", "x", "\n", "U8", "send ", "{ x : ", "//"];
  let worst = 0, crashes = 0;
  const N = 3000;
  for (let i = 0; i < N; i++) {
    const base = accepted[rand(accepted.length)];
    let s = base;
    const edits = 1 + rand(4);
    for (let e = 0; e < edits; e++) {
      const at = rand(s.length + 1);
      const op = rand(3);
      if (op === 0) s = s.slice(0, at) + s.slice(at + 1 + rand(8));
      else if (op === 1) s = s.slice(0, at) + alphabet[rand(alphabet.length)] + s.slice(at);
      else s = s.slice(0, at);
    }
    const t = Date.now();
    try {
      const r = parse(s);
      formatText(s, { tabSize: 2, insertSpaces: true });
      for (const d of r.diagnostics) if (d.start < 0 || d.end > s.length + 1 || d.end < d.start) throw new Error("bad range " + JSON.stringify(d));
    } catch (err) {
      crashes++;
      if (crashes <= 3) console.log("CRASH on input:", JSON.stringify(s.slice(0, 300)), err);
    }
    worst = Math.max(worst, Date.now() - t);
  }
  check("fuzz: no crashes", crashes === 0, `${crashes} crashes`);
  check("fuzz: worst case under 1s", worst < 1000, `${worst}ms`);
  console.log(`  fuzz: ${N} mutated files, ${crashes} crashes, worst ${worst} ms`);

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})();
