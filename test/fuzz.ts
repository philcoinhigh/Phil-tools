// The fuzzer's reader for philc's LLVM output, checked against real output from the build workflow.
import * as fs from "fs";
import { irResult } from "../fuzz/ir";
let fails = 0;
const check = (name: string, ok: boolean, detail = "") => { if (!ok) fails++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : "  " + detail}`); };
const show = (r: ReturnType<typeof irResult>) => (r === undefined ? "undefined" : "unit" in r ? "unit" : String(r.value));
const ir = (body: string) => `target triple = "x"\n\ndefine i32 @main() {\nblock_entry:\n${body}\n}\n`;
check("literal return", show(irResult(ir("  ret i32 7"))) === "7");
check("binding then return", show(irResult(ir("  %source_value_a = add i32 0, 42\n  ret i32 %source_value_a"))) === "42");
check("chain of bindings", show(irResult(ir("  %a = add i32 0, 5\n  %b = add i32 0, %a\n  ret i32 %b"))) === "5");
check("values wrap to 32 bits like the machine does", show(irResult(ir("  %a = add i32 0, -1\n  ret i32 %a"))) === "4294967295");
check("unit return is recognised", show(irResult(ir("  ret i32 0 ; return-unit"))) === "unit");
check("an unknown instruction is not guessed at", irResult(ir("  %a = mul i32 2, 3\n  ret i32 %a")) === undefined);
check("an undefined name is not guessed at", irResult(ir("  ret i32 %nope")) === undefined);
check("no main means no result", irResult("define i32 @other() {\n  ret i32 1\n}\n") === undefined);
const dir = "philc/expected";
if (fs.existsSync(`${dir}/index.txt`)) {
  const want: Record<string, string> = { "examples_run_return-42.phil": "42", "examples_run_scalar-binding-42.phil": "42", "examples_run_return-unit.phil": "unit" };
  for (const [f, v] of Object.entries(want)) if (fs.existsSync(`${dir}/${f}.out`)) check(`real philc output: ${f}`, show(irResult(fs.readFileSync(`${dir}/${f}.out`, "utf8"))) === v, show(irResult(fs.readFileSync(`${dir}/${f}.out`, "utf8"))));
}
if (fs.existsSync("fuzz/data.json")) {
  const d = JSON.parse(fs.readFileSync("fuzz/data.json", "utf8"));
  check("published fuzz data carries counts only", Object.keys(d.findings).sort().join() === "crash,disagreement,hang,inconsistent,slow" && !JSON.stringify(d).includes("component main") && !("scaling" in d));
}
process.exit(fails ? 1 : 0);
