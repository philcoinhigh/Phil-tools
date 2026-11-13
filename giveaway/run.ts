// Runs giveaways against a Solana node. Used by the workflow; needs a funded payer key.
//
//   selftest <rpc> <program id> <payer.json>
//       a made-up giveaway from end to end, plus the refusals, plus the wallet-free calls the
//       website makes. Exits non-zero unless everything behaves.
//   run <rpc> <program id> <payer.json> <request.json> <result.json> [network]
//       one real giveaway: create the account, lock through Phil's upload server, wait for the
//       target slot, draw, read the account back and check the winner off chain.
import * as fs from "fs";
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_SLOT_HASHES_PUBKEY, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { buildRecord, cleanEntries, decodeDraw, uploadData, pickWinners, randomnessOf, readVerdict, sha256, hex, Draw, Giveaway, OP_LOCK, OP_DRAW, OP_CHECK, DRAW_SIZE } from "../site/src/draw";
import { buildCall, simulate, accountData } from "../site/src/solana-call";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const [command, url, programText, payerFile, ...rest] = process.argv.slice(2);
const conn = new Connection(url, "confirmed");
const program = new PublicKey(programText);
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(payerFile, "utf8"))));
const note = (...a: unknown[]) => console.error(...a);

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
const call = (data: Uint8Array, keys: { pubkey: PublicKey; isWritable: boolean }[]) =>
  new TransactionInstruction({ programId: program, keys: keys.map((k) => ({ ...k, isSigner: false })), data: Buffer.from(data) });

async function createDrawAccount(): Promise<Keypair> {
  const account = Keypair.generate();
  const lamports = await conn.getMinimumBalanceForRentExemption(DRAW_SIZE);
  const made = await send([SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: account.publicKey, lamports, space: DRAW_SIZE, programId: program })], [payer, account]);
  if (!made.ok) throw new Error("could not create the draw account: " + made.error);
  return account;
}
const lockIx = (account: PublicKey, data: Uint8Array) => call(data, [{ pubkey: account, isWritable: true }]);
const drawIx = (account: PublicKey) => call(Uint8Array.of(OP_DRAW), [{ pubkey: account, isWritable: true }, { pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isWritable: false }]);
async function readDraw(account: PublicKey): Promise<Draw> {
  const info = await conn.getAccountInfo(account, "confirmed");
  const d = info && decodeDraw(Uint8Array.from(info.data));
  if (!d) throw new Error("the draw account is missing or empty");
  return d;
}
/** Waits for the target slot, then draws. Solana keeps a block's hash for about three minutes. */
async function waitAndDraw(account: PublicKey, target: number): Promise<Sent> {
  for (;;) { const slot = await conn.getSlot("confirmed"); if (slot > target + 1) break; await sleep(Math.min(60000, Math.max(800, (target + 2 - slot) * 400))); }
  let last: Sent = { ok: false, signature: null, logs: [], units: null, slot: null, error: "not tried" };
  for (let i = 0; i < 12; i++) { last = await send([drawIx(account)], [payer]); if (last.ok) return last; note("draw attempt failed:", last.error); await sleep(2500); }
  return last;
}

async function runGiveaway(g: Giveaway) {
  const record = buildRecord(g);
  const account = await createDrawAccount();
  note(`draw account ${account.publicKey.toBase58()}; uploading ${record.payload.length} bytes (${record.kind === 1 ? "the list itself" : "the list's SHA-256"})`);
  const lock = await send([lockIx(account.publicKey, uploadData(OP_LOCK, record.payload))], [payer]);
  if (!lock.ok || !readVerdict(lock.logs).accepted) throw new Error("Phil did not accept the giveaway: " + (lock.error ?? readVerdict(lock.logs).why) + "\n" + lock.logs.join("\n"));
  const locked = await readDraw(account.publicKey);
  note(`locked at slot ${locked.lockSlot}; target slot ${locked.targetSlot}`);
  const drew = await waitAndDraw(account.publicKey, locked.targetSlot);
  if (!drew.ok) throw new Error("the draw failed: " + drew.error + "\n" + drew.logs.join("\n"));
  const d = await readDraw(account.publicKey);
  if (d.state !== "drawn") throw new Error("the giveaway is " + d.state);
  // Recompute everything off chain; refuse to report a winner the chain does not agree with.
  const randomness = randomnessOf(d.payloadDigest, d.slotHash, account.publicKey.toBytes());
  const winners = pickWinners(randomness, d.count, d.winners);
  if (hex(randomness) !== hex(d.randomness) || winners[0] !== d.winner || hex(d.payloadDigest) !== hex(sha256(record.payload)) || hex(d.listDigest) !== hex(record.listDigest)) throw new Error("the account does not match what was computed off chain");
  return { record, account, lock, drew, d, winners };
}

