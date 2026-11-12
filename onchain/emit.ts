// Runs Phil's compiler (the WebAssembly build in docs/playground) on a Phil file and writes the
// LLVM it emits, adjusted only so that Solana's toolchain will take it: the target lines for a
// desktop machine are dropped and `main` is renamed so Solana's own entry point can call it.
import * as fs from "fs";
import { runPhilc } from "../playground/src/philc";

(async () => {
  const [src, out] = process.argv.slice(2);
  const module = await WebAssembly.compile(fs.readFileSync("docs/playground/philc.wasm"));
  const r = await runPhilc(module, fs.readFileSync(src, "utf8"), "x86_64-unknown-linux-gnu");
  if (!r.accepted) { console.error("philc refused the program:\n" + r.stderr); process.exit(1); }
  fs.writeFileSync(out.replace(/\.ll$/, ".philc.ll"), r.stdout + "\n");
  const ll = r.stdout.split("\n").filter((l) => !/^target (datalayout|triple) = /.test(l)).join("\n").replace(/@main\b/g, "@phil_main");
  if (!/define i32 @phil_main\(\)/.test(ll)) { console.error("unexpected LLVM shape:\n" + r.stdout); process.exit(1); }
  fs.writeFileSync(out, ll + "\n");
  console.log(`philc emitted ${r.stdout.split("\n").length} lines of LLVM for ${src}`);
})();
