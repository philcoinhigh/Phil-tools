// Runs "same Phil, every chain" against real nodes. Used by the workflow.
//
//   solana <rpc> <program id> <payer.json> <out.json>
//       sends an honest note (accepted) and a tampered one (refused) to the Solana program.
//   evm <key file> <deployments.json>
//       for each network in chains/networks.json: if the test key holds funds there, deploys the
//       interpreter contract with the image (when it is not there yet or the build changed), asks
//       it the same two questions with eth_call, and sends one real accepted upload.
//       With no funds it records the address that needs them and moves on.
import * as fs from "fs";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, ComputeBudgetProgram } from "@solana/web3.js";
import { JsonRpcProvider, Wallet, ContractFactory, Contract, keccak256, formatEther } from "ethers";
import { hex, sha256 } from "../site/src/draw";
import { noteData } from "../site/src/chains";
import { compile } from "./evm";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const note = (...a: unknown[]) => console.error(...a);
const json = (f: string, fallback: any) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fallback; } };
const [command, ...args] = process.argv.slice(2);
const NOTE = "the same Phil program answers on every chain", today = () => new Date().toISOString().slice(0, 10);
const tampered = (d: Uint8Array) => { const t = d.slice(); t[t.length - 1] ^= 1; return t; };
async function patiently<T>(f: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) { try { return await f(); } catch (e: any) { if (i >= 8 || !/429|Too Many|fetch failed|ECONNRESET|ETIMEDOUT|503|502|socket hang up|timeout/i.test(String(e?.message ?? e))) throw e; await sleep(1500 * (i + 1)); } }
}

async function solana() {
  const [url, programText, payerFile, outFile] = args;
  const conn = new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true }), program = new PublicKey(programText);
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(payerFile, "utf8")))), local = /127\.0\.0\.1|localhost/.test(url);
  const send = async (data: Uint8Array) => {
    try {
      const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), new TransactionInstruction({ programId: program, keys: [], data: Buffer.from(data) }));
      tx.recentBlockhash = (await patiently(() => conn.getLatestBlockhash("confirmed"))).blockhash; tx.feePayer = payer.publicKey; tx.sign(payer);
      const raw = tx.serialize();
      const signature = await patiently(() => conn.sendRawTransaction(raw, { preflightCommitment: "confirmed" }));
      for (let i = 0; ; i++) {
        await sleep(local ? 400 : 1600);
        const st = (await patiently(() => conn.getSignatureStatuses([signature]))).value[0];
        if (st?.err) return { ok: false, signature, logs: [] as string[], units: null as number | null, error: JSON.stringify(st.err) };
        if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") break;
        if (i >= 50) return { ok: false, signature, logs: [], units: null, error: "not confirmed in time" };
      }
      let found = null;
      for (let i = 0; i < 20 && !found; i++) { found = await patiently(() => conn.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })); if (!found) await sleep(1500); }
      return { ok: true, signature, logs: found?.meta?.logMessages ?? [], units: found?.meta?.computeUnitsConsumed ?? null, error: "" };
    } catch (e: any) { return { ok: false, signature: null, logs: (e?.logs ?? e?.transactionLogs ?? []) as string[], units: null, error: String(e?.message ?? e).split("\n")[0] }; }
  };
  const good = noteData(NOTE), yes = await send(good), no = await send(tampered(good));
  const accepted = yes.ok && yes.logs.some((l) => /Phil: ACCEPTED/.test(l));
  const refused = !no.ok && /0x4b1|1201|do not match the declared digest/.test(no.error + no.logs.join(" "));
  note(accepted ? "ok  " : "FAIL", "Solana: the honest note is ACCEPTED", accepted ? "" : yes.error + " " + yes.logs.join(" | "));
  note(refused ? "ok  " : "FAIL", "Solana: the tampered note is REJECTED by Phil (1201)", refused ? "" : no.error + " " + no.logs.join(" | "));
  fs.writeFileSync(outFile, JSON.stringify({ ok: accepted && refused, day: today(), note: NOTE, accepted: yes.signature, units: yes.units, refusedWith: no.error.slice(0, 200) }, null, 1) + "\n");
  process.exit(accepted && refused ? 0 : 1);
}

