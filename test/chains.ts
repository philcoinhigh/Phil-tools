// One Phil program, three machines: the native build (as on Solana), the RISC-V image in the
// reference machine, and the same image inside the interpreter contract on a local Ethereum VM.
// All three must give the same verdict and the same log for every upload.
import * as fs from "fs";
import { execFileSync, execSync } from "child_process";
import { runImage } from "../site/src/rv64";
import { hex, sha256, concat } from "../site/src/draw";
import { noteData, KIND_NOTE, explainCode } from "../site/src/chains";
import { compile, LocalChain, iface } from "../chains/evm";

let fails = 0;
const check = (name: string, ok: boolean, info = "") => { if (!ok) { fails++; console.log("FAIL", name, info); } else console.log("ok  ", name); };

(async () => {
  execSync("giveaway/native/build.sh out/phil-chains-native chains/runtime.c", { stdio: "inherit" });
  execSync("chains/build-riscv.sh out/phil-chains.bin", { stdio: "inherit" });
  const image = new Uint8Array(fs.readFileSync("out/phil-chains.bin")), enc = new TextEncoder();
  const native = (ix: Uint8Array) => { const out = execFileSync("out/phil-chains-native", { input: ["slot 1", "time 1", `program ${"11".repeat(32)}`, `ix ${hex(ix)}`, ""].join("\n") }).toString().split("\n"); return { code: Number(/RET (\d+)/.exec(out.find((l) => l.startsWith("RET "))!)![1]), logs: out.filter((l) => l.startsWith("LOG ")).map((l) => l.slice(4)) }; };

  const compiled = compile(), I = iface(compiled), chain = await LocalChain.start();
  const deployed = await chain.send(null, compiled.bytecode + I.encodeDeploy(["0x" + hex(image)]).slice(2));
  const at = deployed.created!;
  check("EVM: the interpreter contract deploys with the image, within the contract size limit", deployed.ok && !!at && (await chain.codeSize(at)) < 24576, `${deployed.ok} ${at && (await chain.codeSize(at))}`);
  const read = async (fn: string) => I.decodeFunctionResult(fn, (await chain.call(at, I.encodeFunctionData(fn))).returned)[0];
  check("EVM: the contract holds exactly the image that was built, by its SHA-256", (await read("imageSha256")) === "0x" + hex(sha256(image)) && (await read("imageLength")) === BigInt(image.length));
  const onEvm = async (ix: Uint8Array) => { const r = await chain.call(at, I.encodeFunctionData("run", ["0x" + hex(ix)])); if (!r.ok) return { code: -1, logs: ["(reverted)"], steps: 0, gas: r.gas }; const [code, steps, logs] = I.decodeFunctionResult("run", r.returned); return { code: Number(code), steps: Number(steps), logs: String(logs).split("\n").filter(Boolean), gas: r.gas }; };

  const good = noteData("gm from every chain");
  const cases: [string, Uint8Array, number][] = [
    ["an honest note is ACCEPTED", good, 0],
    ["one changed byte is REJECTED by Phil: the bytes no longer match their digest", (() => { const d = good.slice(); d[d.length - 1] ^= 1; return d; })(), 1201],
    ["an upload of another kind is refused by policy", noteData("x", { kind: "other/kind" }), 1402],
    ["a note that is too long is refused by policy before it is read", noteData("y".repeat(300)), 1401],
    ["a cancelled upload ends as cancelled", noteData("x", { cancel: true }), 1500],
    ["a client speaking an unknown protocol version is turned away", noteData("x", { versions: [7] }), 1300],
    ["fewer bytes than declared is an early end", noteData("hello", { declaredLength: 9 }), 1900],
    ["an empty note is still a valid upload", noteData(""), 0],
    ["the longest note allowed is accepted", noteData("z".repeat(280)), 0],
    ["no instruction at all", new Uint8Array(0), 102],
    ["an unknown instruction", Uint8Array.of(9), 103],
    ["bytes that are not a frame", Uint8Array.of(1, 2, 3, 4), 1652],
    ["bytes left over after the upload", concat(good, Uint8Array.of(0)), 120],
  ];
  let most = 0n, mostSteps = 0;
  for (const [name, ix, want] of cases) {
    const n = native(ix), r = runImage(image, ix), e = await onEvm(ix);
    if (e.gas > most) most = e.gas; if (e.steps > mostSteps) mostSteps = e.steps;
    check(`${name}: native, RISC-V and EVM agree (${want})`, n.code === want && r.code === want && e.code === want && n.logs.join("|") === r.logs.join("|") && r.logs.join("|") === e.logs.join("|") && r.steps === e.steps, `native ${n.code} riscv ${r.code} evm ${e.code} | ${e.logs.join("|")} | ${r.steps}/${e.steps}`);
  }
  console.log(`     the most a run cost on the EVM: ${most} gas for ${mostSteps} RISC-V instructions`);
  check("the verdict is said in words", /ACCEPTED/.test(explainCode(0)) && /digest/.test(explainCode(1201)) && /policy/.test(explainCode(1402)));

  // Random uploads: flip, cut and extend an honest one. Whatever comes out, all three must agree.
  let rng = 12345, same = true, firstBad = "";
  const rand = (n: number) => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng % n; };
  for (let i = 0; i < 60 && same; i++) {
    let d: Uint8Array = noteData("fuzz " + i).slice();
    const kind = rand(3);
    if (kind === 0) d[rand(d.length)] ^= 1 << rand(8); else if (kind === 1) d = d.slice(0, rand(d.length)); else d = concat(d, Uint8Array.from({ length: 1 + rand(5) }, () => rand(256)));
    const n = native(d), r = runImage(image, d), e = await onEvm(d);
    same = n.code === r.code && r.code === e.code && n.logs.join("|") === e.logs.join("|") && r.steps === e.steps;
    if (!same) firstBad = `${hex(d)}: native ${n.code} riscv ${r.code} evm ${e.code}`;
  }
  check("60 damaged uploads: the three machines never disagree", same, firstBad);

  // A real transaction.
  const sent = await chain.send(at, I.encodeFunctionData("submit", ["0x" + hex(good)]));
  check("EVM: an accepted upload is counted and announced by a real transaction", sent.ok && sent.logs.length === 1 && (await read("accepted")) === 1n, String(sent.ok));
  const bad = good.slice(); bad[bad.length - 2] ^= 1;
  const refused = await chain.send(at, I.encodeFunctionData("submit", ["0x" + hex(bad)]));
  check("EVM: a refused upload reverts the transaction, with Phil's reason", !refused.ok && refused.returned === I.encodeErrorResult("Refused", [1201]) && (await read("accepted")) === 1n, refused.returned);
  console.log(`     a submit cost ${sent.gas} gas; deploying cost ${deployed.gas} gas`);
  fs.mkdirSync("chains/out", { recursive: true });
  fs.writeFileSync("chains/out/local.json", JSON.stringify({ ok: fails === 0, runGas: Number(most), submitGas: Number(sent.gas), deployGas: Number(deployed.gas), steps: mostSteps, imageBytes: image.length, imageSha256: hex(sha256(image)), solc: compiled.solc }, null, 1) + "\n");
  console.log(fails ? `chains: ${fails} FAILED` : "chains: all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
