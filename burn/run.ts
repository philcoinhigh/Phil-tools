// Runs burn vaults against a Solana node. Used by the workflow; needs a funded payer key.
//
//   selftest <rpc> <program id> <payer.json>
//       a made-up coin and vault from end to end, with the refusals, against the real token program.
//   open <rpc> <program id> <payer.json> <mint> <threshold in whole coins> <label> <vaults.json>
//       opens a vault for any coin and adds it to the list.
//   demo <rpc> <program id> <payer.json> <demo.json> <vaults.json>
//       the demonstration coin: sends "fees" to its vault, then plays the part of a trader who
//       has bought the threshold on the market, burns it and takes the pot.
import * as fs from "fs";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createMint, getOrCreateAssociatedTokenAccount, mintTo, getMint, getAccount } from "@solana/spl-token";
import { readVerdict } from "../site/src/draw";
import { openData, burnData, decodeVault, potOf, Vault, VAULT_SIZE } from "../site/src/burn";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const [command, url, programText, payerFile, ...rest] = process.argv.slice(2);
const conn = new Connection(url, "confirmed");
const program = new PublicKey(programText);
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(payerFile, "utf8"))));
const note = (...a: unknown[]) => console.error(...a);
const json = (f: string, fallback: any) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fallback; } };

interface Sent { ok: boolean; signature: string | null; logs: string[]; units: number | null; slot: number | null; error?: string }
async function send(ixs: TransactionInstruction[], signers: Keypair[]): Promise<Sent> {
  try {
    const signature = await sendAndConfirmTransaction(conn, new Transaction().add(...ixs), signers, { commitment: "confirmed" });
    let tx = null;
    for (let i = 0; i < 20 && !tx; i++) { tx = await conn.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }); if (!tx) await sleep(1500); }
    return { ok: true, signature, logs: tx?.meta?.logMessages ?? [], units: tx?.meta?.computeUnitsConsumed ?? null, slot: tx?.slot ?? null };
  } catch (e: any) {
    return { ok: false, signature: null, logs: e?.logs ?? e?.transactionLogs ?? [], units: null, slot: null, error: String(e?.message ?? e).split("\n")[0] };
  }
}
const openIx = (vault: PublicKey, data: Uint8Array) => new TransactionInstruction({ programId: program, keys: [{ pubkey: vault, isSigner: false, isWritable: true }], data: Buffer.from(data) });
const burnIx = (vault: PublicKey, mint: PublicKey, tokens: PublicKey, sender: PublicKey, tokenProgram: PublicKey, data: Uint8Array) => new TransactionInstruction({ programId: program, data: Buffer.from(data), keys: [
  { pubkey: vault, isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: true }, { pubkey: tokens, isSigner: false, isWritable: true },
  { pubkey: sender, isSigner: true, isWritable: true }, { pubkey: tokenProgram, isSigner: false, isWritable: false }] });

/** Creates the vault account and opens it in one transaction, so nothing can arrive in between. */
async function openVault(mint: PublicKey, threshold: bigint, label: string, data = openData(mint.toBytes(), threshold, label)): Promise<{ vault: Keypair; sent: Sent }> {
  const vault = Keypair.generate();
  const lamports = await conn.getMinimumBalanceForRentExemption(VAULT_SIZE);
  const sent = await send([SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: vault.publicKey, lamports, space: VAULT_SIZE, programId: program }), openIx(vault.publicKey, data)], [payer, vault]);
  return { vault, sent };
}
async function readVault(vault: PublicKey): Promise<{ v: Vault; lamports: bigint }> {
  const info = await conn.getAccountInfo(vault, "confirmed");
  const v = info && decodeVault(Uint8Array.from(info.data));
  if (!info || !v) throw new Error("the vault is missing or not open");
  return { v, lamports: BigInt(info.lamports) };
}
const fund = (to: PublicKey, lamports: number) => send([SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: to, lamports })], [payer]);

