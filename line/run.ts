// Runs The Line against a Solana node. Used by the workflow; needs a funded payer key.
//
//   selftest <rpc> <program id> <payer.json>
//       two keys play: the refusals, a whole match, and a forfeit on time.
//   demo <rpc> <program id> <payer.json> <demo.json>
//       one whole match between two practice players, recorded for the site.
import * as fs from "fs";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { readVerdict, sha256 } from "../site/src/draw";
import { commitment, decodeMatch, practicePull, playRound, newBoard, revealData, resultText, Match, Side, Board, MATCH_SIZE } from "../site/src/line";
import { openInstructions, joinInstruction, commitInstruction, revealInstruction, timeoutInstruction, Move } from "../site/src/line-tx";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const [command, url, programText, payerFile, ...rest] = process.argv.slice(2);
const conn = new Connection(url, "confirmed");
const program = new PublicKey(programText);
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(payerFile, "utf8"))));
const note = (...a: unknown[]) => console.error(...a);
const json = (f: string, fallback: any) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fallback; } };

interface Sent { ok: boolean; signature: string | null; logs: string[]; units: number | null; error?: string }
/** Devnet's public node refuses bursts. A refused request is retried; a refused transaction is not. */
async function patiently<T>(f: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await f(); } catch (e: any) { if (i >= 6 || !/429|Too Many|fetch failed|ECONNRESET|ETIMEDOUT|503|502/i.test(String(e?.message ?? e))) throw e; await sleep(2000 * (i + 1)); }
  }
}
async function send(ixs: TransactionInstruction[], signers: Keypair[]): Promise<Sent> {
  try {
    const signature = await patiently(() => sendAndConfirmTransaction(conn, new Transaction().add(...ixs), signers, { commitment: "confirmed" }));
    let tx = null;
    for (let i = 0; i < 20 && !tx; i++) { tx = await patiently(() => conn.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })); if (!tx) await sleep(1500); }
    return { ok: true, signature, logs: tx?.meta?.logMessages ?? [], units: tx?.meta?.computeUnitsConsumed ?? null };
  } catch (e: any) {
    return { ok: false, signature: null, logs: e?.logs ?? e?.transactionLogs ?? [], units: null, error: String(e?.message ?? e).split("\n")[0] };
  }
}
async function readMatch(match: PublicKey): Promise<Match> {
  const info = await patiently(() => conn.getAccountInfo(match, "confirmed"));
  const m = info && decodeMatch(Uint8Array.from(info.data));
  if (!m) throw new Error("the match is missing or empty");
  return m;
}
const rent = () => patiently(() => conn.getMinimumBalanceForRentExemption(MATCH_SIZE));
/** Two new player keys with enough SOL for a match's fees, paid by the payer in one transaction. */
async function players(lamports: number): Promise<[Keypair, Keypair]> {
  const a = Keypair.generate(), b = Keypair.generate();
  const r = await send([a, b].map((k) => SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: k.publicKey, lamports })), [payer]);
  if (!r.ok) throw new Error("could not fund the players: " + r.error);
  return [a, b];
}
/** What is left goes back to the payer. */
async function sweep(keys: Keypair[]) {
  for (const k of keys) {
    const left = await patiently(() => conn.getBalance(k.publicKey, "confirmed"));
    if (left > 10000) await send([SystemProgram.transfer({ fromPubkey: k.publicKey, toPubkey: payer.publicKey, lamports: left - 5000 })], [k]);
  }
}
const nonceFor = (seed: Uint8Array, round: number, side: Side) => sha256(Uint8Array.from([...seed, round, side]));
async function open(a: Keypair, windowSeconds: number) {
  const made = openInstructions({ program, payer: payer.publicKey, player: a.publicKey, owner: payer.publicKey, windowSeconds, rentLamports: await rent() });
  return { match: made.match.publicKey, sent: await send(made.instructions, [payer, made.match, a]) };
}