async function selftest() {
  const problems: string[] = [];
  const expect = (name: string, ok: boolean, info = "") => { note(ok ? "ok  " : "FAIL", name, ok ? "" : info); if (!ok) problems.push(name); };
  const g: Giveaway = { title: "Self-test giveaway", winners: 2, delay: 20, entries: ["@alice", "@bob", "@carol", "@dave", "@erin", "@frank", "@grace"] };
  const record = buildRecord(g);

  // Refusals first, each against a fresh account.
  const a1 = await createDrawAccount();
  const tampered = record.payload.slice(); tampered[tampered.length - 1] ^= 1;
  let r = await send([lockIx(a1.publicKey, uploadData(OP_LOCK, tampered, { declaredDigest: sha256(record.payload) }))], [payer]);
  expect("a tampered upload is rejected by Phil on chain", !r.ok && /do not match the declared digest/.test(r.logs.join("\n")), r.error + " " + r.logs.join(" | "));
  expect("and leaves the account empty", (await conn.getAccountInfo(a1.publicKey))!.data.every((b) => b === 0));
  r = await send([lockIx(a1.publicKey, uploadData(OP_LOCK, record.payload, { versions: [7] }))], [payer]);
  expect("an unsupported protocol version is refused", !r.ok && /no protocol version in common/.test(r.logs.join("\n")), r.error);

  // The real thing.
  const done = await runGiveaway(g);
  expect("Phil accepts the giveaway and it is drawn", done.d.state === "drawn" && done.winners.length === 2);
  r = await send([lockIx(done.account.publicKey, uploadData(OP_LOCK, buildRecord({ ...g, title: "Swapped" }).payload))], [payer]);
  expect("a drawn giveaway cannot be locked again", !r.ok && /REJECTED by policy/.test(r.logs.join("\n")), r.error);
  r = await send([drawIx(done.account.publicKey)], [payer]);
  expect("or drawn again", !r.ok && /already drawn/.test(r.logs.join("\n")), r.error);

  // What the website does, with no key: read the account, and ask Phil about a list.
  const key = done.account.publicKey.toBase58(), me = payer.publicKey.toBase58();
  const seen = await accountData(url, key);
  expect("the website can read the draw account", !!seen && decodeDraw(seen.data)?.winner === done.d.winner && seen.owner === program.toBase58());
  let s = await simulate(url, buildCall(me, program.toBase58(), [{ key }], uploadData(OP_CHECK, record.payload)));
  expect("wallet-free: Phil accepts the real list and confirms it is the locked one", s.ok && /byte for byte the giveaway that is locked/.test(s.logs.join("\n")), s.error + " " + s.logs.join(" | "));
  const edited = buildRecord({ ...g, entries: [...g.entries.slice(0, 6), "@mallory"] }, 1);
  s = await simulate(url, buildCall(me, program.toBase58(), [{ key }], uploadData(OP_CHECK, edited.payload, { declaredDigest: done.d.payloadDigest, declaredLength: done.d.payloadLength })));
  expect("wallet-free: Phil rejects an edited list", !s.ok && !readVerdict(s.logs).accepted && /declared/.test(readVerdict(s.logs).why), s.error + " " + s.logs.join(" | "));
  console.log(JSON.stringify({ ok: problems.length === 0, problems, account: key, lockUnits: done.lock.units, drawUnits: done.drew.units, checkUnits: s.units, lockLogs: done.lock.logs, drawLogs: done.drew.logs, winners: done.winners.map((i) => g.entries[i]) }, null, 1));
  process.exit(problems.length ? 1 : 0);
}

async function run() {
  const [requestFile, resultFile, network = "devnet"] = rest;
  const q = JSON.parse(fs.readFileSync(requestFile, "utf8"));
  const cleaned = cleanEntries(Array.isArray(q.entries) ? q.entries.join("\n") : String(q.entries ?? ""));
  const minutes = Math.min(300, Math.max(0.2, Number(q.delayMinutes ?? 1)));
  const g: Giveaway = { title: String(q.title ?? "").trim().slice(0, 60), winners: Math.max(1, Math.floor(Number(q.winners ?? 1))), delay: Math.round(minutes * 150), entries: cleaned.entries };
  const done = await runGiveaway(g);
  const when = (slot: number | null) => (slot === null ? null : slot);
  const result = {
    id: q.id, title: g.title, network, program: program.toBase58(), account: done.account.publicKey.toBase58(),
    entries: g.entries, repeatsRemoved: cleaned.repeats, winnerCount: g.winners, kind: done.record.kind,
    payloadDigest: hex(done.d.payloadDigest), payloadLength: done.d.payloadLength, listDigest: hex(done.d.listDigest), delaySlots: g.delay,
    lock: { signature: done.lock.signature, slot: when(done.d.lockSlot), time: done.d.lockTime, units: done.lock.units, logs: done.lock.logs },
    draw: { signature: done.drew.signature, targetSlot: done.d.targetSlot, hashSlot: done.d.hashSlot, slotHash: hex(done.d.slotHash), randomness: hex(done.d.randomness), units: done.drew.units, logs: done.drew.logs },
    winners: done.winners.map((index) => ({ index, entry: g.entries[index] })),
  };
  fs.writeFileSync(resultFile, JSON.stringify(result, null, 1) + "\n");
  note(`winner${result.winners.length > 1 ? "s" : ""}: ${result.winners.map((w) => w.entry).join(", ")}`);
}

(command === "selftest" ? selftest() : command === "run" ? run() : Promise.reject(new Error("usage: selftest | run"))).catch((e) => { note(String(e?.stack ?? e)); process.exit(1); });
