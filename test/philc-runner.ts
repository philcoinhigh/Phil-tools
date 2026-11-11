// Tests the browser runner for Phil's compiler against a stand-in WASI program with the same
// command line (out/standin.wasm, built from test/standin/main.go), and against the real
// philc.wasm when a build of it is present.
import * as fs from "fs";
import { runPhilc, readPhilcError, PHILC_SAMPLE } from "../playground/src/philc";

let fails = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) fails++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : "  " + detail}`); };
(async () => {
  if (fs.existsSync("out/standin.wasm")) {
    const m = await WebAssembly.compile(fs.readFileSync("out/standin.wasm"));
    const a = await runPhilc(m, "component main provides U32 { return 42 }\n", "x86_64-unknown-linux-gnu");
    check("stand-in: accepted run returns stdout", a.accepted && a.exit === 0 && a.stdout.includes("; target x86_64-unknown-linux-gnu") && a.stdout.includes("; 42 bytes of source") && a.stderr === "", JSON.stringify(a));
    const b = await runPhilc(m, "reject me\n", "aarch64-apple-darwin");
    check("stand-in: rejection returns stderr and a non-zero exit", !b.accepted && b.exit === 1 && b.stderr === "main.phil:1:1: stand-in rejection" && b.stdout === "", JSON.stringify(b));
    const c = await runPhilc(m, "héllo ✓\n", "x86_64-unknown-linux-gnu");
    check("stand-in: source is passed as UTF-8", c.accepted && c.stdout.includes("; 11 bytes of source"), JSON.stringify(c));
    const d = await runPhilc(m, "x", "x86_64-unknown-linux-gnu");
    check("stand-in: runs are independent", d.accepted && d.stdout.includes("; 1 bytes of source"));
  } else console.log("skip stand-in: out/standin.wasm not built (needs Go)");

  const real = "docs/playground/philc.wasm";
  if (fs.existsSync(real) && fs.existsSync("philc/expected/index.txt")) {
    const m = await WebAssembly.compile(fs.readFileSync(real));
    const phil = process.argv[2];
    for (const line of fs.readFileSync("philc/expected/index.txt", "utf8").trim().split("\n")) {
      const [code, file] = line.split(" ");
      const name = file.replace(/\//g, "_");
      const src = phil && fs.existsSync(`${phil}/${file}`) ? fs.readFileSync(`${phil}/${file}`, "utf8") : undefined;
      if (src === undefined) continue;
      const r = await runPhilc(m, src, "x86_64-unknown-linux-gnu");
      const want = fs.readFileSync(`philc/expected/${name}.out`, "utf8").trimEnd();
      check(`philc: ${file} matches the native run (exit ${code})`, r.exit === +code && r.stdout === want, `exit ${r.exit} ${r.stderr.slice(0, 200)}`);
    }
    const ok = await runPhilc(m, PHILC_SAMPLE, "x86_64-unknown-linux-gnu");
    check("philc: accepts the sample and emits LLVM IR", ok.accepted && ok.stdout.includes("define i32 @main()") && ok.stdout.includes('target triple = "x86_64-unknown-linux-gnu"'), ok.stderr.slice(0, 200));
    const arm = await runPhilc(m, PHILC_SAMPLE, "aarch64-apple-darwin");
    check("philc: the target changes the output", arm.accepted && arm.stdout.includes("apple") && arm.stdout !== ok.stdout);
    const semi = await runPhilc(m, "component main provides U32 {\n  return 42;\n}\n", "x86_64-unknown-linux-gnu");
    const e1 = readPhilcError(semi.stderr);
    check("philc: a parse error is read into line, column and message", !semi.accepted && e1.line === 2 && e1.col === 12 && e1.text.startsWith("unexpected") && !!e1.expecting && e1.expecting.includes('"return"'), JSON.stringify(e1).slice(0, 300));
    const unk = await runPhilc(m, "component main provides U32 {\n    return nope\n}\n", "x86_64-unknown-linux-gnu");
    const e2 = readPhilcError(unk.stderr);
    check("philc: a check error is read into line and message", !unk.accepted && e2.line === 2 && e2.text === "unknown or consumed binding: nope", JSON.stringify(e2));
    const plain = await runPhilc(m, "component main provides U8 {\n    return 7\n}\n", "x86_64-unknown-linux-gnu");
    check("philc: a plain-text refusal passes through unchanged", readPhilcError(plain.stderr).text === "native runnable main currently supports U32 scalar returns; found U8", plain.stderr);
  } else console.log("skip real philc: no build present");
  process.exit(fails ? 1 : 0);
})();