async function selftest() {
  const problems: string[] = [];
  const expect = (name: string, ok: boolean, info = "") => { note(ok ? "ok  " : "FAIL", name, ok ? "" : info); if (!ok) problems.push(name); };
  const [a, b] = await players(60_000_000);
  const eve = Keypair.generate(), seed = Keypair.generate().publicKey.toBytes();
  const keys = [a, b];

  const { match, sent: opened } = await open(a, 20);
  expect("Phil accepts the opening and player A is seated", opened.ok && readVerdict(opened.logs).accepted && (await readMatch(match)).phase === "waiting", opened.error + " " + opened.logs.join(" | "));
  let r = await send([joinInstruction(program, match, a.publicKey, payer.publicKey)], [payer, a]);
  expect("the same key cannot sit on both sides", !r.ok, r.error);
  const joined = await send([joinInstruction(program, match, b.publicKey, b.publicKey)], [b]);
  expect("player B joins and round 1 opens", joined.ok && (await readMatch(match)).phase === "committing", joined.error + " " + joined.logs.join(" | "));

  const move = (round: number, side: Side, pull: number): Move => ({ round, side, pull, nonce: nonceFor(seed, round, side) });
  const commit = (m: Move) => send([commitInstruction(program, match, keys[m.side].publicKey, m.round, commitment(match.toBytes(), m.round, m.side, m.pull, m.nonce))], [keys[m.side]]);
  const reveal = (m: Move) => send([revealInstruction(program, match, keys[m.side].publicKey, m)], [keys[m.side]]);
  const mA = move(1, 0, 12), mB = move(1, 1, 9);
  r = await send([commitInstruction(program, match, payer.publicKey, 1, commitment(match.toBytes(), 1, 0, 1, mA.nonce))], [payer]);
  expect("a key that is not a player cannot move", !r.ok && /REJECTED by policy/.test(r.logs.join("\n")), r.error);
  const cA = await commit(mA);
  expect("a hidden move is committed", cA.ok && readVerdict(cA.logs).accepted, cA.error + " " + cA.logs.join(" | "));
  r = await reveal(mA);
  expect("nobody can reveal before both sides have committed", !r.ok, r.error);
  await commit(mB);
  expect("when both have committed, reveals open", (await readMatch(match)).phase === "revealing");
  const hash = commitment(match.toBytes(), 1, 0, 12, mA.nonce);
  r = await send([revealInstruction(program, match, a.publicKey, mA, revealData(match.toBytes(), 1, 0, 30, mA.nonce, { declaredDigest: hash }))], [a]);
  expect("a changed pull that claims the committed hash is rejected by Phil on chain", !r.ok && /do not match the declared digest/.test(r.logs.join("\n")), r.error + " " + r.logs.join(" | "));
  r = await send([revealInstruction(program, match, a.publicKey, { ...mA, pull: 30 })], [a]);
  expect("a changed pull declared honestly is refused before any payload is read", !r.ok && /REJECTED by policy before any payload/.test(r.logs.join("\n")), r.error);
  const rA = await reveal(mA);
  expect("the committed move is opened by Phil's server", rA.ok && /SHA-256 matches the declared digest/.test(rA.logs.join("\n")) && readVerdict(rA.logs).accepted, rA.error + " " + rA.logs.join(" | "));
  const rB = await reveal(mB);
  let m = await readMatch(match);
  expect("the round is played by the rules: 12 beats 9, the node moves toward A, both pay", rB.ok && /ROUND PLAYED/.test(rB.logs.join("\n")) && m.node === 2 && m.energy.join() === "20,23" && m.round === 2 && m.phase === "committing", JSON.stringify([m.node, m.energy, m.round]));
  r = await send([timeoutInstruction(program, match)], [payer]);
  expect("a round cannot be timed out while it still has time", !r.ok && /not yet/.test(r.logs.join("\n")), r.error);

  // Play the rest: both practice players, the program against the page's rules after every round.
  let board: Board = playRound(newBoard(), 12, 9), agreed = true, units = 0, sends = 0;
  const rand = () => Math.random();
  while (board.result === "none" && agreed) {
    const x = move(board.round, 0, practicePull(board, 0, rand)), y = move(board.round, 1, Math.min(board.energy[1], practicePull(board, 1, rand) + 3));
    const sent = [await commit(x), await commit(y), await reveal(y), await reveal(x)];
    if (sent.some((s) => !s.ok)) { agreed = false; note(sent.map((s) => s.error).join(" / ")); break; }
    units += sent[3].units ?? 0; sends++;
    board = playRound(board, x.pull, y.pull);
    m = await readMatch(match);
    agreed = m.node === board.node && m.energy.join() === board.energy.join() && m.result === board.result && m.how === board.how;
  }
  expect("a whole match: the program agrees with the page's rules after every round, and ends", agreed && m.phase === "over" && m.result !== "none", JSON.stringify([board, m.result, m.how]));
  r = await commit(move(m.round, 0, 0));
  expect("a finished match takes no more moves", !r.ok, r.error);

  // A side that commits and never reveals forfeits, once the time limit has passed.
  const second = await open(a, 20);
  await send([joinInstruction(program, second.match, b.publicKey, b.publicKey)], [b]);
  const commit2 = (side: Side) => send([commitInstruction(program, second.match, keys[side].publicKey, 1, commitment(second.match.toBytes(), 1, side, 5, nonceFor(seed, 1, side)))], [keys[side]]);
  await commit2(0); await commit2(1);
  await send([revealInstruction(program, second.match, b.publicKey, { round: 1, side: 1, pull: 5, nonce: nonceFor(seed, 1, 1) })], [b]);
  const start = (await readMatch(second.match)).phaseStart;
  for (;;) { const t = (await conn.getBlockTime(await conn.getSlot("confirmed"))) ?? 0; if (t > start + 21) break; await sleep(3000); }
  r = await send([timeoutInstruction(program, second.match)], [payer]);
  m = await readMatch(second.match);
  expect("a side that committed and did not reveal in time forfeits, on anyone's call", r.ok && m.phase === "over" && m.result === "b" && m.how === "no-reveal", r.error + " " + JSON.stringify([m.result, m.how]));
  void eve;
  await sweep(keys);
  console.log(JSON.stringify({ ok: problems.length === 0, problems, match: match.toBase58(), revealUnits: sends ? Math.round(units / sends) : rA.units, commitUnits: cA.units }, null, 1));
  process.exit(problems.length ? 1 : 0);
}

