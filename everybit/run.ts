// "Every bit": sends one honest upload and every one-bit and cut-short version of it to Phil's program.
//
//   local <image.bin> <out.json>
//       runs all of them through the native build and the RISC-V image, which must agree, and
//       writes what each should answer.
//   solana <rpc> <program id> <payer.json> <expected.json> <out.json>
//       sends each as its own transaction and records the signature and what the chain answered.
import * as fs from "fs";
import { execFileSync } from "child_process";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, ComputeBudgetProgram } from "@solana/web3.js";
import { runImage } from "../site/src/rv64";
import { hex } from "../site/src/draw";
import { cases, honest, NOTE } from "../site/src/everybit-core";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const note = (...a: unknown[]) => console.error(...a);
const [command, ...args] = process.argv.slice(2);
async function patiently<T>(f: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) { try { return await f(); } catch (e: any) { if (i >= 10 || !/429|Too Many|fetch failed|ECONNRESET|ETIMEDOUT|503|502|socket hang up|timeout/i.test(String(e?.message ?? e))) throw e; await sleep(1200 * (i + 1)); } }
}

function local() {
  const [imageFile, outFile] = args, image = new Uint8Array(fs.readFileSync(imageFile!)), all = cases();
  const native = (ix: Uint8Array) => Number(/RET (\d+)/.exec(execFileSync("out/phil-chains-native", { input: ["slot 1", "time 1", `program ${"11".repeat(32)}`, `ix ${hex(ix)}`, ""].join("\n") }).toString())![1]);
  const expected: number[] = [];
  let differ = 0, through = 0;
  for (const c of all) {
    const n = native(c.data), r = runImage(image, c.data).code;
    if (n !== r) { differ++; note(`DIFFER ${c.kind} ${c.at}: native ${n}, RISC-V ${r}`); }
    if (c.kind !== "honest" && n === 0) { through++; note(`ACCEPTED ${c.kind} ${c.at}`); }
    expected.push(n);
  }
  const reasons = new Set(expected.filter((c) => c !== 0)).size, ok = differ === 0 && through === 0 && expected[0] === 0;
  note(`${all.length} uploads: the honest one answered ${expected[0]}; ${all.length - 1} attacks, ${through} accepted, ${reasons} different refusals; native and RISC-V differ on ${differ}`);
  fs.writeFileSync(outFile!, JSON.stringify({ ok, expected }) + "\n");
  process.exit(ok ? 0 : 1);
}

async function solana() {
  const [url, programText, payerFile, expectedFile, outFile] = args;
  const conn = new Connection(url!, { commitment: "confirmed", disableRetryOnRateLimit: true }), program = new PublicKey(programText!);
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(payerFile!, "utf8"))));
  const expected: number[] = JSON.parse(fs.readFileSync(expectedFile!, "utf8")).expected, all = cases();
  const quick = /127\.0\.0\.1|localhost/.test(url!), pace = quick ? 5 : 130;
  const balance = await patiently(() => conn.getBalance(payer.publicKey));
  note(`wallet ${payer.publicKey.toBase58()} holds ${balance / 1e9} SOL; ${all.length} transactions cost about ${(all.length * 5000) / 1e9}`);
  if (balance < all.length * 5000 * 2) { note("not enough to send them all"); process.exit(2); }

  const sig: (string | null)[] = all.map(() => null), code: (number | null)[] = all.map(() => null), wrong: string[] = [];
  for (let round = 1; round <= 6; round++) {
    const todo = all.map((_, i) => i).filter((i) => code[i] === null);
    if (!todo.length) break;
    note(`round ${round}: sending ${todo.length}`);
    let blockhash = "", fetched = 0;
    for (const i of todo) {
      if (Date.now() - fetched > 20_000) { blockhash = (await patiently(() => conn.getLatestBlockhash("confirmed"))).blockhash; fetched = Date.now(); }
      const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), new TransactionInstruction({ programId: program, keys: [], data: Buffer.from(all[i]!.data) }));
      tx.recentBlockhash = blockhash; tx.feePayer = payer.publicKey; tx.sign(payer);
      // No preflight: a refusal has to land on the chain as a failed transaction, not be dropped by the node first.
      try { sig[i] = await patiently(() => conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 8 })); } catch (e: any) { note(`send ${i}: ${String(e?.message ?? e).split("\n")[0]}`); }
      await sleep(pace);
    }
    // Give the last ones time to land, then ask what became of each.
    for (let wait = 0; wait < (quick ? 10 : 45); wait++) {
      await sleep(quick ? 500 : 2000);
      const open = todo.filter((i) => code[i] === null && sig[i]);
      if (!open.length) break;
      for (let at = 0; at < open.length; at += 200) {
        const part = open.slice(at, at + 200), got = (await patiently(() => conn.getSignatureStatuses(part.map((i) => sig[i]!)))).value;
        part.forEach((i, k) => {
          const st = got[k];
          if (!st || !(st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return;
          const custom = (st.err as any)?.InstructionError?.[1]?.Custom;
          if (!st.err) code[i] = 0; else if (typeof custom === "number") code[i] = custom; else { code[i] = -1; wrong.push(`${i}: ${JSON.stringify(st.err)}`); }
        });
      }
    }
  }
  const lost = code.filter((c) => c === null).length;
  const differs = all.map((_, i) => i).filter((i) => code[i] !== null && code[i] !== expected[i]);
  const through = all.map((_, i) => i).filter((i) => all[i]!.kind !== "honest" && code[i] === 0);
  const ok = lost === 0 && differs.length === 0 && through.length === 0 && code[0] === 0;
  note(`${all.length - lost} of ${all.length} landed; honest answered ${code[0]}; attacks accepted: ${through.length}; answers that differ from the local run: ${differs.length}`);
  for (const i of differs.slice(0, 20)) note(`  differs ${all[i]!.kind} ${all[i]!.at}: chain ${code[i]}, local ${expected[i]}`);
  for (const w of wrong.slice(0, 10)) note(`  unexpected error ${w}`);
  const good = honest();
  fs.writeFileSync(outFile!, JSON.stringify({
    ok, day: new Date().toISOString().slice(0, 10), cluster: quick ? "local" : "devnet", program: programText, wallet: payer.publicKey.toBase58(),
    note: NOTE, hex: hex(good), bytes: good.length, sent: all.length, landed: all.length - lost, accepted: through.length, differs: differs.length,
    // In the order of cases(): the honest upload, each bit, each cut. [what the chain answered, the transaction].
    results: all.map((_, i) => [code[i], sig[i]]),
  }) + "\n");
  process.exit(ok ? 0 : 1);
}

(command === "local" ? Promise.resolve(local()) : command === "solana" ? solana() : Promise.reject(new Error("usage: local | solana"))).catch((e) => { note(String(e?.stack ?? e)); process.exit(1); });
