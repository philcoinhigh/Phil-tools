// Runs Clip Bounties against a Solana node. Used by the workflow; needs a funded payer key.
//
//   selftest <rpc> <program id> <payer.json>
//       posts bounties and takes them through every ending: the sponsor picks, a block hash draws,
//       nobody enters, and a token prize. Tries what a cheating sponsor or entrant would try.
//   demo <rpc> <program id> <payer.json> <demo.json>
//       keeps one practice challenge open for visitors, and settles the ones that have ended.
import * as fs from "fs";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, MINT_SIZE, createInitializeMint2Instruction, createMintToInstruction } from "@solana/spl-token";
import { decodeBounty, decodeEntry, drawnIndex, Bounty, BOUNTY_SIZE, ENTRY_SIZE } from "../site/src/bounty";
import { postInstructions, enterInstructions, awardInstructions, armInstruction, drawInstruction, claimInstructions, refundInstruction, prizeAccount, receiving, Coin } from "../site/src/bounty-tx";
import { createTokenAccount, tokenAccountOf } from "../site/src/qvault-tx";

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
const balance = async (k: PublicKey) => BigInt(await patiently(() => conn.getBalance(k, "confirmed")));
// Solana's own clock, read from the account every program reads it from.
const CLOCK = new PublicKey("SysvarC1ock11111111111111111111111111111111");
const chainTime = async () => { const info = await patiently(() => conn.getAccountInfo(CLOCK, "confirmed")); if (!info) throw new Error("the clock could not be read"); return Number(Buffer.from(info.data).readBigInt64LE(32)); };
// Nothing here should ever take long. If something hangs, say so and stop, rather than hold the workflow.
setTimeout(() => { note("FAIL the run took more than 14 minutes and was stopped"); process.exit(1); }, 14 * 60 * 1000).unref();
async function readBounty(k: PublicKey): Promise<{ b: Bounty; lamports: bigint }> {
  const info = await patiently(() => conn.getAccountInfo(k, "confirmed")); const b = info && decodeBounty(Uint8Array.from(info.data));
  if (!b) throw new Error("the bounty is missing"); return { b, lamports: BigInt(info!.lamports) };
}
async function stranger(lamports = 30_000_000n): Promise<Keypair> {
  const k = Keypair.generate();
  const r = await send([SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: k.publicKey, lamports })], [payer], false);
  if (!r.ok) throw new Error("could not fund a test wallet: " + r.error); return k;
}
async function post(sponsor: Keypair, text: string, seconds: number, graceSeconds: number, prize: bigint, coin?: Coin) {
  const rentLamports = await patiently(() => conn.getMinimumBalanceForRentExemption(BOUNTY_SIZE));
  const made = postInstructions({ program, sponsor: sponsor.publicKey, text, deadline: (await chainTime()) + seconds, graceSeconds, prize, rentLamports, coin });
  return { bounty: made.bounty.publicKey, sent: await send(made.instructions, [sponsor, made.bounty]) };
}
async function enter(bounty: PublicKey, who: Keypair, link: string) {
  const made = enterInstructions(program, bounty, who.publicKey, link, await patiently(() => conn.getMinimumBalanceForRentExemption(ENTRY_SIZE)));
  return { entry: made.entry.publicKey, sent: await send(made.instructions, [who, made.entry]) };
}
async function entriesOf(bounty: PublicKey) {
  const list = await patiently(() => conn.getProgramAccounts(program, { commitment: "confirmed", filters: [{ dataSize: ENTRY_SIZE }, { memcmp: { offset: 8, bytes: bounty.toBase58() } }] }));
  return list.map((a) => ({ address: a.pubkey, e: decodeEntry(Uint8Array.from(a.account.data))! })).filter((x) => x.e).sort((x, y) => x.e.index - y.e.index);
}
/** Arms the draw once the sponsor's time is up, waits for its block, draws, and pays the entry it picked. */
async function settleByDraw(bounty: PublicKey, fees: Keypair, coin?: Coin) {
  let armed: Sent = { ok: false, signature: null, logs: [], units: null, error: "never tried" };
  for (let i = 0; i < 40 && !armed.ok; i++) { armed = await send([armInstruction(program, bounty)], [fees]); if (!armed.ok) await sleep(3000); }
  if (!armed.ok) return { armed, drawn: armed, claimed: armed };
  let drawn: Sent = armed;
  for (let i = 0; i < 30; i++) { await sleep(local ? 3000 : 5000); drawn = await send([drawInstruction(program, bounty)], [fees]); if (drawn.ok) break; }
  if (!drawn.ok) return { armed, drawn, claimed: drawn };
  const { b } = await readBounty(bounty), winner = (await entriesOf(bounty)).find((x) => x.e.index === b.winnerIndex)!;
  const claimed = await send(claimInstructions(program, bounty, winner.address, new PublicKey(winner.e.entrant), fees.publicKey, coin), [fees]);
  return { armed, drawn, claimed, winner, b };
}

