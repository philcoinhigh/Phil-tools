// Runs the quantum-safe vault against a Solana node. Used by the workflow; needs a funded payer key.
//
//   selftest <rpc> <program id> <payer.json>
//       opens a vault and tries everything an attacker with the signatures in hand could try.
//   demo <rpc> <program id> <payer.json> <demo.json>
//       one vault's whole life (open, two spends, closed), recorded for the site.
import * as fs from "fs";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { readVerdict, sha256 } from "../site/src/draw";
import { keyRoot, makeSpend, decodeQVault, spendData, QVault, QVAULT_SIZE } from "../site/src/wots";
import { openVaultInstructions, spendInstructions } from "../site/src/qvault-tx";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const [command, url, programText, payerFile, ...rest] = process.argv.slice(2);
const conn = new Connection(url, { commitment: "confirmed", disableRetryOnRateLimit: true });
const program = new PublicKey(programText);
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(payerFile, "utf8"))));
const note = (...a: unknown[]) => console.error(...a);
const json = (f: string, fallback: any) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fallback; } };

interface Sent { ok: boolean; signature: string | null; logs: string[]; units: number | null; error?: string }
// A public node refuses bursts, and shared CI addresses get little room. Every request is retried
// with a growing wait, confirmation is polled slowly, and logs are fetched only when a check reads them.
const local = /127\.0\.0\.1|localhost/.test(url);
async function patiently<T>(f: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await f(); } catch (e: any) { if (i >= 9 || !/429|Too Many|fetch failed|ECONNRESET|ETIMEDOUT|503|502|socket hang up/i.test(String(e?.message ?? e))) throw e; await sleep(1500 * (i + 1)); }
  }
}
async function send(ixs: TransactionInstruction[], signers: Keypair[], wantLogs = true): Promise<Sent> {
  try {
    const tx = new Transaction().add(...ixs);
    tx.recentBlockhash = (await patiently(() => conn.getLatestBlockhash("confirmed"))).blockhash; tx.feePayer = signers[0].publicKey; tx.sign(...signers);
    const raw = tx.serialize();
    const signature = await patiently(() => conn.sendRawTransaction(raw, { preflightCommitment: "confirmed" }));   // the same signed bytes each try: it can land once
    for (let i = 0; ; i++) {
      await sleep(local ? 400 : 1600);
      const st = (await patiently(() => conn.getSignatureStatuses([signature]))).value[0];
      if (st?.err) return { ok: false, signature, logs: [], units: null, error: "failed on chain: " + JSON.stringify(st.err) };
      if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") break;
      if (i >= 50) return { ok: false, signature, logs: [], units: null, error: "not confirmed in time" };
    }
    if (!wantLogs) return { ok: true, signature, logs: [], units: null };
    let found = null;
    for (let i = 0; i < 20 && !found; i++) { found = await patiently(() => conn.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })); if (!found) await sleep(1500); }
    return { ok: true, signature, logs: found?.meta?.logMessages ?? [], units: found?.meta?.computeUnitsConsumed ?? null };
  } catch (e: any) {
    return { ok: false, signature: null, logs: e?.logs ?? e?.transactionLogs ?? [], units: null, error: String(e?.message ?? e).split("\n")[0] };
  }
}
async function readVault(vault: PublicKey): Promise<{ v: QVault; lamports: bigint }> {
  const info = await patiently(() => conn.getAccountInfo(vault, "confirmed"));
  const v = info && decodeQVault(Uint8Array.from(info.data));
  if (!v) throw new Error("the vault is missing or empty");
  return { v, lamports: BigInt(info!.lamports) };
}
const balance = async (k: PublicKey) => BigInt(await patiently(() => conn.getBalance(k, "confirmed")));
async function open(seed: Uint8Array, deposit: bigint) {
  const rentLamports = await patiently(() => conn.getMinimumBalanceForRentExemption(QVAULT_SIZE));
  const made = openVaultInstructions({ program, payer: payer.publicKey, root: keyRoot(seed, 0n), rentLamports, depositLamports: deposit });
  return { vault: made.vault.publicKey, sent: await send(made.instructions, [payer, made.vault]) };
}
/** A key that only pays the network fee. It has no claim on any vault. */
async function stranger(): Promise<Keypair> {
  const k = Keypair.generate();
  const r = await send([SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: k.publicKey, lamports: 5_000_000 })], [payer], false);
  if (!r.ok) throw new Error("could not fund the fee payer: " + r.error);
  return k;
}

