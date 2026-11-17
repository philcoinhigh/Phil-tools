// Runs the quantum-safe vault against a Solana node. Used by the workflow; needs a funded payer key.
//
//   selftest <rpc> <program id> <payer.json>
//       opens a vault and tries everything an attacker with the signatures in hand could try.
//   demo <rpc> <program id> <payer.json> <demo.json>
//       one vault's whole life (open, two spends, closed), recorded for the site.
// The self-test also covers a token, a vault with a waiting time, and the guard key's cancel.
import * as fs from "fs";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { readVerdict, sha256 } from "../site/src/draw";
import { TOKEN_PROGRAM_ID, MINT_SIZE, createInitializeMint2Instruction, createMintToInstruction } from "@solana/spl-token";
import { keyRoot, makeSpend, makeCancel, decodeQVault, spendData, QVault, QVAULT_SIZE } from "../site/src/wots";
import { openVaultInstructions, spendInstructions, finishInstructions, cancelInstructions, depositTokenInstructions, createTokenAccount, tokenAccountOf, vaultTokenAccount, upgradeAuthority, programDataAddress } from "../site/src/qvault-tx";

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
async function open(seed: Uint8Array, deposit: bigint, delaySeconds = 0, guardRoot?: Uint8Array) {
  const rentLamports = await patiently(() => conn.getMinimumBalanceForRentExemption(QVAULT_SIZE));
  const made = openVaultInstructions({ program, payer: payer.publicKey, root: keyRoot(seed, 0n), rentLamports, depositLamports: deposit, delaySeconds, guardRoot });
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

  // A token: the vault's token account answers to the same one-time key.
  // Built from plain instructions and sent through send(), which is patient with a busy public node.
  const held = async (k: PublicKey) => BigInt((await patiently(() => conn.getTokenAccountBalance(k, "confirmed"))).value.amount);
  const coin = Keypair.generate(), mint = coin.publicKey, side = { mint, tokenProgram: TOKEN_PROGRAM_ID };
  const mine = tokenAccountOf(payer.publicKey, mint, TOKEN_PROGRAM_ID), aliceTokens = tokenAccountOf(alice, mint, TOKEN_PROGRAM_ID), malloryTokens = tokenAccountOf(mallory, mint, TOKEN_PROGRAM_ID);
  const minted = await send([
    SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint, lamports: await patiently(() => conn.getMinimumBalanceForRentExemption(MINT_SIZE)), space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
    createInitializeMint2Instruction(mint, 6, payer.publicKey, null),
    ...[payer.publicKey, alice, mallory].map((owner) => createTokenAccount(payer.publicKey, owner, mint, TOKEN_PROGRAM_ID)),
    createMintToInstruction(mint, mine, payer.publicKey, 1_000_000_000n),
  ], [payer, coin], false);
  if (!minted.ok) throw new Error("could not make the test coin: " + minted.error);
  const put = await send(depositTokenInstructions(program, vault, payer.publicKey, mint, TOKEN_PROGRAM_ID, 500_000_000n, 6), [payer], false);
  const vaultTokens = vaultTokenAccount(program, vault, mint, TOKEN_PROGRAM_ID);
  expect("a token is deposited into the vault's own token account", put.ok && (await held(vaultTokens)) === 500_000_000n, put.error);
  const tokenSpend = makeSpend(seed, vault.toBytes(), aliceTokens.toBytes(), 200_000_000n, 1n, false, mint.toBytes());
  r = await send(spendInstructions(program, vault, malloryTokens, tokenSpend.record, undefined, side), [fees]);
  expect("a token spend cannot be redirected to another token account", !r.ok && (await held(vaultTokens)) === 500_000_000n, r.error);
  const tokenPaid = await send(spendInstructions(program, vault, aliceTokens, tokenSpend.record, undefined, side), [fees]);
  state = await readVault(vault);
  expect("a one-time signature moves the token, and the vault moves to its next key", tokenPaid.ok && (await held(aliceTokens)) === 200_000_000n && (await held(vaultTokens)) === 300_000_000n && state.v.counter === 2n, tokenPaid.error + " " + tokenPaid.logs.join(" | "));

  const rest = state.lamports - state.v.reserve, last = makeSpend(seed, vault.toBytes(), alice.toBytes(), rest, 2n, true);
  r = await send(spendInstructions(program, vault, alice, makeSpend(seed, vault.toBytes(), alice.toBytes(), rest - 1n, 2n, true).record), [fees]);
  expect("a vault with money left in it cannot be left without a next key", !r.ok, r.error);
  const closed = await send(spendInstructions(program, vault, alice, last.record), [fees]);
  state = await readVault(vault);
  expect("the last spend empties the vault and ends it", closed.ok && state.v.state === "closed" && state.lamports === state.v.reserve && (await balance(alice)) === START + DEPOSIT, closed.error + " " + closed.logs.join(" | "));

  // A vault with a waiting time. Its phrase is "stolen": the thief signs a withdrawal, and the guard key answers.
  const WAIT = 8, guardSeed = sha256(Keypair.generate().secretKey), fresh = sha256(Keypair.generate().secretKey);
  const { vault: slow, sent: openedSlow } = await open(seed, DEPOSIT, WAIT, keyRoot(guardSeed, 0n));
  const before = await balance(mallory);
  const theft = await send(spendInstructions(program, slow, mallory, makeSpend(seed, slow.toBytes(), mallory.toBytes(), DEPOSIT, 0n).record, undefined, undefined, true), [fees]);
  state = await readVault(slow);
  expect("in a vault with a waiting time, a signed spend is recorded and nothing is paid yet", openedSlow.ok && theft.ok && state.v.delay === WAIT && state.v.pending?.amount === DEPOSIT && state.lamports - state.v.reserve === DEPOSIT && (await balance(mallory)) === before, theft.error + " " + theft.logs.join(" | "));
  r = await send(finishInstructions(program, slow, mallory), [fees]);
  expect("the recorded payment cannot be completed before its time", !r.ok, r.error);
  const stop = makeCancel(guardSeed, slow.toBytes(), fresh, 1n, 0n);
  r = await send(cancelInstructions(program, slow, makeCancel(seed, slow.toBytes(), sha256(mallory.toBytes()), 1n, 0n).record), [fees]);
  expect("the vault's own phrase cannot cancel or re-key it", !r.ok, r.error);
  const cancelled = await send(cancelInstructions(program, slow, stop.record), [fees]);
  state = await readVault(slow);
  expect("the guard key cancels the withdrawal and gives the vault a key from a new phrase", cancelled.ok && state.v.pending === null && Buffer.from(state.v.root).equals(Buffer.from(keyRoot(fresh, 1n))) && state.v.cancels === 1n, cancelled.error + " " + cancelled.logs.join(" | "));
  await sleep((WAIT + 2) * 1000);
  r = await send(finishInstructions(program, slow, mallory), [fees]);
  expect("the thief's withdrawal can never be completed, even after the wait", !r.ok && (await balance(mallory)) === before, r.error);
  r = await send(spendInstructions(program, slow, mallory, makeSpend(seed, slow.toBytes(), mallory.toBytes(), DEPOSIT, 1n).record, undefined, undefined, true), [fees]);
  expect("and the stolen phrase signs nothing the vault accepts", !r.ok, r.error);
  const aliceBefore = await balance(alice);
  const mineNow = await send(spendInstructions(program, slow, alice, makeSpend(fresh, slow.toBytes(), alice.toBytes(), DEPOSIT, 1n).record, undefined, undefined, true), [fees]);
  let finished: Sent = { ok: false, signature: null, logs: [], units: null, error: "never tried" };
  for (let i = 0; i < 12 && !finished.ok; i++) { await sleep(i === 0 ? (WAIT + 1) * 1000 : 4000); finished = await send(finishInstructions(program, slow, alice), [fees]); }
  expect("the owner's withdrawal, signed with the new phrase, is paid by anyone once its time has passed", mineNow.ok && finished.ok && (await balance(alice)) === aliceBefore + DEPOSIT, finished.error + " " + finished.logs.join(" | "));

  // Who can still replace this program? (Nobody, for the locked copy.)
  const data = await patiently(() => conn.getAccountInfo(programDataAddress(program), "confirmed"));
  const authority = data ? upgradeAuthority(Uint8Array.from(data.data)) : undefined;
  console.log(JSON.stringify({ ok: problems.length === 0, problems, vault: vault.toBase58(), openUnits: opened.units, spendUnits: paid.units, tokenUnits: tokenPaid.units, cancelUnits: cancelled.units, finishUnits: finished.units, hashSteps: first.work,
    upgradeAuthority: authority === undefined ? "unknown" : authority === null ? "none" : authority.toBase58() }, null, 1));
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