async function selftest() {
  const problems: string[] = [];
  const expect = (name: string, ok: boolean, info = "") => { note(ok ? "ok  " : "FAIL", name, ok ? "" : info); if (!ok) problems.push(name); };
  const THRESHOLD = 1_000_000_000_000n;   // a million coins, six decimals
  const mint = await createMint(conn, payer, payer.publicKey, null, 6);
  const other = await createMint(conn, payer, payer.publicKey, null, 6);
  const mine = await getOrCreateAssociatedTokenAccount(conn, payer, mint, payer.publicKey);
  const others = await getOrCreateAssociatedTokenAccount(conn, payer, other, payer.publicKey);
  await mintTo(conn, payer, mint, mine.address, payer, 2_500_000_000_000n);
  await mintTo(conn, payer, other, others.address, payer, 5_000_000_000_000n);

  const bad = await openVault(mint, THRESHOLD, "self-test", (() => { const d = openData(mint.toBytes(), THRESHOLD, "self-test"); d[d.length - 1] ^= 1; return d; })());
  expect("a rule altered after its digest was declared is rejected by Phil on chain", !bad.sent.ok && /do not match the declared digest/.test(bad.sent.logs.join("\n")), bad.sent.error);
  const { vault, sent } = await openVault(mint, THRESHOLD, "self-test");
  expect("Phil accepts the rule and the vault opens", sent.ok && readVerdict(sent.logs).accepted, sent.error + " " + sent.logs.join(" | "));
  const V = vault.publicKey;
  let r = await send([openIx(V, openData(other.toBytes(), 1n, "swapped"))], [payer]);
  expect("an open vault's rule cannot be replaced", !r.ok && /REJECTED by policy/.test(r.logs.join("\n")), r.error);
  r = await send([burnIx(V, mint, mine.address, payer.publicKey, TOKEN_PROGRAM_ID, burnData(0n))], [payer]);
  expect("an empty vault pays nothing and burns nothing", !r.ok && (await getAccount(conn, mine.address)).amount === 2_500_000_000_000n, r.error);

  const FEES = 0.05 * LAMPORTS_PER_SOL;
  await fund(V, FEES);
  expect("fees sent to the vault are its pot", potOf((await readVault(V)).lamports, (await readVault(V)).v) === BigInt(FEES));
  r = await send([burnIx(V, other, others.address, payer.publicKey, TOKEN_PROGRAM_ID, burnData(0n))], [payer]);
  expect("burning a different coin does not take the pot", !r.ok && (await getAccount(conn, others.address)).amount === 5_000_000_000_000n, r.error);
  r = await send([burnIx(V, mint, mine.address, payer.publicKey, program, burnData(0n))], [payer]);
  expect("a stand-in for the token program is refused", !r.ok, r.error);
  r = await send([burnIx(V, mint, mine.address, payer.publicKey, TOKEN_PROGRAM_ID, burnData(BigInt(FEES) + 1n))], [payer]);
  expect("an offer asking for more than the pot is not carried out", !r.ok && (await getAccount(conn, mine.address)).amount === 2_500_000_000_000n, r.error);

  const before = { sol: await conn.getBalance(payer.publicKey), supply: (await getMint(conn, mint)).supply };
  const burned = await send([burnIx(V, mint, mine.address, payer.publicKey, TOKEN_PROGRAM_ID, burnData(BigInt(FEES)))], [payer]);
  const after = { sol: await conn.getBalance(payer.publicKey), supply: (await getMint(conn, mint)).supply, held: (await getAccount(conn, mine.address)).amount, ...(await readVault(V)) };
  expect("Phil accepts the offer and the real token program burns the coins", burned.ok && /token program burned the coins/.test(burned.logs.join("\n")) && readVerdict(burned.logs).accepted, burned.error + " " + burned.logs.join(" | "));
  expect("the coin's supply fell by exactly the threshold", before.supply - after.supply === THRESHOLD && after.held === 1_500_000_000_000n);
  expect("the sender was paid the pot, less the network fee", FEES - (after.sol - before.sol) >= 0 && FEES - (after.sol - before.sol) <= 10000, String(after.sol - before.sol));
  expect("the vault kept only its reserve and counted the burn", after.lamports === after.v.reserve && after.v.burns === 1 && after.v.totalBurned === THRESHOLD && after.v.totalPaid === BigInt(FEES));
  r = await send([burnIx(V, mint, mine.address, payer.publicKey, TOKEN_PROGRAM_ID, burnData(0n))], [payer]);
  expect("the pot cannot be taken twice", !r.ok, r.error);
  console.log(JSON.stringify({ ok: problems.length === 0, problems, vault: V.toBase58(), openUnits: sent.units, burnUnits: burned.units, burnLogs: burned.logs }, null, 1));
  process.exit(problems.length ? 1 : 0);
}

function listVault(file: string, entry: Record<string, unknown>) {
  const list = json(file, []).filter((x: any) => x.vault !== entry.vault);
  list.push(entry);
  fs.writeFileSync(file, JSON.stringify(list, null, 1) + "\n");
}