async function selftest() {
  const problems: string[] = [];
  const expect = (name: string, ok: boolean, info = "") => { note(ok ? "ok  " : "FAIL", name, ok ? "" : info); if (!ok) problems.push(name); };
  const seed = sha256(Keypair.generate().secretKey), fees = await stranger();
  // The recipients must already exist with rent, or a small payment to them would be refused by Solana itself.
  const alice = Keypair.generate().publicKey, mallory = Keypair.generate().publicKey, START = 1_000_000n;
  await send([alice, mallory].map((k) => SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: k, lamports: START })), [payer], false);
  const DEPOSIT = 30_000_000n;
  const { vault, sent: opened } = await open(seed, DEPOSIT);
  let state = await readVault(vault);
  expect("Phil accepts the opening; the vault holds its deposit under a hash-based key", opened.ok && readVerdict(opened.logs).accepted && state.v.state === "open" && state.lamports - state.v.reserve === DEPOSIT, opened.error + " " + opened.logs.join(" | "));

  const first = makeSpend(seed, vault.toBytes(), alice.toBytes(), 10_000_000n, 0n);
  // Everything an attacker could do with the signature once it is public, tried before it is used.
  let r = await send(spendInstructions(program, vault, mallory, first.record), [fees]);
  expect("the signature cannot be redirected to another recipient", !r.ok && state.lamports === (await readVault(vault)).lamports, r.error);
  r = await send(spendInstructions(program, vault, alice, first.record, spendData(25_000_000n, first.spend.salt, first.spend.nextRoot, first.signature)), [fees]);
  expect("nor raised to a larger amount", !r.ok, r.error);
  r = await send(spendInstructions(program, vault, alice, first.record, spendData(10_000_000n, first.spend.salt, keyRoot(sha256(mallory.toBytes()), 1n), first.signature)), [fees]);
  expect("nor can the next key be swapped for an attacker's", !r.ok, r.error);
  { const bent = spendData(first.spend.amount, first.spend.salt, first.spend.nextRoot, first.signature); bent[bent.length - 9] ^= 1;
    r = await send(spendInstructions(program, vault, alice, first.record, bent), [fees]);
    expect("bytes changed after their digest was declared are rejected by Phil on chain", !r.ok && /do not match the declared digest/.test(r.logs.join("\n")), r.error + " " + r.logs.join(" | ")); }
  r = await send(spendInstructions(program, vault, alice, makeSpend(sha256(mallory.toBytes()), vault.toBytes(), alice.toBytes(), 10_000_000n, 0n).record), [fees]);
  expect("a signature made from any other seed is refused", !r.ok, r.error);

  const paid = await send(spendInstructions(program, vault, alice, first.record), [fees]);
  state = await readVault(vault);
  expect("a one-time signature moves the money; the only wallet that signed was a stranger paying the fee", paid.ok && readVerdict(paid.logs).accepted && (await balance(alice)) === START + 10_000_000n && state.lamports - state.v.reserve === DEPOSIT - 10_000_000n, paid.error + " " + paid.logs.join(" | "));
  expect("the vault moved to the next key in the same step", state.v.counter === 1n && Buffer.from(state.v.root).equals(Buffer.from(keyRoot(seed, 1n))));
  r = await send(spendInstructions(program, vault, alice, first.record), [fees]);
  expect("the used signature is worthless: it can never be accepted again", !r.ok && (await balance(alice)) === START + 10_000_000n, r.error);

  const rest = state.lamports - state.v.reserve, last = makeSpend(seed, vault.toBytes(), alice.toBytes(), rest, 1n, true);
  r = await send(spendInstructions(program, vault, alice, makeSpend(seed, vault.toBytes(), alice.toBytes(), rest - 1n, 1n, true).record), [fees]);
  expect("a vault with money left in it cannot be left without a next key", !r.ok, r.error);
  const closed = await send(spendInstructions(program, vault, alice, last.record), [fees]);
  state = await readVault(vault);
  expect("the last spend empties the vault and ends it", closed.ok && state.v.state === "closed" && state.lamports === state.v.reserve && (await balance(alice)) === START + DEPOSIT, closed.error + " " + closed.logs.join(" | "));
  console.log(JSON.stringify({ ok: problems.length === 0, problems, vault: vault.toBase58(), openUnits: opened.units, spendUnits: paid.units, hashSteps: first.work }, null, 1));
  process.exit(problems.length ? 1 : 0);
}

async function demo() {
  const [demoFile] = rest;
  const d = json(demoFile, null)?.program === program.toBase58() ? json(demoFile, null) : { program: program.toBase58(), wallet: payer.publicKey.toBase58(), vaults: [] };
  const seed = sha256(Keypair.generate().secretKey), fees = await stranger();
  const { vault, sent: opened } = await open(seed, 20_000_000n);
  if (!opened.ok) throw new Error("the demo vault was not opened: " + opened.error + "\n" + opened.logs.join("\n"));
  const spends: { amount: string; signature: string | null; units: number | null; hashSteps: number }[] = [];
  for (const [amount, closing] of [[8_000_000n, false], [12_000_000n, true]] as [bigint, boolean][]) {
    const s = makeSpend(seed, vault.toBytes(), payer.publicKey.toBytes(), amount, BigInt(spends.length), closing);
    const sent = await send(spendInstructions(program, vault, payer.publicKey, s.record), [fees]);
    if (!sent.ok) throw new Error("a demo spend failed: " + sent.error + "\n" + sent.logs.join("\n"));
    spends.push({ amount: amount.toString(), signature: sent.signature, units: sent.units, hashSteps: s.work });
  }
  const { v } = await readVault(vault);
  if (v.state !== "closed" || v.counter !== 2n) throw new Error("the demo vault did not end closed after two keys");
  d.vaults = [{ day: new Date().toISOString().slice(0, 10), vault: vault.toBase58(), opened: opened.signature, feePayer: fees.publicKey.toBase58(), spends }, ...(d.vaults ?? [])].slice(0, 14);
  fs.writeFileSync(demoFile, JSON.stringify(d, null, 1) + "\n");
  note(`demo: a vault opened, paid out twice under two one-time keys (${spends.map((s) => s.units).join(", ")} compute units) and closed`);
}

(command === "selftest" ? selftest() : command === "demo" ? demo() : Promise.reject(new Error("usage: selftest | demo"))).catch((e) => { note(String(e?.stack ?? e)); process.exit(1); });