async function selftest() {
  const problems: string[] = [];
  const expect = (what: string, ok: boolean, detail = "") => { note(ok ? "ok  " : "FAIL", what, ok ? "" : detail); if (!ok) problems.push(what); };
  const sponsor = await stranger(400_000_000n), alice = await stranger(), bob = await stranger(), mallory = await stranger(), fees = await stranger();
  const PRIZE = 50_000_000n, WAIT = local ? 25 : 75;

  // Two bounties whose clocks run while the rest is checked: one the sponsor will ignore, one nobody enters.
  const quiet = await post(sponsor, "Selftest: the sponsor goes quiet", WAIT, 5, PRIZE);
  const lonely = await post(sponsor, "Selftest: nobody enters", WAIT, 5, PRIZE);
  const picked = await post(sponsor, "Selftest: the sponsor picks", 3600, 60, PRIZE);
  let { b, lamports } = await readBounty(picked.bounty);
  expect("a challenge is posted with its prize locked in the same transaction", quiet.sent.ok && lonely.sent.ok && picked.sent.ok && b.state === "open" && b.prize === PRIZE && lamports - b.reserve === PRIZE && b.sponsor.every((x, i) => x === sponsor.publicKey.toBytes()[i]), picked.sent.error + " " + picked.sent.logs.join(" | "));
  { // No prize, no challenge.
    const rentLamports = await patiently(() => conn.getMinimumBalanceForRentExemption(BOUNTY_SIZE));
    const made = postInstructions({ program, sponsor: sponsor.publicKey, text: "no prize", deadline: (await chainTime()) + 600, graceSeconds: 5, prize: PRIZE, rentLamports });
    made.instructions[0] = SystemProgram.createAccount({ fromPubkey: sponsor.publicKey, newAccountPubkey: made.bounty.publicKey, lamports: rentLamports, space: BOUNTY_SIZE, programId: program });
    const r = await send(made.instructions, [sponsor, made.bounty]);
    expect("a challenge cannot be posted without its prize", !r.ok, r.error);
  }
  const qa = await enter(quiet.bounty, alice, "https://x.com/alice/status/1"), qb = await enter(quiet.bounty, bob, "https://x.com/bob/status/2");
  const pa = await enter(picked.bounty, alice, "https://x.com/alice/status/3"), pb = await enter(picked.bounty, bob, "https://www.youtube.com/watch?v=selftest");
  const listed = await entriesOf(picked.bounty);
  expect("entries are numbered in order and can be listed from the chain", qa.sent.ok && qb.sent.ok && pa.sent.ok && pb.sent.ok && listed.length === 2 && listed[1].e.link === "https://www.youtube.com/watch?v=selftest" && listed[1].address.equals(pb.entry), pa.sent.error + " " + pb.sent.error);
  {
    const made = enterInstructions(program, picked.bounty, bob.publicKey, "https://x.com/forged/status/9", await patiently(() => conn.getMinimumBalanceForRentExemption(ENTRY_SIZE)));
    made.instructions[0] = SystemProgram.createAccount({ fromPubkey: mallory.publicKey, newAccountPubkey: made.entry.publicKey, lamports: await conn.getMinimumBalanceForRentExemption(ENTRY_SIZE), space: ENTRY_SIZE, programId: program });
    made.instructions[1].keys[2].isSigner = false;
    const r = await send(made.instructions, [mallory, made.entry]);
    expect("nobody can enter in another wallet's name", !r.ok, r.error);
  }
  let r = await send(awardInstructions(program, picked.bounty, mallory.publicKey, pb.entry, bob.publicKey), [mallory]);
  expect("only the sponsor can pick the winner", !r.ok, r.error);
  { const ixs = awardInstructions(program, picked.bounty, sponsor.publicKey, pb.entry, bob.publicKey); ixs[0].keys[3].pubkey = sponsor.publicKey; r = await send(ixs, [sponsor]); }
  expect("the sponsor cannot send the prize to themselves instead of the winner", !r.ok, r.error);
  r = await send([refundInstruction(program, picked.bounty, sponsor.publicKey)], [sponsor]);
  expect("with entries in, the sponsor cannot take the prize back", !r.ok, r.error);
  r = await send([armInstruction(program, picked.bounty)], [fees]);
  expect("nobody can start a draw while the sponsor still has time to pick", !r.ok, r.error);
  const bobBefore = await balance(bob.publicKey);
  const awarded = await send(awardInstructions(program, picked.bounty, sponsor.publicKey, pb.entry, bob.publicKey), [sponsor]);
  ({ b, lamports } = await readBounty(picked.bounty));
  expect("the sponsor picks an entry and its wallet is paid the whole prize", awarded.ok && b.state === "paid" && b.how === "sponsor" && b.winnerIndex === 1 && (await balance(bob.publicKey)) === bobBefore + PRIZE && lamports === b.reserve, awarded.error + " " + awarded.logs.join(" | "));
  r = await send(awardInstructions(program, picked.bounty, sponsor.publicKey, pa.entry, alice.publicKey), [sponsor]);
  expect("the prize is paid once: a second award is refused", !r.ok, r.error);

  // A token prize.
  const coinKey = Keypair.generate(), coin: Coin = { mint: coinKey.publicKey, tokenProgram: TOKEN_PROGRAM_ID, decimals: 6 };
  const minted = await send([
    SystemProgram.createAccount({ fromPubkey: sponsor.publicKey, newAccountPubkey: coin.mint, lamports: await patiently(() => conn.getMinimumBalanceForRentExemption(MINT_SIZE)), space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
    createInitializeMint2Instruction(coin.mint, 6, sponsor.publicKey, null), createTokenAccount(sponsor.publicKey, sponsor.publicKey, coin.mint, TOKEN_PROGRAM_ID),
    createMintToInstruction(coin.mint, tokenAccountOf(sponsor.publicKey, coin.mint, TOKEN_PROGRAM_ID), sponsor.publicKey, 1_000_000_000n) ], [sponsor, coinKey], false);
  const held = async (k: PublicKey) => BigInt((await patiently(() => conn.getTokenAccountBalance(k, "confirmed"))).value.amount);
  const tok = await post(sponsor, "Selftest: a token prize", 3600, 60, 250_000_000n, coin);
  const ta = await enter(tok.bounty, alice, "https://www.tiktok.com/@alice/video/4");
  const tAwarded = await send(awardInstructions(program, tok.bounty, sponsor.publicKey, ta.entry, alice.publicKey, coin), [sponsor]);
  expect("a token prize is locked where only the program can sign, and paid to the winner's token account", minted.ok && tok.sent.ok && ta.sent.ok && tAwarded.ok && (await held(receiving(alice.publicKey, coin))) === 250_000_000n && (await held(prizeAccount(program, tok.bounty, coin))) === 0n, tok.sent.error + " " + tAwarded.error + " " + tAwarded.logs.join(" | "));

  // The sponsor went quiet: a block hash draws, and anyone pays the winner.
  const before = { a: await balance(alice.publicKey), b: await balance(bob.publicKey) };
  const s = await settleByDraw(quiet.bounty, fees);
  ({ b, lamports } = await readBounty(quiet.bounty));
  const paid = b.winnerIndex === 0 ? (await balance(alice.publicKey)) - before.a : (await balance(bob.publicKey)) - before.b;
  expect("when the sponsor goes quiet, a block hash nobody chose picks an entry and it is paid", s.armed.ok && s.drawn.ok && s.claimed.ok && b.state === "paid" && b.how === "draw" && paid === PRIZE && b.winnerIndex === drawnIndex(b.slotHash, quiet.bounty.toBytes(), 2), `${s.armed.error} ${s.drawn.error} ${s.claimed.error} ${s.claimed.logs.join(" | ")}`);
  r = await send([refundInstruction(program, lonely.bounty, mallory.publicKey)], [mallory]);
  expect("an unclaimed prize cannot be refunded to anyone but the sponsor", !r.ok, r.error);
  const sponsorBefore = await balance(sponsor.publicKey);
  const refunded = await send([refundInstruction(program, lonely.bounty, sponsor.publicKey)], [fees]);
  expect("when nobody entered before the deadline, the prize goes back to the sponsor", refunded.ok && (await readBounty(lonely.bounty)).b.state === "refunded" && (await balance(sponsor.publicKey)) === sponsorBefore + PRIZE, refunded.error + " " + refunded.logs.join(" | "));
  console.log(JSON.stringify({ ok: problems.length === 0, problems, postUnits: picked.sent.units, enterUnits: pa.sent.units, awardUnits: awarded.units, drawUnits: s.drawn.units }, null, 1));
  if (problems.length) process.exit(1);
}

const PRACTICE = "Practice challenge: enter any clip link to see how it works. Test coins only.";
async function demo() {
  const [demoFile] = rest;
  const d = json(demoFile, null)?.program === program.toBase58() ? json(demoFile, null) : { program: program.toBase58(), wallet: payer.publicKey.toBase58(), bounties: [] };
  const now = await chainTime();
  let open: string | null = null;
  for (const x of d.bounties as any[]) {
    if (x.state && x.state !== "open") continue;
    try {
      const k = new PublicKey(x.bounty), { b } = await readBounty(k), entries = await entriesOf(k);
      if (b.state === "open" && now <= b.deadline) { open = x.bounty; x.entries = b.count; continue; }
      if (b.state === "open" && entries.length) {            // ended with entries: the sponsor (this wallet) picks the latest one
        const pick = entries[entries.length - 1], sent = await send(awardInstructions(program, k, payer.publicKey, pick.address, new PublicKey(pick.e.entrant)), [payer]);
        if (sent.ok) Object.assign(x, { state: "paid", winner: new PublicKey(pick.e.entrant).toBase58(), awarded: sent.signature, entries: entries.length });
      } else if (b.state === "open") { const sent = await send([refundInstruction(program, k, payer.publicKey)], [payer]); if (sent.ok) Object.assign(x, { state: "refunded", entries: 0 }); }
      else x.state = b.state;
    } catch (e: any) { note("demo: could not settle " + x.bounty + ": " + String(e?.message ?? e).split("\n")[0]); }
  }
  if (!open) {
    const made = await post(payer, PRACTICE, 3 * 86400, 86400, 20_000_000n);
    if (!made.sent.ok) throw new Error("the practice challenge was not posted: " + made.sent.error + "\n" + made.sent.logs.join("\n"));
    d.bounties = [{ day: new Date().toISOString().slice(0, 10), bounty: made.bounty.toBase58(), posted: made.sent.signature, state: "open", entries: 0 }, ...d.bounties].slice(0, 20);
    note("demo: a practice challenge was posted: " + made.bounty.toBase58());
  } else note("demo: the practice challenge is still open: " + open);
  fs.writeFileSync(demoFile, JSON.stringify(d, null, 1) + "\n");
}

(command === "selftest" ? selftest() : command === "demo" ? demo() : Promise.reject(new Error("usage: selftest | demo"))).catch((e) => { note(String(e?.stack ?? e)); process.exit(1); });