async function open() {
  const [mintText, wholeText, label, listFile] = rest;
  const mint = new PublicKey(mintText);
  const info = await getMint(conn, mint, "confirmed", (await conn.getAccountInfo(mint))!.owner);
  const threshold = BigInt(Math.round(Number(wholeText))) * 10n ** BigInt(info.decimals);
  const { vault, sent } = await openVault(mint, threshold, String(label ?? "").slice(0, 32));
  if (!sent.ok) throw new Error("the vault did not open: " + sent.error + "\n" + sent.logs.join("\n"));
  listVault(listFile, { vault: vault.publicKey.toBase58(), mint: mint.toBase58(), label, decimals: info.decimals, threshold: threshold.toString(), program: program.toBase58(), network: "devnet", opened: sent.signature, day: new Date().toISOString().slice(0, 10) });
  note(`vault ${vault.publicKey.toBase58()} opened for ${mint.toBase58()}: burn ${wholeText} to take the pot`);
}

async function demo() {
  const [demoFile, listFile] = rest;
  let d = json(demoFile, null);
  const DECIMALS = 6, WHOLE = 1_000_000n, THRESHOLD = WHOLE * 10n ** BigInt(DECIMALS);
  if (!d || d.program !== program.toBase58()) {
    const mint = await createMint(conn, payer, payer.publicKey, null, DECIMALS);
    const { vault, sent } = await openVault(mint, THRESHOLD, "Demo coin");
    if (!sent.ok) throw new Error("the demo vault did not open: " + sent.error + "\n" + sent.logs.join("\n"));
    const start = await getOrCreateAssociatedTokenAccount(conn, payer, mint, payer.publicKey);
    await mintTo(conn, payer, mint, start.address, payer, 1_000_000_000n * 10n ** BigInt(DECIMALS));   // a billion to begin with
    d = { program: program.toBase58(), mint: mint.toBase58(), vault: vault.publicKey.toBase58(), wallet: payer.publicKey.toBase58(), decimals: DECIMALS, threshold: THRESHOLD.toString(), opened: sent.signature, history: [] };
    listVault(listFile, { vault: d.vault, mint: d.mint, label: "Demo coin", decimals: DECIMALS, threshold: d.threshold, program: d.program, network: "devnet", opened: sent.signature, day: new Date().toISOString().slice(0, 10), demo: true });
    fs.writeFileSync(demoFile, JSON.stringify(d, null, 1) + "\n");
  }
  const mint = new PublicKey(d.mint), vault = new PublicKey(d.vault);
  const mine = await getOrCreateAssociatedTokenAccount(conn, payer, mint, payer.publicKey);
  const fee = 0.01 * LAMPORTS_PER_SOL;
  const fed = await fund(vault, fee);
  if (!fed.ok) throw new Error("could not send the stand-in fees: " + fed.error);
  const pot = potOf((await readVault(vault)).lamports, (await readVault(vault)).v);
  const supplyBefore = (await getMint(conn, mint)).supply;
  const burned = await send([burnIx(vault, mint, mine.address, payer.publicKey, TOKEN_PROGRAM_ID, burnData(pot))], [payer]);
  if (!burned.ok) throw new Error("the demo burn failed: " + burned.error + "\n" + burned.logs.join("\n"));
  const { v } = await readVault(vault);
  const supply = (await getMint(conn, mint)).supply;
  d.history = [...(d.history ?? []), { day: new Date().toISOString().slice(0, 10), time: v.lastTime, fees: fed.signature, burn: burned.signature, paid: pot.toString(), burned: (supplyBefore - supply).toString(), supply: supply.toString(), units: burned.units }].slice(-120);
  d.totals = { burns: v.burns, burned: v.totalBurned.toString(), paid: v.totalPaid.toString(), supply: supply.toString() };
  fs.writeFileSync(demoFile, JSON.stringify(d, null, 1) + "\n");
  note(`demo: sent ${fee / LAMPORTS_PER_SOL} SOL of stand-in fees, burned ${(supplyBefore - supply) / 10n ** BigInt(DECIMALS)} coins, paid ${Number(pot) / LAMPORTS_PER_SOL} SOL; burn ${v.burns}`);
}

(command === "selftest" ? selftest() : command === "open" ? open() : command === "demo" ? demo() : Promise.reject(new Error("usage: selftest | open | demo"))).catch((e) => { note(String(e?.stack ?? e)); process.exit(1); });