async function demo() {
  const [demoFile] = rest;
  const d = json(demoFile, null)?.program === program.toBase58() ? json(demoFile, null) : { program: program.toBase58(), wallet: payer.publicKey.toBase58(), matches: [] };
  const [a, b] = await players(40_000_000), keys = [a, b], seed = Keypair.generate().publicKey.toBytes();
  const { match, sent: opened } = await open(a, 300);
  if (!opened.ok) throw new Error("the demo match was not opened: " + opened.error + "\n" + opened.logs.join("\n"));
  const joined = await send([joinInstruction(program, match, b.publicKey, b.publicKey)], [b]);
  if (!joined.ok) throw new Error("the demo match was not joined: " + joined.error);
  let board = newBoard();
  const rounds: { round: number; commits: (string | null)[]; reveals: (string | null)[] }[] = [];
  while (board.result === "none") {
    const moves: Move[] = ([0, 1] as Side[]).map((side) => ({ round: board.round, side, pull: practicePull(board, side, Math.random), nonce: nonceFor(seed, board.round, side) }));
    const commits: Sent[] = [], reveals: Sent[] = [];
    for (const m of moves) commits.push(await send([commitInstruction(program, match, keys[m.side].publicKey, m.round, commitment(match.toBytes(), m.round, m.side, m.pull, m.nonce))], [keys[m.side]]));
    for (const m of moves) reveals.push(await send([revealInstruction(program, match, keys[m.side].publicKey, m)], [keys[m.side]]));
    const bad = [...commits, ...reveals].find((s) => !s.ok);
    if (bad) throw new Error(`round ${board.round} failed: ${bad.error}\n${bad.logs.join("\n")}`);
    rounds.push({ round: board.round, commits: commits.map((s) => s.signature), reveals: reveals.map((s) => s.signature) });
    board = playRound(board, moves[0].pull, moves[1].pull);
  }
  const m = await readMatch(match);
  if (m.phase !== "over" || m.result !== board.result) throw new Error("the program and the rules disagree about how the demo match ended");
  await sweep(keys);
  d.matches = [{ day: new Date().toISOString().slice(0, 10), match: match.toBase58(), opened: opened.signature, joined: joined.signature, result: m.result, how: m.how, history: m.history, rounds }, ...(d.matches ?? [])].slice(0, 14);
  fs.writeFileSync(demoFile, JSON.stringify(d, null, 1) + "\n");
  note(`demo: a ${m.history.length}-round match. ${resultText(m)}`);
}

(command === "selftest" ? selftest() : command === "demo" ? demo() : Promise.reject(new Error("usage: selftest | demo"))).catch((e) => { note(String(e?.stack ?? e)); process.exit(1); });