async function evm() {
  const [keyFile, outFile] = args;
  const key = fs.readFileSync(keyFile, "utf8").trim(), networks: any[] = json("chains/networks.json", []), all = json(outFile, {});
  const image = new Uint8Array(fs.readFileSync("chains/out/phil_chains.bin")), compiled = compile(), build = keccak256(compiled.bytecode).slice(2, 18) + "-" + hex(sha256(image)).slice(0, 16);
  const good = noteData(NOTE), address = new Wallet(key).address;
  let failed = false;
  for (const n of networks) {
    const was = all[n.id] ?? {}, rec: any = { ...was, error: undefined, name: n.name, chainId: n.chainId, explorer: n.explorer, deployer: address, checkedOn: today() };
    try {
      let provider: JsonRpcProvider | null = null, rpc = "";
      for (const url of n.rpc) { try { const p = new JsonRpcProvider(url, n.chainId, { staticNetwork: true }); await p.getBlockNumber(); provider = p; rpc = url; break; } catch { /* try the next */ } }
      if (!provider) throw new Error("no node answered");
      rec.rpc = rpc;
      const wallet = new Wallet(key, provider), balance = await patiently(() => provider!.getBalance(address));
      rec.balance = formatEther(balance);
      const there = was.address && was.build === build && (await patiently(() => provider!.getCode(was.address))).length > 2;
      if (!there) {
        // Pay the node's own going price and no more, so a faucet's small grant goes as far as it can.
        const price = BigInt(await patiently(() => provider!.send("eth_gasPrice", []))), need = price * 3_400_000n;
        rec.gasPrice = price.toString();
        if (balance > 0n && balance < need) { rec.status = `waiting for ${n.coin}: it holds ${formatEther(balance)} and deploying needs about ${formatEther(need)}; send more to ${address}`; note(`${n.name}: ${rec.status}`); all[n.id] = rec; continue; }
        if (balance === 0n) { rec.status = `waiting for ${n.coin}: send some to ${address}`; note(`${n.name}: ${rec.status}`); all[n.id] = rec; continue; }
        const made = await new ContractFactory(compiled.abi, compiled.bytecode, wallet).deploy("0x" + hex(image), n.legacy ? { type: 0, gasPrice: price, gasLimit: 3_400_000 } : {});
        const receipt = await made.deploymentTransaction()!.wait(1, 180_000);
        Object.assign(rec, { address: await made.getAddress(), build, deployTx: receipt!.hash, deployGas: Number(receipt!.gasUsed), deployedOn: today(), imageSha256: hex(sha256(image)) });
        note(`${n.name}: deployed at ${rec.address} for ${rec.deployGas} gas`);
      }
      const c = new Contract(rec.address, compiled.abi, wallet);
      const yes = await patiently(() => c.run.staticCall("0x" + hex(good))), no = await patiently(() => c.run.staticCall("0x" + hex(tampered(good))));
      const same = (await c.imageSha256()) === "0x" + hex(sha256(image));
      const ok = Number(yes[0]) === 0 && Number(no[0]) === 1201 && same;
      note(ok ? "ok  " : "FAIL", `${n.name}: the honest note is ACCEPTED, the tampered one is REJECTED (1201), and the contract holds the image that was built`, ok ? "" : `${yes[0]} ${no[0]} ${same}`);
      rec.ok = ok; rec.steps = Number(yes[1]); rec.status = ok ? "live" : "deployed, but its answers were wrong";
      if (ok && rec.submittedOn !== today() && balance > 0n) {
        try { const tx = await c.submit("0x" + hex(good), n.legacy ? { type: 0, gasPrice: BigInt(await provider.send("eth_gasPrice", [])), gasLimit: 900_000 } : { gasLimit: 1_500_000 }); const r = await tx.wait(1, 180_000); Object.assign(rec, { submitTx: r.hash, submitGas: Number(r.gasUsed), submittedOn: today(), accepted: Number(await c.accepted()) }); note(`${n.name}: a real upload was accepted for ${rec.submitGas} gas`); }
        catch (e: any) { note(`${n.name}: the real upload was not sent: ${String(e?.shortMessage ?? e?.message ?? e).split("\n")[0]}`); }
      }
      if (!ok) failed = true;
    } catch (e: any) { rec.error = String(e?.shortMessage ?? e?.message ?? e).split("\n")[0].slice(0, 200); note(`${n.name}: ${rec.error}`); }
    all[n.id] = rec;
  }
  fs.writeFileSync(outFile, JSON.stringify(all, null, 1) + "\n");
  process.exit(failed ? 1 : 0);
}

(command === "solana" ? solana() : command === "evm" ? evm() : Promise.reject(new Error("usage: solana | evm"))).catch((e) => { note(String(e?.stack ?? e)); process.exit(1); });
